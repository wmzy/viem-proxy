import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { proxyActions } from "../actions/proxyActions";
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
import type { BatchResult } from "../actions/batch.client";
import { preheatCache } from "../actions/preheat.client";
import { addMiddleware, clearMiddlewares } from "../actions/middleware";
import type { RpcRequest, RpcResponse } from "../types";
import { withProxy } from "../proxy";
import { resetMetrics, getMetricsCollector } from "../utils/metrics";

const originalFetch = global.fetch;

const mockProxyResponse = <T>(result: T) =>
  vi.fn().mockResolvedValueOnce({
    json: () => Promise.resolve({ result, timestamp: Date.now() }),
  });

const mockDirectRpc = (result: unknown) => ({
  ok: true,
  headers: new Headers({ "content-type": "application/json" }),
  json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result }),
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
      expect(extended.clearCache).toBeDefined();
    });

    it("should expose live metrics via getCacheStats and reset via clearCache", async () => {
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

      ext.clearCache();

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
        { id: 1, result: "0x1" },
        { id: 2, result: "0xff" },
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

      expect(results[0]).toEqual({ id: 1, result: "0x1" });
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
        { id: 1, result: "0x11" },
        { id: 2, result: "0x22" },
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
      expect(results[0]).toEqual({ id: 1, result: "0x1" });
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

      const stats = getMetricsCollector().getSnapshot();
      expect(stats.totalRequests).toBe(2);
      expect(stats.methodStats.getBalance.count).toBe(1);
      expect(stats.methodStats.getBlockNumber.count).toBe(1);
      resetMetrics();
    });

    it("should expose batch() on the extended actions object", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(batchResponse([{ id: "a", result: "0x9" }]));
      global.fetch = fetchMock;
      const ext = proxyActions(proxiedClient);

      const results: BatchResult[] = await ext.batch([
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
      expect(results).toEqual([{ id: "a", result: "0x9" }]);
    });

    it("should run items natively when the client has no proxy config", async () => {
      const plainClient = createPublicClient({
        chain: mainnet,
        transport: http("https://eth.llamarpc.com"),
      });
      global.fetch = vi.fn().mockResolvedValueOnce(mockDirectRpc("0x9999"));

      const results = await proxyActions(plainClient).batch([
        { id: 1, action: "getBalance", args: { address: ADDRESS } },
      ]);

      expect(results).toEqual([{ id: 1, result: BigInt("0x9999") }]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
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
