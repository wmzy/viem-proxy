import type {
  CacheStatus,
  MethodMetrics,
  PerformanceMetrics,
  RequestStrategy,
} from "../types";

/** Number of recent response-time samples kept per method (and globally) */
export const DEFAULT_MAX_SAMPLES = 200;

/** A single recorded proxy request outcome */
export type MetricsEntry = {
  /** Proxy action name (e.g. "getBalance") */
  method: string;
  /** Chain id the request targeted */
  chainId: number;
  /** Request strategy used for this call */
  strategy: RequestStrategy;
  /** Whether the proxy request ultimately succeeded (after retries) */
  success: boolean;
  /** Total request duration in ms, including retries */
  responseTime: number;
  /** Cache status observed on the response (`X-Cache` header) */
  cacheStatus: CacheStatus;
  /** Error message when the request failed */
  error?: string;
};

/**
 * A recorded fallback event: a proxy request that failed and fell back
 * to the original RPC. Every fallback means the proxy delivered no
 * value for that request, so these are counted as a first-class
 * observability signal.
 */
export type FallbackEntry = {
  /** Proxy action name (e.g. "getBalance") */
  method: string;
  /** Why the proxy call failed: "network" | "timeout" | "5xx" | "429" | "abort" | "other" */
  reason: string;
};

export type MetricsCollector = {
  record: (entry: MetricsEntry) => void;
  recordFallback: (entry: FallbackEntry) => void;
  getSnapshot: () => PerformanceMetrics;
  reset: () => void;
};

/**
 * Fixed-capacity ring buffer for recent response-time samples.
 * Keeps memory bounded while percentiles stay representative of the
 * most recent traffic.
 */
const createRingBuffer = (capacity: number) => {
  const values: number[] = new Array(capacity);
  let size = 0;
  let next = 0;
  return {
    push: (value: number): void => {
      values[next] = value;
      next = (next + 1) % capacity;
      size = Math.min(size + 1, capacity);
    },
    /** Samples ordered oldest to newest (at most `capacity`) */
    toArray: (): number[] =>
      size < capacity
        ? values.slice(0, size)
        : [...values.slice(next), ...values.slice(0, next)],
  };
};

type MethodState = {
  count: number;
  errorCount: number;
  fallbackCount: number;
  cacheHits: number;
  cacheMisses: number;
  chainIds: Set<number>;
  ring: ReturnType<typeof createRingBuffer>;
};

const createMethodState = (capacity: number): MethodState => ({
  count: 0,
  errorCount: 0,
  fallbackCount: 0,
  cacheHits: 0,
  cacheMisses: 0,
  chainIds: new Set<number>(),
  ring: createRingBuffer(capacity),
});

const emptyStrategyCounts = (): Record<RequestStrategy, number> => ({
  compressed: 0,
  direct: 0,
});

/**
 * Nearest-rank percentile: for ascending-sorted values, the value at
 * rank `ceil(p / 100 * n)`. Returns 0 when there are no samples.
 */
export const percentile = (sortedValues: number[], p: number): number => {
  if (sortedValues.length === 0) return 0;
  const rank = Math.min(
    Math.max(1, Math.ceil((p / 100) * sortedValues.length)),
    sortedValues.length
  );
  return sortedValues[rank - 1];
};

type Counters = {
  count: number;
  errorCount: number;
  fallbackCount: number;
  cacheHits: number;
  cacheMisses: number;
};

/**
 * Derive aggregate stats from counters plus recent samples.
 * `cacheHitRate` counts hits over hits+misses ("unknown" responses are
 * excluded); `errorRate` counts errors over all requests. Response-time
 * statistics are computed over the sampled durations only.
 */
const summarize = (counters: Counters, times: number[]): MethodMetrics => {
  const sorted = [...times].sort((a, b) => a - b);
  const cached = counters.cacheHits + counters.cacheMisses;
  const sum = times.reduce((acc, t) => acc + t, 0);
  return {
    count: counters.count,
    errorCount: counters.errorCount,
    fallbackCount: counters.fallbackCount,
    errorRate: counters.count > 0 ? counters.errorCount / counters.count : 0,
    cacheHits: counters.cacheHits,
    cacheMisses: counters.cacheMisses,
    cacheHitRate: cached > 0 ? counters.cacheHits / cached : 0,
    averageResponseTime: times.length > 0 ? sum / times.length : 0,
    responseTimeP50: percentile(sorted, 50),
    responseTimeP95: percentile(sorted, 95),
    responseTimeP99: percentile(sorted, 99),
  };
};

/**
 * Create an independent metrics collector. Response-time percentiles
 * are derived from the most recent `maxSamples` durations per scope
 * (per method and globally) so memory stays bounded.
 */
export const createMetricsCollector = (
  maxSamples: number = DEFAULT_MAX_SAMPLES
): MetricsCollector => {
  let methods = new Map<string, MethodState>();
  let globalRing = createRingBuffer(maxSamples);
  let strategyCounts = emptyStrategyCounts();
  let fallbackCount = 0;
  let fallbackReasons: Record<string, number> = {};

  const methodState = (method: string): MethodState => {
    const existing = methods.get(method);
    if (existing) return existing;
    const created = createMethodState(maxSamples);
    methods.set(method, created);
    return created;
  };

  return {
    record: ({
      method,
      chainId,
      strategy,
      success,
      responseTime,
      cacheStatus,
    }: MetricsEntry): void => {
      const state = methodState(method);
      state.count += 1;
      state.chainIds.add(chainId);
      state.ring.push(responseTime);
      globalRing.push(responseTime);
      strategyCounts[strategy] += 1;
      if (!success) state.errorCount += 1;
      if (cacheStatus === "hit") state.cacheHits += 1;
      if (cacheStatus === "miss") state.cacheMisses += 1;
    },

    recordFallback: ({ method, reason }: FallbackEntry): void => {
      const state = methodState(method);
      state.fallbackCount += 1;
      fallbackCount += 1;
      fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
    },

    getSnapshot: (): PerformanceMetrics => {
      const methodStats: Record<string, MethodMetrics> = {};
      const chainIds = new Set<number>();
      const totals: Counters = {
        count: 0,
        errorCount: 0,
        fallbackCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
      };
      for (const [method, state] of methods) {
        methodStats[method] = summarize(state, state.ring.toArray());
        totals.count += state.count;
        totals.errorCount += state.errorCount;
        totals.fallbackCount += state.fallbackCount;
        totals.cacheHits += state.cacheHits;
        totals.cacheMisses += state.cacheMisses;
        state.chainIds.forEach((id) => chainIds.add(id));
      }
      const global = summarize(totals, globalRing.toArray());
      return {
        totalRequests: totals.count,
        errorCount: global.errorCount,
        errorRate: global.errorRate,
        fallbackCount,
        fallbackRate: totals.count > 0 ? fallbackCount / totals.count : 0,
        fallbackReasons: Object.fromEntries(
          Object.keys(fallbackReasons)
            .sort()
            .map((reason) => [reason, fallbackReasons[reason]])
        ),
        cacheHits: global.cacheHits,
        cacheMisses: global.cacheMisses,
        cacheHitRate: global.cacheHitRate,
        averageResponseTime: global.averageResponseTime,
        responseTimeP50: global.responseTimeP50,
        responseTimeP95: global.responseTimeP95,
        responseTimeP99: global.responseTimeP99,
        chainIds: [...chainIds].sort((a, b) => a - b),
        strategyCounts: { ...strategyCounts },
        methodStats,
      };
    },

    reset: (): void => {
      methods = new Map();
      globalRing = createRingBuffer(maxSamples);
      strategyCounts = emptyStrategyCounts();
      fallbackCount = 0;
      fallbackReasons = {};
    },
  };
};

let sharedCollector: MetricsCollector | undefined;

/**
 * Get the module-level collector shared by all proxy requests.
 * Instrumentation in `makeProxyRequest` records into this instance.
 */
export const getSharedCollector = (): MetricsCollector => {
  if (!sharedCollector) sharedCollector = createMetricsCollector();
  return sharedCollector;
};

/** Reset the module-level collector, dropping all recorded metrics */
export const resetMetrics = (): void => {
  getSharedCollector().reset();
};

/**
 * Read the cache status from a proxy response's `X-Cache` header.
 * Returns "unknown" when the header is absent — e.g. when the server
 * has not been deployed with cache headers yet, or the request never
 * produced a response (network error).
 */
export const readCacheStatus = (response: Response): CacheStatus => {
  const header =
    typeof response?.headers?.get === "function"
      ? response.headers.get("X-Cache")
      : undefined;
  if (header === "HIT") return "hit";
  if (header === "MISS") return "miss";
  return "unknown";
};
