import {
  describe,
  it,
  expect,
  expectTypeOf,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import type { MockInstance } from "vitest";
import { createPublicClient, http } from "viem";
import { createPublicClient as createProxyPublicClient } from "../client";
import { mainnet } from "viem/chains";
import { proxyActions } from "../actions/proxyActions";
import type { ProxyActions } from "../actions/proxyActions";
import { getBalance } from "../actions/getBalance.client";
import { getBlockNumber } from "../actions/getBlockNumber.client";
import { getBlock } from "../actions/getBlock.client";
import { getTransaction } from "../actions/getTransaction.client";
import { getTransactionReceipt } from "../actions/getTransactionReceipt.client";
import { call } from "../actions/call.client";
import { estimateGas } from "../actions/estimateGas.client";
import { getGasPrice } from "../actions/getGasPrice.client";
import { getLogs } from "../actions/getLogs.client";
import { getCode } from "../actions/getCode.client";
import { getChainId } from "../actions/getChainId.client";
import { getTransactionCount } from "../actions/getTransactionCount.client";
import { getStorageAt } from "../actions/getStorageAt.client";
import { getFeeHistory } from "../actions/getFeeHistory.client";
import { getBlobBaseFee } from "../actions/getBlobBaseFee.client";
import { readContract } from "../actions/readContract.client";
import { batchActions } from "../actions/batch.client";
import type {
  BatchRequest,
  BatchResult,
} from "../actions/batch.client";
import { preheatCache } from "../actions/preheat.client";
import { purgeCache } from "../actions/purge.client";
import { addMiddleware, clearMiddlewares } from "../actions/middleware";
import type { RpcRequest, RpcResponse } from "../types";
import { withProxy, getProxyConfig } from "../proxy";
import {
  configureProxy,
  getProxyDefaults,
  resetProxyDefaults,
  resolveProxyConfig,
} from "../actions/config";
import { resetMetrics, getSharedCollector } from "../utils/metrics";

const originalFetch = global.fetch;

const mockProxyResponse = <T>(result: T) =>
  vi.fn().mockResolvedValueOnce({
    json: () => Promise.resolve({ result, timestamp: Date.now() }),
  });

// viem ≥2.55 的 http transport 用 response.text() 读响应体（并按 Content-Type 解析），
// 裸对象 mock 缺 text()/标准 Headers 会导致请求失败并触发重试放大
const mockDirectRpc = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "content-type": "application/json" },
  });

const PROXY = { endpoint: "https://proxy.example.com" };
// Retry disabled so these tests exercise the fallback-disabled error path directly
// (default config retries 3x before surfacing the failure)
const NO_RETRY = { attempts: 1, delay: 0 };
const PROXY_NO_FALLBACK = {
  endpoint: "https://proxy.example.com",
  fallback: false,
  retryOptions: NO_RETRY,
};

describe("Modular Actions", () => {
  let proxiedClient: ReturnType<typeof createPublicClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    proxiedClient = withProxy(
      createPublicClient({ chain: mainnet, transport: http() }),
      PROXY
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("proxyActions extend pattern", () => {
    it("should extend client with proxy actions", () => {
      const extended = proxyActions(proxiedClient);

      expect(extended.getBalance).toBeDefined();
      expect(extended.getBlock).toBeDefined();
      expect(extended.getBlockNumber).toBeDefined();
      expect(extended.getTransaction).toBeDefined();
      expect(extended.getTransactionReceipt).toBeDefined();
      expect(extended.readContract).toBeDefined();
      expect(extended.call).toBeDefined();
      expect(extended.estimateGas).toBeDefined();
      expect(extended.getGasPrice).toBeDefined();
      expect(extended.getLogs).toBeDefined();
      expect(extended.getCode).toBeDefined();
      expect(extended.getChainId).toBeDefined();
      expect(extended.getTransactionCount).toBeDefined();
      expect(extended.getStorageAt).toBeDefined();
      expect(extended.getFeeHistory).toBeDefined();
      expect(extended.getBlobBaseFee).toBeDefined();
      expect(extended.getCacheStats).toBeDefined();
      expect(extended.resetStats).toBeDefined();
    });

    it("should expose live metrics via getCacheStats and reset via resetStats", async () => {
      resetMetrics();
      global.fetch = vi.fn().mockResolvedValueOnce({
        headers: new Headers({ "X-Cache": "HIT" }),
        json: () => Promise.resolve({ result: "0x1", timestamp: Date.now() }),
      });
      const ext = proxyActions(proxiedClient);

      await ext.getBalance({ address: "0x1234567890123456789012345678901234567890" });

      const stats = ext.getCacheStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.cacheHits).toBe(1);
      expect(stats.methodStats.getBalance.count).toBe(1);

      ext.resetStats();

      const afterReset = ext.getCacheStats();
      expect(afterReset.totalRequests).toBe(0);
      expect(afterReset.methodStats).toEqual({});
    });

    it("should invoke each action through the extended object", async () => {
      const mockFetch = mockProxyResponse("0x1");
      global.fetch = mockFetch;

      const ext = proxyActions(proxiedClient);

      await ext.getBalance({ address: "0x1234567890123456789012345678901234567890" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should invoke getBlock through extended object", async () => {
      global.fetch = mockProxyResponse({ number: "0x1", hash: "0xabc" });
      const ext = proxyActions(proxiedClient);
      const block = await ext.getBlock();
      expect(block).toBeDefined();
    });

    it("should invoke getBlockNumber through extended object", async () => {
      global.fetch = mockProxyResponse("0xff");
      const ext = proxyActions(proxiedClient);
      const bn = await ext.getBlockNumber();
      expect(bn).toBe(255n);
    });

    it("should invoke getGasPrice through extended object", async () => {
      global.fetch = mockProxyResponse("0x3b9aca00");
      const ext = proxyActions(proxiedClient);
      const gp = await ext.getGasPrice();
      expect(gp).toBe(1000000000n);
    });

    it("should invoke getLogs through extended object", async () => {
      global.fetch = mockProxyResponse([]);
      const ext = proxyActions(proxiedClient);
      const logs = await ext.getLogs();
      expect(logs).toEqual([]);
    });

    it("should invoke getCode through extended object", async () => {
      global.fetch = mockProxyResponse("0x6080");
      const ext = proxyActions(proxiedClient);
      const code = await ext.getCode({ address: "0x1234567890123456789012345678901234567890" });
      expect(code).toBe("0x6080");
    });

    it("should invoke call through extended object", async () => {
      global.fetch = mockProxyResponse({ data: "0xdeadbeef" });
      const ext = proxyActions(proxiedClient);
      const res = await ext.call({ to: "0x1234567890123456789012345678901234567890" });
      expect(res.data).toBe("0xdeadbeef");
    });

    it("should invoke estimateGas through extended object", async () => {
      global.fetch = mockProxyResponse("0x5208");
      const ext = proxyActions(proxiedClient);
      const gas = await ext.estimateGas({ to: "0x1234567890123456789012345678901234567890" });
      expect(gas).toBe(21000n);
    });

    it("should invoke readContract through extended object", async () => {
      global.fetch = mockProxyResponse("0x0000000000000000000000000000000000000000000000000000000000000012");
      const ext = proxyActions(proxiedClient);
      const result = await ext.readContract({
        address: "0x1234567890123456789012345678901234567890",
        abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8", name: "" }], stateMutability: "view" }],
        functionName: "decimals",
      });
      expect(result).toBe(18);
    });

    it("should invoke getTransaction through extended object", async () => {
      global.fetch = mockProxyResponse({ hash: "0xabc", blockNumber: "0x1" });
      const ext = proxyActions(proxiedClient);
      const tx = await ext.getTransaction({ hash: "0x1234567890123456789012345678901234567890123456789012345678901234" });
      expect(tx).toBeDefined();
    });

    it("should invoke getTransactionReceipt through extended object", async () => {
      global.fetch = mockProxyResponse({ transactionHash: "0xabc", status: "0x1" });
      const ext = proxyActions(proxiedClient);
      const receipt = await ext.getTransactionReceipt({ hash: "0x1234567890123456789012345678901234567890123456789012345678901234" });
      expect(receipt).toBeDefined();
    });

    it("should invoke getChainId through extended object", async () => {
      global.fetch = mockProxyResponse("0x1");
      const ext = proxyActions(proxiedClient);
      const id = await ext.getChainId();
      expect(id).toBe(1);
    });

    it("should invoke getTransactionCount through extended object", async () => {
      global.fetch = mockProxyResponse("0x9");
      const ext = proxyActions(proxiedClient);
      const count = await ext.getTransactionCount({ address: "0x1234567890123456789012345678901234567890" });
      expect(count).toBe(9);
    });

    it("should invoke getStorageAt through extended object", async () => {
      global.fetch = mockProxyResponse("0x0000000000000000000000000000000000000000000000000000000000000004");
      const ext = proxyActions(proxiedClient);
      const value = await ext.getStorageAt({ address: "0x1234567890123456789012345678901234567890", slot: 0n });
      expect(value).toBe("0x0000000000000000000000000000000000000000000000000000000000000004");
    });

    it("should invoke getFeeHistory through extended object", async () => {
      global.fetch = mockProxyResponse({
        oldestBlock: "0x5",
        baseFeePerGas: ["0x1", "0x2"],
        gasUsedRatio: [0.5, 0.6],
        reward: [["0x3", "0x4"], ["0x5", "0x6"]],
      });
      const ext = proxyActions(proxiedClient);
      const history = await ext.getFeeHistory({ blockCount: 4, rewardPercentiles: [25, 75] });
      expect(history.oldestBlock).toBe(5n);
      expect(history.baseFeePerGas).toEqual([1n, 2n]);
      expect(history.gasUsedRatio).toEqual([0.5, 0.6]);
      expect(history.reward).toEqual([[3n, 4n], [5n, 6n]]);
    });

    it("should invoke getBlobBaseFee through extended object", async () => {
      global.fetch = mockProxyResponse("0x3e8");
      const ext = proxyActions(proxiedClient);
      const fee = await ext.getBlobBaseFee();
      expect(fee).toBe(1000n);
    });
  });

  describe("standalone action usage", () => {
    it("should call getBalance with proxy config via GET", async () => {
      global.fetch = mockProxyResponse("0x1234");

      const balance = await getBalance(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
      });

      expect(balance).toBe(BigInt("0x1234"));
      const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain("https://proxy.example.com/api/v1/1/getBalance");
      expect(url).toContain("?p=");
      expect(opts.method).toBe("GET");
    });

    it("should call getBlockNumber with proxy config via GET", async () => {
      global.fetch = mockProxyResponse("0xabcdef");

      const blockNumber = await getBlockNumber(proxiedClient);

      expect(blockNumber).toBe(BigInt("0xabcdef"));
      const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain("?p=");
      expect(opts.method).toBe("GET");
    });

    it("should include API key header when configured", async () => {
      global.fetch = mockProxyResponse("0x1234");

      const clientWithKey = withProxy(
        createPublicClient({ chain: mainnet, transport: http() }),
        { ...PROXY, apiKey: "test-key-123" }
      );

      await getBalance(clientWithKey, {
        address: "0x1234567890123456789012345678901234567890",
      });

      const [, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.headers?.["X-API-Key"]).toBe("test-key-123");
    });

    it("should call getBlock with proxy", async () => {
      global.fetch = mockProxyResponse({ number: "0x1", hash: "0xabc", transactions: [] });

      const block = await getBlock(proxiedClient, { blockTag: "latest" });
      expect(block).toBeDefined();
    });

    it("should call getBlock with blockNumber", async () => {
      global.fetch = mockProxyResponse({ number: "0xa", hash: "0xdef", transactions: [] });

      const block = await getBlock(proxiedClient, { blockNumber: 10n });
      expect(block).toBeDefined();
    });

    it("should call getTransaction with proxy", async () => {
      global.fetch = mockProxyResponse({ hash: "0xabc", blockNumber: "0x1" });

      const tx = await getTransaction(proxiedClient, {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(tx).toBeDefined();
    });

    it("should call getTransactionReceipt with proxy", async () => {
      global.fetch = mockProxyResponse({ transactionHash: "0xabc", status: "0x1" });

      const receipt = await getTransactionReceipt(proxiedClient, {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(receipt).toBeDefined();
    });

    it("should call call with proxy", async () => {
      global.fetch = mockProxyResponse({ data: "0xdeadbeef" });

      const result = await call(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        data: "0x70a08231",
      });
      expect(result.data).toBe("0xdeadbeef");
    });

    it("should call call with account as string", async () => {
      global.fetch = mockProxyResponse({ data: "0x01" });

      const result = await call(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      expect(result).toBeDefined();
    });

    it("should call call with account as object", async () => {
      global.fetch = mockProxyResponse({ data: "0x01" });

      const result = await call(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        account: { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      });
      expect(result).toBeDefined();
    });

    it("should call estimateGas with proxy", async () => {
      global.fetch = mockProxyResponse("0x5208");

      const gas = await estimateGas(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        value: 1000n,
      });
      expect(gas).toBe(21000n);
    });

    it("should call estimateGas with account", async () => {
      global.fetch = mockProxyResponse("0x5208");

      const gas = await estimateGas(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      expect(gas).toBe(21000n);
    });

    it("should call call with all optional params", async () => {
      global.fetch = mockProxyResponse({ data: "0x01" });

      const result = await call(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        data: "0x70a08231",
        gas: 21000n,
        gasPrice: 1000000000n,
        value: 0n,
        blockTag: "latest",
        blockNumber: 100n,
      });
      expect(result).toBeDefined();

      const [, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.method).toBe("GET");
    });

    it("should call estimateGas with all optional params", async () => {
      global.fetch = mockProxyResponse("0x5208");

      const gas = await estimateGas(proxiedClient, {
        to: "0x1234567890123456789012345678901234567890",
        data: "0x70a08231",
        gas: 21000n,
        gasPrice: 1000000000n,
        value: 0n,
        account: { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      });
      expect(gas).toBe(21000n);
    });

    it("should call getGasPrice with proxy", async () => {
      global.fetch = mockProxyResponse("0x3b9aca00");

      const price = await getGasPrice(proxiedClient);
      expect(price).toBe(1000000000n);
    });

    it("should call getLogs with proxy", async () => {
      global.fetch = mockProxyResponse([]);

      const logs = await getLogs(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
        fromBlock: 100n,
        toBlock: 200n,
      });
      expect(logs).toEqual([]);
    });

    it("should call getCode with proxy", async () => {
      global.fetch = mockProxyResponse("0x608060");

      const code = await getCode(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
        blockNumber: 100n,
      });
      expect(code).toBe("0x608060");
    });

    it("should call readContract with proxy", async () => {
      global.fetch = mockProxyResponse("0x0000000000000000000000000000000000000000000000000000000000000012");

      const result = await readContract(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
        abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8", name: "" }], stateMutability: "view" }],
        functionName: "decimals",
      });
      expect(result).toBe(18);
    });

    it("should call getChainId with proxy via GET", async () => {
      global.fetch = mockProxyResponse("0x1");

      const id = await getChainId(proxiedClient);

      expect(id).toBe(1);
      const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain("https://proxy.example.com/api/v1/1/getChainId");
      expect(url).toContain("?p=");
      expect(opts.method).toBe("GET");
    });

    it("should call getTransactionCount with proxy and convert hex to number", async () => {
      global.fetch = mockProxyResponse("0x2a");

      const count = await getTransactionCount(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
      });

      expect(count).toBe(42);
    });

    it("should serialize a bigint slot to hex for getStorageAt", async () => {
      global.fetch = mockProxyResponse("0x1234");

      const value = await getStorageAt(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
        slot: 69n,
      });

      expect(value).toBe("0x1234");
      const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain("/api/v1/1/getStorageAt");
      expect(opts.method).toBe("GET");
    });

    it("should pass a hex slot through for getStorageAt", async () => {
      global.fetch = mockProxyResponse("0xabcd");

      const value = await getStorageAt(proxiedClient, {
        address: "0x1234567890123456789012345678901234567890",
        slot: "0xdeadbeef",
      });

      expect(value).toBe("0xabcd");
    });

    it("should call getFeeHistory with proxy and format bigints", async () => {
      global.fetch = mockProxyResponse({
        oldestBlock: "0x5",
        baseFeePerGas: ["0x1", "0x2"],
        gasUsedRatio: [0.5, 0.6],
        reward: [["0x3", "0x4"], ["0x5", "0x6"]],
      });

      const history = await getFeeHistory(proxiedClient, {
        blockCount: 2,
        rewardPercentiles: [25, 75],
      });

      expect(history).toEqual({
        baseFeePerGas: [1n, 2n],
        gasUsedRatio: [0.5, 0.6],
        oldestBlock: 5n,
        reward: [[3n, 4n], [5n, 6n]],
      });
    });

    it("should omit reward when absent from fee history", async () => {
      global.fetch = mockProxyResponse({
        oldestBlock: "0x5",
        baseFeePerGas: ["0x1"],
        gasUsedRatio: [0.5],
      });

      const history = await getFeeHistory(proxiedClient, { blockCount: 1 });

      expect(history.oldestBlock).toBe(5n);
      expect(history.baseFeePerGas).toEqual([1n]);
      expect(history.reward).toBeUndefined();
    });

    it("should call getBlobBaseFee with proxy", async () => {
      global.fetch = mockProxyResponse("0x3e8");

      const fee = await getBlobBaseFee(proxiedClient);
      expect(fee).toBe(1000n);
    });
  });

  describe("fallback behavior for all actions", () => {
    const makeRpcClient = () => withProxy(
      createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
      { ...PROXY, fallback: true, retryOptions: NO_RETRY }
    );

    it("getBalance should fall back only after retries are exhausted", async () => {
      const client = withProxy(
        createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
        { ...PROXY, fallback: true, retryOptions: { attempts: 3, delay: 1 } }
      );
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n <= 3) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x1"));
      });

      const balance = await getBalance(client, {
        address: "0x1234567890123456789012345678901234567890",
      });

      // 3 proxy attempts (retries exhausted) + 1 direct RPC fallback call
      expect(global.fetch).toHaveBeenCalledTimes(4);
      expect(balance).toBe(1n);
    });

    it("getBlock should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({ number: "0x1", hash: "0xabc", transactions: [] }));
      });
      const block = await getBlock(makeRpcClient());
      expect(block).toBeDefined();
    });

    it("getTransaction should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({ hash: "0xabc", blockNumber: "0x1" }));
      });
      const tx = await getTransaction(makeRpcClient(), {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(tx).toBeDefined();
    });

    it("getTransactionReceipt should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({ transactionHash: "0xabc", status: "0x1", blockNumber: "0x1", logs: [] }));
      });
      const receipt = await getTransactionReceipt(makeRpcClient(), {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(receipt).toBeDefined();
    });

    it("call should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0xdeadbeef"));
      });
      const result = await call(makeRpcClient(), {
        to: "0x1234567890123456789012345678901234567890",
      });
      expect(result).toBeDefined();
    });

    it("estimateGas should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x5208"));
      });
      const gas = await estimateGas(makeRpcClient(), {
        to: "0x1234567890123456789012345678901234567890",
      });
      expect(gas).toBeDefined();
    });

    it("getGasPrice should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x3b9aca00"));
      });
      const price = await getGasPrice(makeRpcClient());
      expect(price).toBeDefined();
    });

    it("getLogs should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc([]));
      });
      const logs = await getLogs(makeRpcClient());
      expect(logs).toBeDefined();
    });

    it("getCode should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x6080"));
      });
      const code = await getCode(makeRpcClient(), {
        address: "0x1234567890123456789012345678901234567890",
      });
      expect(code).toBeDefined();
    });

    it("readContract should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x0000000000000000000000000000000000000000000000000000000000000012"));
      });
      const result = await readContract(makeRpcClient(), {
        address: "0x1234567890123456789012345678901234567890",
        abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8", name: "" }], stateMutability: "view" }],
        functionName: "decimals",
      });
      expect(result).toBe(18);
    });

    it("getBlockNumber should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0xff"));
      });
      const bn = await getBlockNumber(makeRpcClient());
      expect(bn).toBe(255n);
    });

    it("getChainId should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x1"));
      });
      const id = await getChainId(makeRpcClient());
      expect(id).toBe(1);
    });

    it("getTransactionCount should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x9"));
      });
      const count = await getTransactionCount(makeRpcClient(), {
        address: "0x1234567890123456789012345678901234567890",
      });
      expect(count).toBe(9);
    });

    it("getStorageAt should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x1234"));
      });
      const value = await getStorageAt(makeRpcClient(), {
        address: "0x1234567890123456789012345678901234567890",
        slot: "0x0",
      });
      expect(value).toBe("0x1234");
    });

    it("getFeeHistory should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({
          oldestBlock: "0x5",
          baseFeePerGas: ["0x1"],
          gasUsedRatio: [0.5],
        }));
      });
      const history = await getFeeHistory(makeRpcClient(), { blockCount: 1 });
      expect(history.oldestBlock).toBe(5n);
      expect(history.baseFeePerGas).toEqual([1n]);
    });

    it("getBlobBaseFee should fallback on proxy error", async () => {
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x2a"));
      });
      const fee = await getBlobBaseFee(makeRpcClient());
      expect(fee).toBe(42n);
    });
  });

  describe("fallback metrics", () => {
    const makeClient = (opts: Record<string, unknown> = {}) => withProxy(
      createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
      { ...PROXY, fallback: true, retryOptions: NO_RETRY, ...opts }
    );

    it("should count a fallback once per request even after retries are exhausted", async () => {
      resetMetrics();
      const client = withProxy(
        createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
        { ...PROXY, fallback: true, retryOptions: { attempts: 3, delay: 0 } }
      );
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce(mockDirectRpc("0x1"));

      const balance = await getBalance(client, { address: "0x1234567890123456789012345678901234567890" });
      expect(balance).toBe(1n);

      const stats = getSharedCollector().getSnapshot();
      // 3 proxy attempts (retries exhausted) collapsed into ONE fallback event
      expect(stats.fallbackCount).toBe(1);
      expect(stats.totalRequests).toBe(1);
      expect(stats.fallbackRate).toBe(1);
      expect(stats.methodStats.getBalance.fallbackCount).toBe(1);
    });

    it("should classify network failures as network", async () => {
      resetMetrics();
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(mockDirectRpc("0x1"));

      await getBalance(makeClient(), { address: "0x1234567890123456789012345678901234567890" });

      expect(getSharedCollector().getSnapshot().fallbackReasons).toEqual({ network: 1 });
    });

    it("should classify 5xx and 429 statuses by response code", async () => {
      resetMetrics();
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ status: 500, headers: new Headers(), json: () => Promise.resolve({}) })
        .mockResolvedValueOnce(mockDirectRpc("0x1"));
      await getBalance(makeClient(), { address: "0x1234567890123456789012345678901234567890" });

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ status: 429, headers: new Headers(), json: () => Promise.resolve({}) })
        .mockResolvedValueOnce(mockDirectRpc("0x1"));
      await getBalance(makeClient(), { address: "0x1234567890123456789012345678901234567890" });

      expect(getSharedCollector().getSnapshot().fallbackReasons).toEqual({ "429": 1, "5xx": 1 });
    });

    it("should keep successful requests free of fallback metrics", async () => {
      resetMetrics();
      global.fetch = mockProxyResponse("0x1");

      await getBalance(makeClient(), { address: "0x1234567890123456789012345678901234567890" });

      const stats = getSharedCollector().getSnapshot();
      expect(stats.totalRequests).toBe(1);
      expect(stats.fallbackCount).toBe(0);
      expect(stats.fallbackRate).toBe(0);
      expect(stats.fallbackReasons).toEqual({});
    });

    it("should not record a fallback when fallback is disabled", async () => {
      resetMetrics();
      const client = withProxy(
        createPublicClient({ chain: mainnet, transport: http() }),
        PROXY_NO_FALLBACK
      );
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fetch failed"));

      await expect(getBalance(client, {
        address: "0x1234567890123456789012345678901234567890",
      })).rejects.toThrow("fetch failed");

      const stats = getSharedCollector().getSnapshot();
      expect(stats.fallbackCount).toBe(0);
      expect(stats.fallbackReasons).toEqual({});
    });

    it("should expose fallback fields via getCacheStats and clear them on resetStats", async () => {
      resetMetrics();
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(mockDirectRpc("0x1"));
      const ext = proxyActions(makeClient());

      await ext.getBalance({ address: "0x1234567890123456789012345678901234567890" });

      const stats = ext.getCacheStats();
      expect(stats.fallbackCount).toBe(1);
      expect(stats.fallbackRate).toBe(1);
      expect(stats.fallbackReasons).toEqual({ network: 1 });

      ext.resetStats();
      const after = ext.getCacheStats();
      expect(after.fallbackCount).toBe(0);
      expect(after.fallbackRate).toBe(0);
      expect(after.fallbackReasons).toEqual({});
    });
  });

  describe("no-fallback throws for all actions", () => {
    const makeNoFallbackClient = () => withProxy(
      createPublicClient({ chain: mainnet, transport: http() }),
      PROXY_NO_FALLBACK
    );

    it("getBalance should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getBalance(makeNoFallbackClient(), {
        address: "0x1234567890123456789012345678901234567890",
      })).rejects.toThrow("fail");
    });

    it("getBlockNumber should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getBlockNumber(makeNoFallbackClient())).rejects.toThrow("fail");
    });

    it("getBlock should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getBlock(makeNoFallbackClient())).rejects.toThrow("fail");
    });

    it("getTransaction should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getTransaction(makeNoFallbackClient(), {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      })).rejects.toThrow("fail");
    });

    it("getTransactionReceipt should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getTransactionReceipt(makeNoFallbackClient(), {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      })).rejects.toThrow("fail");
    });

    it("call should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(call(makeNoFallbackClient(), {
        to: "0x1234567890123456789012345678901234567890",
      })).rejects.toThrow("fail");
    });

    it("estimateGas should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(estimateGas(makeNoFallbackClient(), {
        to: "0x1234567890123456789012345678901234567890",
      })).rejects.toThrow("fail");
    });

    it("getGasPrice should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getGasPrice(makeNoFallbackClient())).rejects.toThrow("fail");
    });

    it("getLogs should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getLogs(makeNoFallbackClient())).rejects.toThrow("fail");
    });

    it("getCode should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getCode(makeNoFallbackClient(), {
        address: "0x1234567890123456789012345678901234567890",
      })).rejects.toThrow("fail");
    });

    it("readContract should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(readContract(makeNoFallbackClient(), {
        address: "0x1234567890123456789012345678901234567890",
        abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8", name: "" }], stateMutability: "view" }],
        functionName: "decimals",
      })).rejects.toThrow("fail");
    });

    it("getChainId should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getChainId(makeNoFallbackClient())).rejects.toThrow("fail");
    });

    it("getTransactionCount should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getTransactionCount(makeNoFallbackClient(), {
        address: "0x1234567890123456789012345678901234567890",
      })).rejects.toThrow("fail");
    });

    it("getStorageAt should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getStorageAt(makeNoFallbackClient(), {
        address: "0x1234567890123456789012345678901234567890",
        slot: "0x0",
      })).rejects.toThrow("fail");
    });

    it("getFeeHistory should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getFeeHistory(makeNoFallbackClient(), {
        blockCount: 1,
      })).rejects.toThrow("fail");
    });

    it("getBlobBaseFee should throw when fallback disabled", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("fail"));
      await expect(getBlobBaseFee(makeNoFallbackClient())).rejects.toThrow("fail");
    });
  });

  describe("chain fallback to id 1", () => {
    it("should default to chainId 1 when client has no chain", async () => {
      global.fetch = mockProxyResponse("0x1234");
      const noChainClient = withProxy(
        createPublicClient({ transport: http("https://dummy.rpc.com") }),
        PROXY
      );

      await getBalance(noChainClient, {
        address: "0x1234567890123456789012345678901234567890",
      });

      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain("/api/v1/1/getBalance");
    });
  });

  describe("debug fallback logging", () => {
    let logSpy: MockInstance;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    const makeDebugClient = () => withProxy(
      createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
      { ...PROXY, fallback: true, debug: true, retryOptions: NO_RETRY }
    );

    it("should log fallback warning when debug is enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("proxy down"));
        return Promise.resolve(mockDirectRpc("0x1"));
      });

      await getBalance(makeDebugClient(), {
        address: "0x1234567890123456789012345678901234567890",
      });

      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getBlock with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({ number: "0x1", hash: "0xabc", transactions: [] }));
      });

      await getBlock(makeDebugClient());
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getBlockNumber with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0xff"));
      });

      await getBlockNumber(makeDebugClient());
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for call with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0xdeadbeef"));
      });

      await call(makeDebugClient(), {
        to: "0x1234567890123456789012345678901234567890",
      });
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for estimateGas with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x5208"));
      });

      await estimateGas(makeDebugClient(), {
        to: "0x1234567890123456789012345678901234567890",
      });
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getGasPrice with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x3b9aca00"));
      });

      await getGasPrice(makeDebugClient());
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getLogs with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc([]));
      });

      await getLogs(makeDebugClient());
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getCode with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x6080"));
      });

      await getCode(makeDebugClient(), {
        address: "0x1234567890123456789012345678901234567890",
      });
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getTransaction with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({ hash: "0xabc", blockNumber: "0x1" }));
      });

      await getTransaction(makeDebugClient(), {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for getTransactionReceipt with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc({ transactionHash: "0xabc", status: "0x1", blockNumber: "0x1", logs: [] }));
      });

      await getTransactionReceipt(makeDebugClient(), {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });

    it("should log fallback for readContract with debug", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        if (++n === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(mockDirectRpc("0x0000000000000000000000000000000000000000000000000000000000000012"));
      });

      await readContract(makeDebugClient(), {
        address: "0x1234567890123456789012345678901234567890",
        abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8", name: "" }], stateMutability: "view" }],
        functionName: "decimals",
      });
      expect(warnSpy).toHaveBeenCalledWith("[viem-proxy] Fallback to direct RPC:", expect.any(Error));
      warnSpy.mockRestore();
    });
  });

  describe("direct viem calls without proxy", () => {
    const rpcClient = createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") });

    it("should use direct viem call when no proxy config on client", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x9999"));
      const balance = await getBalance(rpcClient, {
        address: "0x1234567890123456789012345678901234567890",
      });
      expect(balance).toBe(BigInt("0x9999"));
    });

    it("getBlock without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc({ number: "0x1", hash: "0xabc", transactions: [] }));
      const block = await getBlock(rpcClient);
      expect(block).toBeDefined();
    });

    it("getGasPrice without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x3b9aca00"));
      const price = await getGasPrice(rpcClient);
      expect(price).toBeDefined();
    });

    it("getLogs without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc([]));
      const logs = await getLogs(rpcClient);
      expect(logs).toBeDefined();
    });

    it("call without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0xdeadbeef"));
      const result = await call(rpcClient, { to: "0x1234567890123456789012345678901234567890" });
      expect(result).toBeDefined();
    });

    it("estimateGas without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x5208"));
      const gas = await estimateGas(rpcClient, { to: "0x1234567890123456789012345678901234567890" });
      expect(gas).toBeDefined();
    });

    it("getCode without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x6080"));
      const code = await getCode(rpcClient, { address: "0x1234567890123456789012345678901234567890" });
      expect(code).toBeDefined();
    });

    it("getTransaction without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc({ hash: "0xabc", blockNumber: "0x1" }));
      const tx = await getTransaction(rpcClient, {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(tx).toBeDefined();
    });

    it("getTransactionReceipt without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc({ transactionHash: "0xabc", status: "0x1", blockNumber: "0x1", logs: [] }));
      const receipt = await getTransactionReceipt(rpcClient, {
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      });
      expect(receipt).toBeDefined();
    });

    it("readContract without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x0000000000000000000000000000000000000000000000000000000000000012"));
      const result = await readContract(rpcClient, {
        address: "0x1234567890123456789012345678901234567890",
        abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8", name: "" }], stateMutability: "view" }],
        functionName: "decimals",
      });
      expect(result).toBe(18);
    });

    it("getBlockNumber without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0xff"));
      const bn = await getBlockNumber(rpcClient);
      expect(bn).toBe(255n);
    });

    it("getChainId without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x1"));
      const id = await getChainId(rpcClient);
      expect(id).toBe(1);
    });

    it("getTransactionCount without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x9"));
      const count = await getTransactionCount(rpcClient, {
        address: "0x1234567890123456789012345678901234567890",
      });
      expect(count).toBe(9);
    });

    it("getStorageAt without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x1234"));
      const value = await getStorageAt(rpcClient, {
        address: "0x1234567890123456789012345678901234567890",
        slot: "0x0",
      });
      expect(value).toBe("0x1234");
    });

    it("getFeeHistory without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc({
        oldestBlock: "0x5",
        baseFeePerGas: ["0x1", "0x2"],
        gasUsedRatio: [0.5, 0.6],
        reward: [["0x3", "0x4"], ["0x5", "0x6"]],
      }));
      const history = await getFeeHistory(rpcClient, {
        blockCount: 2,
        rewardPercentiles: [25, 75],
      });
      expect(history.oldestBlock).toBe(5n);
      expect(history.baseFeePerGas).toEqual([1n, 2n]);
      expect(history.reward).toEqual([[3n, 4n], [5n, 6n]]);
    });

    it("getBlobBaseFee without proxy should call viem directly", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x2a"));
      const fee = await getBlobBaseFee(rpcClient);
      expect(fee).toBe(42n);
    });
  });

  describe("batch requests", () => {
    const ADDRESS = "0x1234567890123456789012345678901234567890";
    const proxyResponse = (result: unknown) => ({
      json: () => Promise.resolve({ result, timestamp: Date.now() }),
    });
    const batchResponse = (results: unknown[]) => ({
      headers: new Headers({ "X-Cache": "MISS" }),
      json: () => Promise.resolve({ results }),
    });

    it("should send all items in one POST to the batch endpoint", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          batchResponse([{ id: 1, result: "0x1" }, { id: 2, result: "0xff" }])
        );
      global.fetch = fetchMock;

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBlockNumber" },
        ],
        PROXY
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://proxy.example.com/api/v1/batch");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["X-Trace-Id"]).toMatch(
        /^[0-9a-f]{12}$/
      );
      expect(JSON.parse(init.body as string)).toEqual({
        requests: [
          { id: 1, chainId: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, chainId: 1, action: "getBlockNumber", args: {} },
        ],
      });
      expect(results).toEqual([
        { id: 1, result: BigInt("0x1") },
        { id: 2, result: BigInt("0xff") },
      ]);
    });

    it("should use per-item chainId overrides", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: "a", result: "0x1" }]));
      global.fetch = fetchMock;

      await batchActions(
        [{ id: "a", action: "getBalance", args: { address: ADDRESS }, chainId: 137 }],
        PROXY
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.requests[0].chainId).toBe(137);
    });

    it("should preserve per-item errors in order", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        batchResponse([
          { id: 1, result: "0x1" },
          { id: 2, error: { code: -32603, message: "boom" } },
        ])
      );

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBalance", args: { address: ADDRESS } },
        ],
        PROXY
      );

      expect(results[0]).toEqual({ id: 1, result: BigInt("0x1") });
      expect(results[1].result).toBeUndefined();
      expect(results[1].error).toEqual({ code: -32603, message: "boom" });
    });

    it("should degrade to serial single requests when the batch endpoint fails", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("batch down"))
        .mockResolvedValueOnce(proxyResponse("0x11"))
        .mockResolvedValueOnce(proxyResponse("0x22"));
      global.fetch = fetchMock;

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBalance", args: { address: ADDRESS } },
        ],
        { ...PROXY, retryOptions: NO_RETRY }
      );

      // 1 failed batch attempt + 2 serial single requests
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toContain("/api/v1/1/getBalance");
      expect(fetchMock.mock.calls[2][0]).toContain("/api/v1/1/getBalance");
      expect(results).toEqual([
        { id: 1, result: BigInt("0x11") },
        { id: 2, result: BigInt("0x22") },
      ]);
    });

    it("should isolate item failures in the serial fallback", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ status: 500 }) // batch endpoint fails (non-retryable path exhausted)
        .mockResolvedValueOnce(proxyResponse("0x1"))
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ error: { code: -32603, message: "upstream boom" } }),
        });
      global.fetch = fetchMock;

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBalance", args: { address: ADDRESS } },
        ],
        { ...PROXY, retryOptions: NO_RETRY }
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(results[0]).toEqual({ id: 1, result: BigInt("0x1") });
      expect(results[1].error?.message).toBe("Proxy error: upstream boom");
    });

    it("should return an empty array for an empty batch without fetching", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const results = await batchActions([], PROXY);

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should record per-item metrics for a successful batch", async () => {
      resetMetrics();
      global.fetch = vi.fn().mockResolvedValueOnce(
        batchResponse([{ id: 1, result: "0x1" }, { id: 2, result: "0x2" }])
      );

      await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBlockNumber" },
        ],
        PROXY
      );

      const stats = getSharedCollector().getSnapshot();
      expect(stats.totalRequests).toBe(2);
      expect(stats.methodStats.getBalance.count).toBe(1);
      expect(stats.methodStats.getBlockNumber.count).toBe(1);
      resetMetrics();
    });

    it("should expose batchProxy() on the extended actions object", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: "a", result: "0x9" }]));
      global.fetch = fetchMock;
      const ext = proxyActions(proxiedClient);

      const results = await ext.batchProxy([
        { id: "a", action: "getGasPrice" },
      ]);

      // Client chain (mainnet) is used as the default item chain
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.requests[0]).toEqual({
        id: "a",
        chainId: 1,
        action: "getGasPrice",
        args: {},
      });
      expect(results).toEqual([{ id: "a", result: BigInt("0x9") }]);
    });

    it("should run items natively when the client has no proxy config", async () => {
      const plainClient = createPublicClient({
        chain: mainnet,
        transport: http("https://eth.llamarpc.com"),
      });
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x9999"));

      const results = await proxyActions(plainClient).batchProxy([
        { id: 1, action: "getBalance", args: { address: ADDRESS } },
      ]);

      expect(results).toEqual([{ id: 1, result: BigInt("0x9999") }]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should keep batchProxy through viem's client.extend (no key stripping)", async () => {
      // viem's `extend` deletes extension keys that collide with core
      // client properties (`batch` is a core config key — the old name
      // was stripped at runtime); `batchProxy` must survive. The `as any`
      // bridge only works around the pre-existing strict-mode signature
      // gap of the full actions object (tracked separately); the extend
      // call itself is the real viem runtime path.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: 1, result: "0x5" }]));
      global.fetch = fetchMock;

      const base = createPublicClient({
        chain: mainnet,
        transport: http("https://eth.llamarpc.com"),
      });
      const extended = (base as any).extend(
        proxyActions({ ...PROXY, retryOptions: { attempts: 1, delay: 0 } })
      ) as typeof base & ProxyActions;

      expect(typeof extended.batchProxy).toBe("function");

      const results = await extended.batchProxy([
        { id: 1, action: "getGasPrice" },
      ]);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://proxy.example.com/api/v1/batch");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string).requests[0]).toEqual({
        id: 1,
        chainId: 1,
        action: "getGasPrice",
        args: {},
      });
      expect(results).toEqual([{ id: 1, result: BigInt("0x5") }]);
    });

    it("should infer each item's result type from its action", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        batchResponse([
          { id: 1, result: "0x1" },
          { id: 2, result: "0x42" },
          { id: 3, result: "0x89" },
        ])
      );

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBlockNumber" },
          { id: 3, action: "getChainId" },
        ],
        PROXY
      );

      // Positional inference: each entry follows its item's action
      expectTypeOf(results[0].result).toEqualTypeOf<bigint | undefined>();
      expectTypeOf(results[1].result).toEqualTypeOf<bigint | undefined>();
      expectTypeOf(results[2].result).toEqualTypeOf<number | undefined>();
      // @ts-expect-error -- getBalance results are bigint, not number
      expectTypeOf(results[0].result).toEqualTypeOf<number | undefined>();
      // The result list is a mapped tuple aligned with the request items
      expectTypeOf(results).toEqualTypeOf<
        readonly [
          BatchResult<"getBalance">,
          BatchResult<"getBlockNumber">,
          BatchResult<"getChainId">
        ]
      >();

      // Runtime matches the types: wire hex quantities are decoded to the
      // viem value each entry is typed with
      expect(results).toEqual([
        { id: 1, result: 1n },
        { id: 2, result: 66n },
        { id: 3, result: 137 },
      ]);
    });

    it("should type item args per action and infer single-typed batches", async () => {
      // Compile-time only: never invoked, so no fetch mock is consumed
      const typeLevel = () =>
        batchActions(
          [
            // @ts-expect-error -- getBalance args require an address
            { id: 1, action: "getBalance", args: {} },
            // @ts-expect-error -- getBlockNumber takes no args
            { id: 2, action: "getBlockNumber", args: { blockTag: "latest" } },
          ],
          PROXY
        );
      void typeLevel;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: 1, result: "0x9" }]));

      // Pre-typed single-action arrays keep their inference
      const items: BatchRequest<"getGasPrice">[] = [
        { id: 1, action: "getGasPrice" },
      ];
      const results = await batchActions(items, PROXY);
      expectTypeOf(results).toEqualTypeOf<BatchResult<"getGasPrice">[]>();
      expectTypeOf(results[0].result).toEqualTypeOf<bigint | undefined>();
      expect(results).toEqual([{ id: 1, result: BigInt("0x9") }]);

      // The bound client method keeps the same inference
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: "a", result: "0x7" }]));
      const ext = proxyActions(proxiedClient);
      const bound = await ext.batchProxy([{ id: "a", action: "getBlobBaseFee" }]);
      expectTypeOf(bound).toEqualTypeOf<
        readonly [BatchResult<"getBlobBaseFee">]
      >();
      expect(bound).toEqual([{ id: "a", result: BigInt("0x7") }]);
    });

    it("should normalize results on both the batch endpoint and the serial fallback", async () => {
      // Full round trip through the serial fallback (the endpoint path is
      // covered above): both proxy paths decode wire values the same way
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("batch down"))
        .mockResolvedValueOnce(proxyResponse("0x11"))
        .mockResolvedValueOnce(proxyResponse("0x22"));
      global.fetch = fetchMock;

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getGasPrice" },
        ],
        { ...PROXY, retryOptions: NO_RETRY }
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toContain("/api/v1/1/getBalance");
      expect(fetchMock.mock.calls[2][0]).toContain("/api/v1/1/getGasPrice");
      expect(results).toEqual([
        { id: 1, result: 17n },
        { id: 2, result: 34n },
      ]);
      expect(typeof results[0].result).toBe("bigint");
      expect(typeof results[1].result).toBe("bigint");
    });

    it("should decode proxy-path results into viem values per action", async () => {
      // Raw JSON-RPC wire payloads as the proxy returns them
      global.fetch = vi.fn().mockResolvedValueOnce(
        batchResponse([
          { id: 1, result: "0xde0b6b3a7640000" }, // getBalance
          // readContract: uint8 18
          {
            id: 2,
            result:
              "0x0000000000000000000000000000000000000000000000000000000000000012",
          },
          // getFeeHistory: raw hex-quantity fee history
          {
            id: 3,
            result: {
              oldestBlock: "0x10",
              baseFeePerGas: ["0x1", "0x2"],
              gasUsedRatio: [0.5, 0.25],
              reward: [["0x3", "0x4"]],
            },
          },
          { id: 4, result: "0x89" }, // getChainId
          { id: 5, result: "0x5209" }, // estimateGas
        ])
      );

      const [balance, decimals, feeHistory, chainId, gas] = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          {
            id: 2,
            action: "readContract",
            args: {
              address: ADDRESS,
              abi: [
                {
                  type: "function",
                  name: "decimals",
                  inputs: [],
                  outputs: [{ type: "uint8", name: "" }],
                  stateMutability: "view",
                },
              ],
              functionName: "decimals",
            },
          },
          { id: 3, action: "getFeeHistory", args: { blockCount: 2 } },
          { id: 4, action: "getChainId" },
          { id: 5, action: "estimateGas", args: { to: ADDRESS } },
        ],
        PROXY
      );

      // Each item holds the same viem value the single-action client
      // returns for the same wire value, matching its inferred type
      expect(balance.result).toBe(BigInt("0xde0b6b3a7640000"));
      expect(decimals.result).toBe(18);
      expect(feeHistory.result).toEqual({
        baseFeePerGas: [1n, 2n],
        gasUsedRatio: [0.5, 0.25],
        oldestBlock: 16n,
        reward: [[3n, 4n]],
      });
      expect(chainId.result).toBe(137);
      expect(gas.result).toBe(BigInt("0x5209"));
    });

    it("should pass readContract items without an ABI through untouched", async () => {
      // A caller pre-encoding calldata sends wire-style `data` args; with
      // no ABI there is nothing to decode against, so the raw hex stays
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: 1, result: "0x12" }]));

      const [read] = await batchActions(
        [
          {
            id: 1,
            action: "readContract",
            // Deliberately bypasses the typed viem-style args
            args: { address: ADDRESS, data: "0x31323334" },
          } as unknown as BatchRequest<"readContract">,
        ],
        PROXY
      );

      expect(read.result).toBe("0x12");
      expect(read.error).toBeUndefined();
    });

    it("should isolate per-item decode failures as error entries", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        batchResponse([
          { id: 1, result: "0x1" },
          { id: 2, result: "not-a-hex-quantity" },
          { id: 3, result: "0xff" },
        ])
      );

      const results = await batchActions(
        [
          { id: 1, action: "getBalance", args: { address: ADDRESS } },
          { id: 2, action: "getBalance", args: { address: ADDRESS } },
          { id: 3, action: "getBlockNumber" },
        ],
        PROXY
      );

      // Only the failing item degrades to an error entry
      expect(results[0]).toEqual({ id: 1, result: 1n });
      expect(results[1].result).toBeUndefined();
      expect(results[1].error).toEqual({
        code: -32603,
        message: expect.stringContaining("Failed to decode getBalance result"),
      });
      expect(results[2]).toEqual({ id: 3, result: 255n });
    });
  });

  describe("cache preheating", () => {
    const ADDRESS = "0x1234567890123456789012345678901234567890";
    const proxyResponse = (result: unknown) => ({
      json: () => Promise.resolve({ result, timestamp: Date.now() }),
    });

    it("should send each item through the cacheable compressed GET path", async () => {
      const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      global.fetch = fetchMock;

      const result = await preheatCache(
        [
          { action: "getBalance", args: { address: ADDRESS } },
          { action: "getBlockNumber" },
        ],
        PROXY
      );

      expect(result).toEqual({ submitted: 2, failed: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("https://proxy.example.com/api/v1/1/getBalance?p=");
      expect(init.method).toBe("GET");
      expect(String(fetchMock.mock.calls[1][0])).toContain(
        "/api/v1/1/getBlockNumber?p="
      );
    });

    it("should use the per-call default chain id", async () => {
      const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      global.fetch = fetchMock;

      await preheatCache([{ action: "getBalance", args: { address: ADDRESS } }], PROXY, 137);

      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/137/getBalance?p=");
    });

    it("should cap concurrent preheat requests at 5", async () => {
      const requests = Array.from({ length: 12 }, (_, i) => ({
        action: "getBalance" as const,
        args: { address: `0x${i}` },
      }));
      let inFlight = 0;
      let maxInFlight = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return proxyResponse("0x1");
      });

      const result = await preheatCache(requests, PROXY);

      expect(maxInFlight).toBe(5);
      expect(global.fetch).toHaveBeenCalledTimes(12);
      expect(result).toEqual({ submitted: 12, failed: 0 });
    });

    it("should count failures instead of throwing", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ error: { code: -32000, message: "boom" } }),
      });

      const result = await preheatCache(
        [
          { action: "getBalance", args: { address: ADDRESS } },
          { action: "getBlockNumber" },
        ],
        PROXY
      );

      // Each item gets a single attempt (preheat disables retries by default)
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ submitted: 2, failed: 2 });
    });

    it("should retry per explicit config retryOptions", async () => {
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        attempts += 1;
        return Promise.resolve(
          attempts % 2 === 1
            ? { status: 500, json: () => Promise.resolve({}) }
            : proxyResponse("0x1")
        );
      });

      const result = await preheatCache(
        [{ action: "getBalance", args: { address: ADDRESS } }],
        { ...PROXY, retryOptions: { attempts: 2, delay: 0 } }
      );

      expect(attempts).toBe(2);
      expect(result).toEqual({ submitted: 1, failed: 0 });
    });

    it("should return zero counters for an empty request list", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await preheatCache([], PROXY);

      expect(result).toEqual({ submitted: 0, failed: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should return zero counters without an endpoint", async () => {
      const result = await preheatCache(
        [{ action: "getBlockNumber" }],
        { endpoint: "" }
      );

      expect(result).toEqual({ submitted: 0, failed: 0 });
    });

    it("should expose preheatCache on the extended actions object", async () => {
      const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      global.fetch = fetchMock;
      const ext = proxyActions(proxiedClient);

      const result = await ext.preheatCache([
        { action: "getBalance", args: { address: ADDRESS } },
      ]);

      // Client chain (mainnet → 1) and proxy config come from the client
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "/api/v1/1/getBalance?p="
      );
      expect(result).toEqual({ submitted: 1, failed: 0 });
    });

    it("should return zero counters when the client has no proxy config", async () => {
      const plainClient = createPublicClient({
        chain: mainnet,
        transport: http("https://eth.llamarpc.com"),
      });
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await proxyActions(plainClient).preheatCache([
        { action: "getBlockNumber" },
      ]);

      expect(result).toEqual({ submitted: 0, failed: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("cache purge", () => {
    const purgeReport = {
      purged: { dedup: 2, cache: 1 },
      scope: "colo",
      limitations: [
        "caches.default.delete only affects the Cloudflare colo serving this request",
      ],
    };

    it("should POST all requests to /api/v1/purge with auth and trace headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(purgeReport),
      });
      global.fetch = fetchMock;

      const requests = [
        { chainId: 1, action: "getBalance", args: { address: "0xabc" } },
        { chainId: 137, action: "getBlockNumber" },
      ];
      const result = await purgeCache(requests, {
        endpoint: "https://proxy.example.com",
        apiKey: "secret-key",
      });

      expect(result).toEqual(purgeReport);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://proxy.example.com/api/v1/purge");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-API-Key": "secret-key",
      });
      expect(String((init.headers as Record<string, string>)["X-Trace-Id"])).toMatch(
        /^[0-9a-f]{12}$/
      );
      expect(JSON.parse(init.body as string)).toEqual({ requests });
    });

    it("should retry transient failures with the configured policy", async () => {
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        attempts += 1;
        return Promise.resolve(
          attempts % 2 === 1
            ? { status: 502, json: () => Promise.resolve({}) }
            : { json: () => Promise.resolve(purgeReport) }
        );
      });

      const result = await purgeCache(
        [{ chainId: 1, action: "getBlockNumber" }],
        {
          endpoint: "https://proxy.example.com",
          retryOptions: { attempts: 2, delay: 0 },
        }
      );

      expect(attempts).toBe(2);
      expect(result).toEqual(purgeReport);
    });

    it("should throw the server error immediately on non-retryable responses", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            error: { code: -32602, message: "Method-level purge is not supported" },
          }),
      });
      global.fetch = fetchMock;

      await expect(
        purgeCache([{ chainId: 1, action: "getBalance" }], {
          endpoint: "https://proxy.example.com",
          retryOptions: { attempts: 3, delay: 0 },
        })
      ).rejects.toThrow("Method-level purge is not supported");
      expect(fetchMock).toHaveBeenCalledTimes(1); // not retried
    });

    it("should return zero deletions for an empty list or missing endpoint", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        purgeCache([], { endpoint: "https://proxy.example.com" })
      ).resolves.toEqual({
        purged: { dedup: 0, cache: 0 },
        scope: "colo",
        limitations: [],
      });
      await expect(
        purgeCache([{ chainId: 1, action: "getBlockNumber" }], {
          endpoint: "",
        })
      ).resolves.toEqual({
        purged: { dedup: 0, cache: 0 },
        scope: "colo",
        limitations: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("middleware", () => {
    const ADDRESS = "0x1234567890123456789012345678901234567890";
    const proxyResponse = (result: unknown) => ({
      json: () => Promise.resolve({ result, timestamp: Date.now() }),
    });

    afterEach(() => {
      clearMiddlewares();
    });

    it("should expose the proxy request shape to middleware", async () => {
      const seen: unknown[] = [];
      addMiddleware(async (request, next) => {
        seen.push({ ...request });
        return next(request);
      });
      global.fetch = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      const ext = proxyActions(proxiedClient);

      await ext.getBalance({ address: ADDRESS });

      expect(seen).toEqual([
        { functionName: "getBalance", chainId: 1, args: { address: ADDRESS } },
      ]);
    });

    it("should run middlewares onion-style with the first registered outermost", async () => {
      const order: string[] = [];
      addMiddleware(async (request, next) => {
        order.push("outer:before");
        const response = await next(request);
        order.push("outer:after");
        return response;
      });
      addMiddleware(async (request, next) => {
        order.push("inner:before");
        const response = await next(request);
        order.push("inner:after");
        return response;
      });
      global.fetch = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      const ext = proxyActions(proxiedClient);

      await ext.getBalance({ address: ADDRESS });

      expect(order).toEqual([
        "outer:before",
        "inner:before",
        "inner:after",
        "outer:after",
      ]);
    });

    it("should send the request a middleware passes to next", async () => {
      const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      global.fetch = fetchMock;
      addMiddleware(async (request, next) =>
        next({ ...request, chainId: 137 })
      );
      const ext = proxyActions(proxiedClient);

      await ext.getBalance({ address: ADDRESS });

      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "/api/v1/137/getBalance?p="
      );
    });

    it("should let middleware short-circuit with its own response", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      addMiddleware(async () => ({ result: "0xdeadbeef" }));
      const ext = proxyActions(proxiedClient);

      const balance = await ext.getBalance({ address: ADDRESS });

      expect(balance).toBe(BigInt("0xdeadbeef"));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should abort the request when a middleware throws and follow the fallback path", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockDirectRpc("0x2a"));
      global.fetch = fetchMock;
      addMiddleware(async () => {
        throw new Error("blocked");
      });
      const client = withProxy(
        createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
        { ...PROXY, fallback: true, retryOptions: NO_RETRY }
      );

      const balance = await getBalance(client, { address: ADDRESS });

      // The proxy request never went out; only the direct RPC fallback did
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).not.toContain("proxy.example.com");
      expect(balance).toBe(BigInt("0x2a"));
    });

    it("should treat a middleware response without result or error as a failure", async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockDirectRpc("0x1"));
      global.fetch = fetchMock;
      addMiddleware(async () => ({}) as RpcResponse);
      const client = withProxy(
        createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
        { ...PROXY, fallback: true, retryOptions: NO_RETRY }
      );

      const balance = await getBalance(client, { address: ADDRESS });

      expect(balance).toBe(BigInt("0x1"));
      expect(String(fetchMock.mock.calls[0][0])).not.toContain("proxy.example.com");
    });

    it("should stop applying middlewares after clearMiddlewares", async () => {
      const middleware = vi.fn(
        async (request: RpcRequest, next: (request: RpcRequest) => Promise<RpcResponse>) =>
          next(request)
      );
      addMiddleware(middleware);
      clearMiddlewares();
      global.fetch = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      const ext = proxyActions(proxiedClient);

      await ext.getBalance({ address: ADDRESS });

      expect(middleware).not.toHaveBeenCalled();
    });

    it("should register middleware via the use extension method", async () => {
      const seen: string[] = [];
      global.fetch = vi.fn().mockResolvedValue(proxyResponse("0x1"));
      const ext = proxyActions(proxiedClient);
      ext.use(async (request, next) => {
        seen.push(request.functionName);
        return next(request);
      });

      await ext.getBalance({ address: ADDRESS });

      expect(seen).toEqual(["getBalance"]);
    });
  });
});

describe("global proxy defaults (configureProxy)", () => {
  const ADDRESS = "0x1234567890123456789012345678901234567890";
  const proxyResponse = (result: unknown) => ({
    json: () => Promise.resolve({ result, timestamp: Date.now() }),
  });

  // Module defaults are process-global state: always restore so the
  // suites above and below observe the unconfigured library.
  afterEach(() => {
    resetProxyDefaults();
    global.fetch = originalFetch;
  });

  it("should expose no defaults until configureProxy is called", () => {
    expect(getProxyDefaults()).toEqual({});
  });

  it("should merge partial defaults across calls and hand out copies", () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });
    configureProxy({ timeout: 10000 });

    const snapshot = getProxyDefaults();
    expect(snapshot).toEqual({
      endpoint: "https://default-proxy.example.com",
      timeout: 10000,
    });

    // Mutating the snapshot must not leak into the module state
    snapshot.endpoint = "https://mutated.example.com";
    expect(getProxyDefaults().endpoint).toBe(
      "https://default-proxy.example.com"
    );
  });

  it("should keep built-in defaults for keys never configured", () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });

    const config = resolveProxyConfig(undefined);
    expect(config.endpoint).toBe("https://default-proxy.example.com");
    expect(config.timeout).toBe(30000);
    expect(config.fallback).toBe(true);
    expect(config.retryOptions).toEqual({ attempts: 3, delay: 500 });
  });

  it("should hand out fresh copies from resolution", () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      retryOptions: { attempts: 5, delay: 10 },
    });

    const resolved = resolveProxyConfig(undefined);
    resolved.endpoint = "https://mutated.example.com";
    resolved.retryOptions.attempts = 99;

    const fresh = resolveProxyConfig(undefined);
    expect(fresh.endpoint).toBe("https://default-proxy.example.com");
    expect(fresh.retryOptions.attempts).toBe(5);
  });

  it("should restore the unconfigured state after resetProxyDefaults", () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });
    expect(getProxyDefaults().endpoint).toBe(
      "https://default-proxy.example.com"
    );

    resetProxyDefaults();

    expect(getProxyDefaults()).toEqual({});
    const client = withProxy(
      createPublicClient({ chain: mainnet, transport: http() })
    );
    expect(getProxyConfig(client).endpoint).toBe("");
  });

  it("should inherit module defaults in withProxy without a config", () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      timeout: 10000,
    });

    const client = withProxy(
      createPublicClient({ chain: mainnet, transport: http() })
    );

    const config = getProxyConfig(client);
    expect(config.endpoint).toBe("https://default-proxy.example.com");
    expect(config.timeout).toBe(10000);
  });

  it("should let explicit withProxy config win over module defaults per key", () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      timeout: 10000,
      debug: true,
    });

    const client = withProxy(
      createPublicClient({ chain: mainnet, transport: http() }),
      { endpoint: "https://explicit.example.com" }
    );

    const config = getProxyConfig(client);
    expect(config.endpoint).toBe("https://explicit.example.com"); // explicit wins
    expect(config.timeout).toBe(10000); // inherited from module defaults
    expect(config.debug).toBe(true); // inherited from module defaults
  });

  it("should stay on the native path when no endpoint is configured anywhere", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockDirectRpc("0x2a"));
    global.fetch = fetchMock;

    // Bare client: no withProxy mount, no configureProxy call
    const client = createPublicClient({
      chain: mainnet,
      transport: http("https://eth.llamarpc.com"),
    });
    const balance = await getBalance(client, { address: ADDRESS });

    expect(balance).toBe(42n);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/api/v1/");
  });

  it("should run single actions through the module-default endpoint", async () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      retryOptions: { attempts: 1, delay: 0 },
    });
    const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
    global.fetch = fetchMock;

    const client = withProxy(
      createPublicClient({ chain: mainnet, transport: http() })
    );
    const balance = await getBalance(client, { address: ADDRESS });

    expect(balance).toBe(1n);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://default-proxy.example.com/api/v1/1/getBalance?p="
    );
  });

  it("should resolve module defaults in the client form of proxyActions", async () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      retryOptions: { attempts: 1, delay: 0 },
    });
    const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
    global.fetch = fetchMock;

    const ext = proxyActions(
      createPublicClient({ chain: mainnet, transport: http() })
    );
    await ext.getBalance({ address: ADDRESS });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://default-proxy.example.com/api/v1/1/getBalance?p="
    );
  });

  it("should resolve the proxyActions config form over module defaults", async () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      timeout: 10000,
    });
    const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
    global.fetch = fetchMock;

    const client = createPublicClient({ chain: mainnet, transport: http() });
    const ext = proxyActions({ timeout: 2000 })(client);

    expect(getProxyConfig(client).timeout).toBe(2000); // explicit key wins
    await ext.getBalance({ address: ADDRESS });

    // Endpoint inherited from module defaults
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://default-proxy.example.com/api/v1/1/getBalance?p="
    );
  });

  it("should route createPublicClient through module defaults without a proxy key", async () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      retryOptions: { attempts: 1, delay: 0 },
    });
    const fetchMock = vi.fn().mockResolvedValue(proxyResponse("0x1"));
    global.fetch = fetchMock;

    const client = createProxyPublicClient({
      chain: mainnet,
      transport: http(),
    });
    await client.getBalance({ address: ADDRESS });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://default-proxy.example.com/api/v1/1/getBalance?p="
    );
  });

  it("should let createPublicClient proxy config win over module defaults", () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      timeout: 10000,
    });

    const client = createProxyPublicClient({
      chain: mainnet,
      transport: http(),
      proxy: { endpoint: "https://client.example.com" },
    });

    expect(client.proxy.endpoint).toBe("https://client.example.com");
    expect(client.proxy.timeout).toBe(10000); // inherited from module defaults
    expect(getProxyConfig(client).endpoint).toBe("https://client.example.com");
  });

  it("should keep proxy disabled when createPublicClient opts out explicitly", async () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });
    const fetchMock = vi.fn().mockResolvedValue(mockDirectRpc("0x2a"));
    global.fetch = fetchMock;

    const client = createProxyPublicClient({
      chain: mainnet,
      transport: http("https://eth.llamarpc.com"),
      proxy: { enabled: false },
    });

    expect(client.proxy.enabled).toBe(false);

    // Explicit opt-out: the client's own methods stay on the native path
    // even though a module-default endpoint exists
    const balance = await client.getBalance({ address: ADDRESS });
    expect(balance).toBe(42n);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/api/v1/");
  });

  it("should use module defaults in batchActions without a config", async () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ results: [{ id: 1, result: "0x1" }] }),
    });
    global.fetch = fetchMock;

    const results = await batchActions([{ id: 1, action: "getBlockNumber" }]);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://default-proxy.example.com/api/v1/batch"
    );
    expect(results[0].result).toBe(1n);
  });

  it("should let explicit batchActions config win over module defaults", async () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ results: [{ id: 1, result: "0x1" }] }),
    });
    global.fetch = fetchMock;

    await batchActions([{ id: 1, action: "getChainId" }], {
      endpoint: "https://explicit.example.com",
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://explicit.example.com/api/v1/batch"
    );
  });

  it("should use module defaults in preheatCache without a config and keep single-attempt retries", async () => {
    configureProxy({ endpoint: "https://default-proxy.example.com" });
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock;

    const result = await preheatCache([
      { action: "getBalance", args: { address: ADDRESS } },
    ]);

    expect(result).toEqual({ submitted: 1, failed: 1 });
    // Module defaults did not silently enable the 3-attempt retry policy:
    // preheat stays single-attempt unless retryOptions are configured
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should honor module retryOptions in preheatCache when configured there", async () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      retryOptions: { attempts: 2, delay: 0 },
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock;

    await preheatCache([
      { action: "getBalance", args: { address: ADDRESS } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("should use module defaults in purgeCache without a config", async () => {
    configureProxy({
      endpoint: "https://default-proxy.example.com",
      apiKey: "module-key",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          purged: { dedup: 1, cache: 1 },
          scope: "colo",
          limitations: [],
        }),
    });
    global.fetch = fetchMock;

    const report = await purgeCache([{ chainId: 1, action: "getBalance" }]);

    expect(report.purged).toEqual({ dedup: 1, cache: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://default-proxy.example.com/api/v1/purge"
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(
      "module-key"
    );
  });
});
