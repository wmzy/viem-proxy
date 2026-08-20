/**
 * Server-side performance statistics tests (PRD 3.1).
 *
 * Split out from handlers.test.ts because these exercise the Hono app and
 * the Statistics Durable Object end-to-end. Merge suggestion: if the suites
 * are ever consolidated, move the "cloudflare:workers" mock and the
 * "App-level" describes into handlers.test.ts and the DO describes next to
 * the Mock Environment block there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The DurableObject base class only exists in the Workers runtime;
// substitute a plain class so the DO can be constructed under Node.
vi.mock("cloudflare:workers", () => {
  class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(state: unknown, env: unknown) {
      this.ctx = state;
      this.env = env;
    }
  }
  return { DurableObject };
});

import {
  aggregatePeriods,
  appendSample,
  bucketCutoff,
  hourBucket,
  mergeRecord,
  percentile,
  SAMPLE_LIMIT,
  type StatsRecord,
  type StatsRow,
} from "../src/utils/statistics";
import type { Env as WorkerEnv } from "../src/types";
import { Statistics } from "../src/durable-objects/statistics";
import { getMaxRpcConcurrency, setMaxRpcConcurrency } from "../src/actions/utils";
import app from "../src/index";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("Statistics pure helpers", () => {
  describe("hourBucket", () => {
    it("should floor a timestamp to its UTC hour", () => {
      expect(hourBucket(Date.parse("2026-08-20T14:23:45.123Z"))).toBe(
        "2026-08-20T14:00:00.000Z"
      );
    });

    it("should produce lexicographically sortable buckets", () => {
      const a = hourBucket(Date.parse("2026-08-20T23:59:59Z"));
      const b = hourBucket(Date.parse("2026-08-21T00:00:01Z"));
      expect(a < b).toBe(true);
    });

    it("bucketCutoff should subtract whole hours", () => {
      const now = Date.parse("2026-08-20T14:23:45Z");
      expect(bucketCutoff(now, 24)).toBe("2026-08-19T14:00:00.000Z");
    });
  });

  describe("percentile", () => {
    it("should compute nearest-rank percentiles", () => {
      expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
      expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
      expect(percentile([10, 20, 30, 40, 50], 99)).toBe(50);
    });

    it("should sort unsorted input", () => {
      expect(percentile([50, 10, 40, 20, 30], 50)).toBe(30);
    });

    it("should handle a single sample", () => {
      expect(percentile([7], 50)).toBe(7);
      expect(percentile([7], 95)).toBe(7);
    });

    it("should return null for empty samples", () => {
      expect(percentile([], 50)).toBeNull();
    });
  });

  describe("appendSample", () => {
    it("should keep only the most recent SAMPLE_LIMIT samples", () => {
      let samples: number[] = [];
      for (let i = 1; i <= SAMPLE_LIMIT + 5; i++) {
        samples = appendSample(samples, i);
      }
      expect(samples).toHaveLength(SAMPLE_LIMIT);
      expect(samples[0]).toBe(6);
      expect(samples[SAMPLE_LIMIT - 1]).toBe(SAMPLE_LIMIT + 5);
    });
  });

  describe("mergeRecord", () => {
    const bucket = "2026-08-20T14:00:00.000Z";

    it("should create a row from an upstream MISS record", () => {
      const row = mergeRecord(undefined, {
        method: "eth_getBalance",
        chainId: 1,
        cacheStatus: "MISS",
        error: false,
        durationMs: 42,
      }, bucket);

      expect(row).toMatchObject({
        method: "eth_getBalance",
        chain_id: 1,
        cache_status: "MISS",
        period_bucket: bucket,
        count: 1,
        error_count: 0,
        total_ms: 42,
        samples: "[42]",
      });
    });

    it("should accumulate counts, errors and samples across records", () => {
      const base = mergeRecord(undefined, {
        method: "eth_getBalance",
        chainId: 1,
        cacheStatus: "MISS",
        error: false,
        durationMs: 42,
      }, bucket);
      let row = mergeRecord(base, {
        method: "eth_getBalance",
        chainId: 1,
        cacheStatus: "MISS",
        error: false,
        durationMs: 10,
      }, bucket);
      row = mergeRecord(row, {
        method: "eth_getBalance",
        chainId: 1,
        cacheStatus: "MISS",
        error: true,
        durationMs: 30,
      }, bucket);

      expect(row.count).toBe(3);
      expect(row.error_count).toBe(1);
      expect(row.total_ms).toBe(82);
      expect(JSON.parse(row.samples)).toEqual([42, 10, 30]);
    });

    it("should not add duration or samples for HIT records", () => {
      let row = mergeRecord(undefined, {
        method: "eth_getBalance",
        chainId: 1,
        cacheStatus: "MISS",
        error: false,
        durationMs: 42,
      }, bucket);
      row = mergeRecord(row, {
        method: "eth_getBalance",
        chainId: 1,
        cacheStatus: "HIT",
        error: false,
        durationMs: 0,
      }, bucket);

      expect(row.count).toBe(2);
      expect(row.total_ms).toBe(42);
      expect(row.samples).toBe("[42]");
    });
  });

  describe("aggregatePeriods", () => {
    const row = (overrides: Partial<StatsRow>): StatsRow => ({
      method: "eth_getBalance",
      chain_id: 1,
      cache_status: "MISS",
      period_bucket: "2026-08-20T13:00:00.000Z",
      count: 1,
      error_count: 0,
      total_ms: 0,
      samples: "[]",
      ...overrides,
    });

    it("should aggregate hourly buckets with percentiles and summary", () => {
      const summary = aggregatePeriods([
        row({
          period_bucket: "2026-08-20T14:00:00.000Z",
          count: 1,
          error_count: 1,
          total_ms: 100,
          samples: "[100]",
        }),
        row({
          period_bucket: "2026-08-20T13:00:00.000Z",
          count: 2,
          total_ms: 30,
          samples: "[10,20]",
        }),
        row({ cache_status: "HIT", count: 1, samples: "[]" }),
      ]);

      expect(summary.periods).toHaveLength(2);
      // Sorted ascending by bucket
      expect(summary.periods[0].bucket).toBe("2026-08-20T13:00:00.000Z");
      expect(summary.periods[0]).toMatchObject({
        count: 3,
        errorCount: 0,
        p50: 10,
        p95: 20,
        p99: 20,
      });
      expect(summary.periods[1]).toMatchObject({
        count: 1,
        errorCount: 1,
        p50: 100,
        p95: 100,
        p99: 100,
      });

      expect(summary.totalRequests).toBe(4);
      expect(summary.cacheHits).toBe(1);
      expect(summary.cacheHitRate).toBe(0.25);
      // average over upstream (MISS) calls only: (30 + 100) / 3
      expect(summary.averageResponseTime).toBeCloseTo(43.333333, 5);
      expect(summary.errorCount).toBe(1);
      expect(summary.errorRate).toBe(0.25);
    });

    it("should return an empty well-formed summary for no rows", () => {
      const summary = aggregatePeriods([]);
      expect(summary).toEqual({
        totalRequests: 0,
        cacheHits: 0,
        cacheHitRate: 0,
        averageResponseTime: 0,
        errorCount: 0,
        errorRate: 0,
        periods: [],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Statistics Durable Object (fake in-memory SQL storage)
// ---------------------------------------------------------------------------

type StorageHarness = {
  rows: Map<string, StatsRow>;
};

const createStatisticsDo = (): { instance: Statistics } & StorageHarness => {
  const rows = new Map<string, StatsRow>();
  let alarm: number | null = null;

  // Minimal SQL shim implementing exactly the statements the DO issues.
  // Values come only from bound parameters, so this mirrors SQLite
  // semantics for these fixed statement shapes.
  const exec = (sql: string, ...params: unknown[]): StatsRow[] => {
    if (/^\s*CREATE/i.test(sql)) return [];

    if (sql.startsWith("DELETE FROM statistics WHERE period_bucket < ?")) {
      const cutoff = params[0] as string;
      for (const [key, value] of rows) {
        if (value.period_bucket < cutoff) rows.delete(key);
      }
      return [];
    }

    if (
      sql ===
      "SELECT * FROM statistics WHERE method = ? AND chain_id = ? AND cache_status = ? AND period_bucket = ?"
    ) {
      const [method, chainId, cacheStatus, bucket] = params as [
        string,
        number,
        string,
        string
      ];
      const found = rows.get(`${method}|${chainId}|${cacheStatus}|${bucket}`);
      return found ? [found] : [];
    }

    if (sql.startsWith("SELECT * FROM statistics WHERE period_bucket >= ?")) {
      const rest = [...params];
      const bucketMin = rest.shift() as string;
      let out = [...rows.values()].filter((r) => r.period_bucket >= bucketMin);
      if (sql.includes("AND method = ?")) {
        const method = rest.shift() as string;
        out = out.filter((r) => r.method === method);
      }
      if (sql.includes("AND chain_id = ?")) {
        const chainId = rest.shift() as number;
        out = out.filter((r) => r.chain_id === chainId);
      }
      return out;
    }

    if (sql.startsWith("INSERT OR REPLACE INTO statistics")) {
      const [
        method,
        chain_id,
        cache_status,
        period_bucket,
        count,
        error_count,
        total_ms,
        samples,
      ] = params as [string, number, string, string, number, number, number, string];
      rows.set(`${method}|${chain_id}|${cache_status}|${period_bucket}`, {
        method,
        chain_id,
        cache_status,
        period_bucket,
        count,
        error_count,
        total_ms,
        samples,
      });
      return [];
    }

    throw new Error(`FakeSql: unsupported statement: ${sql}`);
  };

  const storage = {
    sql: { exec },
    getAlarm: async () => alarm,
    setAlarm: async (time: number) => {
      alarm = time;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  };

  const state = { storage };
  const instance = new Statistics(state as never, {} as never);
  return { instance, rows };
};

const doRecord = (
  instance: Statistics,
  entry: Partial<StatsRecord> & { method: string; chainId: number }
): Promise<Response> =>
  instance.fetch(
    new Request("http://do/record", {
      method: "POST",
      body: JSON.stringify({
        cacheStatus: "MISS",
        error: false,
        durationMs: 10,
        ...entry,
      }),
    })
  );

const doStats = (instance: Statistics, query = ""): Promise<unknown> =>
  instance.fetch(new Request(`http://do/stats${query}`)).then((r) => r.json());

describe("Statistics Durable Object", () => {
  it("should merge records into the same hourly bucket", async () => {
    const { instance } = createStatisticsDo();

    await doRecord(instance, { method: "eth_getBalance", chainId: 1, durationMs: 10 });
    await doRecord(instance, { method: "eth_getBalance", chainId: 1, durationMs: 20 });

    const stats = (await doStats(instance)) as ReturnType<typeof aggregatePeriods>;
    expect(stats.totalRequests).toBe(2);
    expect(stats.periods).toHaveLength(1);
    expect(stats.periods[0].count).toBe(2);
    expect(stats.periods[0].p50).toBe(10);
    expect(stats.periods[0].p95).toBe(20);
    expect(stats.periods[0].p99).toBe(20);
    expect(stats.averageResponseTime).toBe(15);
  });

  it("should keep HIT and MISS records in separate rows", async () => {
    const { instance } = createStatisticsDo();

    await doRecord(instance, { method: "eth_getBalance", chainId: 1, cacheStatus: "HIT", durationMs: 0 });
    await doRecord(instance, { method: "eth_getBalance", chainId: 1, cacheStatus: "MISS", durationMs: 50 });

    const stats = (await doStats(instance)) as ReturnType<typeof aggregatePeriods>;
    expect(stats.totalRequests).toBe(2);
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheHitRate).toBe(0.5);
    // Average is over upstream calls only
    expect(stats.averageResponseTime).toBe(50);
  });

  it("should filter by hours, method and chainId", async () => {
    const { instance } = createStatisticsDo();
    const now = Date.now();

    await doRecord(instance, { method: "eth_getBalance", chainId: 1, durationMs: 10 });
    await doRecord(instance, {
      method: "eth_getBalance",
      chainId: 1,
      timestamp: now - 3 * 3_600_000,
      durationMs: 20,
    });
    await doRecord(instance, { method: "eth_blockNumber", chainId: 1, durationMs: 30 });
    await doRecord(instance, { method: "eth_getBalance", chainId: 137, durationMs: 40 });

    const oneHour = (await doStats(instance, "?hours=1")) as ReturnType<
      typeof aggregatePeriods
    >;
    expect(oneHour.totalRequests).toBe(3); // old bucket excluded

    const byMethod = (await doStats(
      instance,
      "?hours=24&method=eth_getBalance"
    )) as ReturnType<typeof aggregatePeriods>;
    // Both chain-1 records plus the chain-137 record share the method
    expect(byMethod.totalRequests).toBe(3);

    const byChain = (await doStats(
      instance,
      "?hours=24&chainId=137"
    )) as ReturnType<typeof aggregatePeriods>;
    expect(byChain.totalRequests).toBe(1);
  });

  it("should cap stored samples at SAMPLE_LIMIT", async () => {
    const { instance, rows } = createStatisticsDo();

    for (let i = 1; i <= SAMPLE_LIMIT + 5; i++) {
      await doRecord(instance, {
        method: "eth_getBalance",
        chainId: 1,
        durationMs: i,
      });
    }

    const row = [...rows.values()][0];
    const samples = JSON.parse(row.samples) as number[];
    expect(samples).toHaveLength(SAMPLE_LIMIT);
    expect(samples[0]).toBe(6);
    expect(samples[SAMPLE_LIMIT - 1]).toBe(SAMPLE_LIMIT + 5);
    expect(row.count).toBe(SAMPLE_LIMIT + 5);
  });

  it("should reject invalid record payloads with 400", async () => {
    const { instance } = createStatisticsDo();

    const response = await instance.fetch(
      new Request("http://do/record", {
        method: "POST",
        body: JSON.stringify({ chainId: 1, cacheStatus: "MISS", error: false, durationMs: 1 }),
      })
    );

    expect(response.status).toBe(400);
  });

  it("should purge expired buckets on alarm", async () => {
    const { instance, rows } = createStatisticsDo();
    const now = Date.now();

    await doRecord(instance, {
      method: "eth_getBalance",
      chainId: 1,
      timestamp: now - 40 * 24 * 3_600_000,
    });
    await doRecord(instance, { method: "eth_getBalance", chainId: 1 });
    expect(rows.size).toBe(2);

    await instance.alarm();
    expect(rows.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// App-level: endpoint, handler instrumentation, headers, isolation
// ---------------------------------------------------------------------------

type DedupMode = "hit" | "miss";

const createProxyStateNamespace = (getMode: () => DedupMode) => ({
  idFromName: (name: string) => ({ name }),
  get: () => ({
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/requests") {
        if (getMode() === "hit") {
          return Response.json({
            exists: true,
            request: {
              status: "completed",
              result: JSON.stringify({ result: "0xcached", blockNumber: "0x5" }),
            },
          });
        }
        return Response.json({ exists: false, created: true });
      }
      if (request.method === "PUT" && url.pathname.includes("/complete")) {
        return Response.json({ success: true });
      }
      if (request.method === "PUT" && url.pathname.includes("/fail")) {
        return Response.json({ success: true });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    },
  }),
});

const createStatisticsHarness = () => {
  const records: StatsRecord[] = [];
  const statsRequests: string[] = [];
  const state: { responseBody: unknown } = { responseBody: null };

  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        if (url.pathname === "/record") {
          records.push((await request.json()) as StatsRecord);
          return Response.json({ success: true });
        }
        if (url.pathname === "/stats") {
          statsRequests.push(url.toString());
          return Response.json(
            state.responseBody ?? aggregatePeriods([])
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      },
    }),
  };

  return {
    namespace,
    records,
    statsRequests,
    setStatsResponse: (body: unknown) => {
      state.responseBody = body;
    },
  };
};

const baseEnv = {
  ENVIRONMENT: "test",
  MAX_CACHE_TTL: "3600",
  DEFAULT_CACHE_TTL: "300",
  COMPRESSION_THRESHOLD: "1500",
  FINALIZED_BLOCK_CACHE_TTL: "2592000",
};

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  mockFetch.mockRestore();
});

describe("GET /api/v1/stats", () => {
  it("should forward filters to the statistics DO and return its summary", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();
    const fixture = {
      totalRequests: 5,
      cacheHits: 2,
      cacheHitRate: 0.4,
      averageResponseTime: 12.5,
      errorCount: 1,
      errorRate: 0.2,
      periods: [
        {
          bucket: "2026-08-20T13:00:00.000Z",
          count: 5,
          errorCount: 1,
          p50: 10,
          p95: 20,
          p99: 30,
        },
      ],
    };
    statistics.setStatsResponse(fixture);

    const response = await app.request(
      "/api/v1/stats?chainId=1&method=eth_getBalance&hours=48",
      undefined,
      { ...baseEnv, PROXY_STATE: proxyState, STATISTICS: statistics.namespace } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    expect(statistics.statsRequests).toHaveLength(1);
    expect(statistics.statsRequests[0]).toBe(
      "http://statistics/stats?chainId=1&method=eth_getBalance&hours=48"
    );
    await expect(response.json()).resolves.toEqual(fixture);
  });

  it("should default hours to 24 when omitted", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();

    const response = await app.request("/api/v1/stats", undefined, {
      ...baseEnv,
      PROXY_STATE: proxyState,
      STATISTICS: statistics.namespace,
    } as unknown as WorkerEnv);

    expect(response.status).toBe(200);
    expect(statistics.statsRequests[0]).toContain("hours=24");
  });

  it("should reject invalid hours and chainId with 400", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();
    const env = {
      ...baseEnv,
      PROXY_STATE: proxyState,
      STATISTICS: statistics.namespace,
    } as unknown as WorkerEnv;

    const badHours = await app.request("/api/v1/stats?hours=abc", undefined, env);
    expect(badHours.status).toBe(400);

    const badChain = await app.request("/api/v1/stats?chainId=x", undefined, env);
    expect(badChain.status).toBe(400);
    expect(statistics.statsRequests).toHaveLength(0);
  });

  it("should return an empty summary when the STATISTICS binding is absent", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");

    const response = await app.request("/api/v1/stats", undefined, {
      ...baseEnv,
      PROXY_STATE: proxyState,
    } as unknown as WorkerEnv);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      totalRequests: 0,
      cacheHitRate: 0,
      averageResponseTime: 0,
      errorRate: 0,
      periods: [],
    });
  });

  it("should return 502 when the statistics DO fails", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const broken = {
      idFromName: () => ({ name: "global" }),
      get: () => ({
        fetch: () => Promise.reject(new Error("DO down")),
      }),
    };

    const response = await app.request("/api/v1/stats", undefined, {
      ...baseEnv,
      PROXY_STATE: proxyState,
      STATISTICS: broken,
    } as unknown as WorkerEnv);

    expect(response.status).toBe(502);
  });
});

describe("POST /api/v1/batch", () => {
  it("should be routed on the real app, execute items and record per-item stats", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result: "0x1" }),
    });

    const response = await app.request(
      "/api/v1/batch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            { id: 1, chainId: 1, action: "getBalance", args: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" } },
            { id: 2, chainId: 1, action: "getBlockNumber" },
          ],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.results.map((r: { id: number }) => r.id)).toEqual([1, 2]);
    // Per-item statistics through the shared execution path
    expect(statistics.records.map((r) => r.method)).toEqual([
      "eth_getBalance",
      "eth_blockNumber",
    ]);
  });

  it("should keep observability headers on batch responses", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0" as const, id: 1, result: "0x1" }),
    });

    const response = await app.request(
      "/api/v1/batch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Trace-Id": "batch-trace-01" },
        body: JSON.stringify({
          requests: [{ id: 1, chainId: 1, action: "getBlockNumber" }],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trace-Id")).toBe("batch-trace-01");
    expect(response.headers.get("X-Cache")).toBe("MISS");
  });

  it("should apply MAX_RPC_CONCURRENCY from the environment", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const before = getMaxRpcConcurrency();
    try {
      const response = await app.request(
        "/api/v1/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{ id: 1, chainId: 1, action: "getBlockNumber" }],
          }),
        },
        {
          ...baseEnv,
          MAX_RPC_CONCURRENCY: "3",
          PROXY_STATE: proxyState,
        } as unknown as WorkerEnv
      );

      expect(response.status).toBe(200);
      expect(getMaxRpcConcurrency()).toBe(3);
    } finally {
      setMaxRpcConcurrency(before);
    }
  });
});

describe("Handler statistics instrumentation", () => {
  it("should record a MISS with upstream duration for direct requests", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    });

    const response = await app.request(
      "/api/v1/direct/1/eth_getBalance",
      {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          params: ["0x123", "latest"],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    expect(statistics.records).toHaveLength(1);
    expect(statistics.records[0]).toMatchObject({
      method: "eth_getBalance",
      chainId: 1,
      cacheStatus: "MISS",
      error: false,
    });
    expect(typeof statistics.records[0].durationMs).toBe("number");
    expect(statistics.records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should record an error when the upstream call fails", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch.mockRejectedValue(new Error("network down"));

    const response = await app.request(
      "/api/v1/direct/1/eth_getBalance",
      {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          params: ["0x123", "latest"],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(500);
    expect(statistics.records).toHaveLength(1);
    expect(statistics.records[0]).toMatchObject({
      method: "eth_getBalance",
      cacheStatus: "MISS",
      error: true,
    });
    spy.mockRestore();
  });

  it("should record a HIT and skip upstream on a dedup hit", async () => {
    const mode = { value: "hit" as DedupMode };
    const proxyState = createProxyStateNamespace(() => mode.value);
    const statistics = createStatisticsHarness();

    const params = `u:${encodeURIComponent('["0x123","latest"]')}`;
    const response = await app.request(
      `/api/v1/1/eth_getBalance?p=${encodeURIComponent(params)}`,
      undefined,
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe("0xcached");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(statistics.records).toHaveLength(1);
    expect(statistics.records[0]).toMatchObject({
      method: "eth_getBalance",
      chainId: 1,
      cacheStatus: "HIT",
      error: false,
    });
  });

  it("should record a MISS with upstream call for direct requests through dedup miss", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0xupstream" }),
    });

    const params = `u:${encodeURIComponent('["0x123","latest"]')}`;
    const response = await app.request(
      `/api/v1/1/eth_getBalance?p=${encodeURIComponent(params)}`,
      undefined,
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("0xupstream");
    expect(statistics.records[0]).toMatchObject({
      method: "eth_getBalance",
      chainId: 1,
      cacheStatus: "MISS",
      error: false,
    });
  });

  it("should map action names to RPC methods when recording", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x2" }),
    });

    const response = await app.request(
      "/api/v1/1/getBalance",
      {
        method: "POST",
        body: JSON.stringify({
          address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    expect(statistics.records).toHaveLength(1);
    expect(statistics.records[0]).toMatchObject({
      method: "eth_getBalance",
      chainId: 1,
      cacheStatus: "MISS",
      error: false,
    });
  });

  it("should not fail the main request when statistics writes fail", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const broken = {
      idFromName: () => {
        throw new Error("namespace broken");
      },
      get: () => {
        throw new Error("unreachable");
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    });

    const response = await app.request(
      "/api/v1/direct/1/eth_getBalance",
      {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          params: ["0x123", "latest"],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: broken,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe("0x1");
  });
});

describe("Response observability headers", () => {
  it("should set X-Cache MISS and a generated X-Trace-Id on direct responses", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    });

    const response = await app.request(
      "/api/v1/direct/1/eth_getBalance",
      {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          params: ["0x123", "latest"],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(response.headers.get("X-Trace-Id")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("should echo an incoming X-Trace-Id header", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    });

    const response = await app.request(
      "/api/v1/direct/1/eth_getBalance",
      {
        method: "POST",
        headers: { "X-Trace-Id": "trace-echo-1" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          params: ["0x123", "latest"],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.headers.get("X-Trace-Id")).toBe("trace-echo-1");
  });

  it("should set X-Cache HIT on dedup-hit responses", async () => {
    const proxyState = createProxyStateNamespace(() => "hit");
    const statistics = createStatisticsHarness();

    const params = `u:${encodeURIComponent('["0x123","latest"]')}`;
    const response = await app.request(
      `/api/v1/1/eth_getBalance?p=${encodeURIComponent(params)}`,
      undefined,
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.headers.get("X-Cache")).toBe("HIT");
    expect(response.headers.get("X-Trace-Id")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("should default X-Cache to MISS on error responses", async () => {
    const proxyState = createProxyStateNamespace(() => "miss");
    const statistics = createStatisticsHarness();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch.mockRejectedValue(new Error("network down"));

    const response = await app.request(
      "/api/v1/direct/1/eth_getBalance",
      {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          params: ["0x123", "latest"],
        }),
      },
      {
        ...baseEnv,
        PROXY_STATE: proxyState,
        STATISTICS: statistics.namespace,
      } as unknown as WorkerEnv
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(response.headers.get("X-Trace-Id")).toMatch(/^[0-9a-f]{12}$/);
    spy.mockRestore();
  });
});
