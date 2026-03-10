import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { readContract } from "../actions/readContract.client";
import { withProxy } from "../proxy";

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
const PROXY_NO_FALLBACK = { endpoint: "https://proxy.example.com", fallback: false };

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
  });

  describe("fallback behavior for all actions", () => {
    const makeRpcClient = () => withProxy(
      createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
      { ...PROXY, fallback: true }
    );

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
    const makeDebugClient = () => withProxy(
      createPublicClient({ chain: mainnet, transport: http("https://eth.llamarpc.com") }),
      { ...PROXY, fallback: true, debug: true }
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
  });
});
