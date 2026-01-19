import type { CacheStrategy, RequestInfo } from "../types";

// Default long-term cache TTL (30 days)
const LONG_TERM_CACHE_TTL = 2592000;

// 网络特性配置
interface NetworkConfig {
  blockTimeSeconds: number;
  epochBlocks: number;
}

const NETWORK_CONFIGS: Record<number, NetworkConfig> = {
  1: { blockTimeSeconds: 12, epochBlocks: 32 },    // Ethereum
  56: { blockTimeSeconds: 3, epochBlocks: 200 },  // BSC
  137: { blockTimeSeconds: 2, epochBlocks: 64 },  // Polygon
  42161: { blockTimeSeconds: 12, epochBlocks: 32 }, // Arbitrum
  10: { blockTimeSeconds: 2, epochBlocks: 16 },   // Optimism
  43114: { blockTimeSeconds: 2, epochBlocks: 32 }, // Avalanche
};

/**
 * 获取网络默认配置
 */
const getNetworkConfig = (chainId: number): NetworkConfig => {
  return NETWORK_CONFIGS[chainId] || { blockTimeSeconds: 12, epochBlocks: 32 };
};

/**
 * 检查是否finalized块
 * 判断标准：
  * 1. 显式指定 'finalized' block parameter
 * 2. 对于以太坊类网络，块高度 <= 最新finalized块高度
 * 3. 区块确认数足够（>= epoch size）
 */
const isFinalizedBlock = (
  blockParam: any,
  chainId: number,
  latestBlockNumber: number
): boolean => {
  if (blockParam === 'finalized') return true;
  
  if (typeof blockParam === 'string' && blockParam.startsWith('0x')) {
    try {
      const blockNumber = parseInt(blockParam, 16);
      if (isNaN(blockNumber)) return false;
      
      const config = getNetworkConfig(chainId);
      // 如果块确认数超过epoch大小，认为是finalized
      const confirmations = latestBlockNumber - blockNumber;
      return confirmations >= config.epochBlocks;
    } catch {
      return false;
    }
  }
  
  return false;
};

/**
 * 获取缓存策略
 */
export const getCacheStrategy = (
  chainId: number,
  method: string,
  params: any[],
  defaultTtl = 300,
  latestBlockNumber?: number
): CacheStrategy => {
  const key = `${chainId}:${method}:${JSON.stringify(params)}`;

  // 根据方法确定缓存时间
  const ttl = getCacheTtlByMethod(method, params, chainId, latestBlockNumber);

  return {
    ttl: ttl || defaultTtl,
    key,
    shouldCache: ttl > 0,
  };
};

/**
 * 根据方法和参数确定缓存时间
 */
const getCacheTtlByMethod = (
  method: string,
  params: any[],
  chainId: number,
  latestBlockNumber?: number
): number => {
  switch (method) {
    // 历史数据 - 长期缓存
    case "eth_getBlockByHash":
    case "eth_getTransactionByHash":
    case "eth_getTransactionReceipt":
      return 31536000; // 1年

    case "eth_getBlockByNumber":
      // 根据区块类型和finalization状态决定缓存时间
      const blockParam = params[0];
      if (latestBlockNumber && blockParam) {
        // 检查是否为finalized块
        if (isFinalizedBlock(blockParam, chainId, latestBlockNumber)) {
          console.log(`[Cache] Detected finalized block ${blockParam}, applying long-term cache: ${LONG_TERM_CACHE_TTL}s`);
          return LONG_TERM_CACHE_TTL; // Long-term cache (30 days)
        }
      }
      
      // 其他block parameter处理
      if (
        blockParam &&
        typeof blockParam === "string" &&
        blockParam.startsWith("0x")
      ) {
        const blockNumber = parseInt(blockParam, 16);
        if (!isNaN(blockNumber)) {
          // 基于确认数动态设置缓存时间
          const config = getNetworkConfig(chainId);
          const estimatedConfirmations = latestBlockNumber ? 
            Math.max(0, latestBlockNumber - blockNumber) : 0;
          
          if (estimatedConfirmations >= config.epochBlocks * 2) {
            // 2个epoch以上的历史块 (更安全)
            return 86400; // 1天
          } else if (estimatedConfirmations >= config.epochBlocks) {
            // 1个epoch以上的块，可能已finalized
            return 3600; // 1小时
          } else {
            // 较新的块
            return 300; // 5分钟
          }
        }
      }
      return blockParam === "latest" || blockParam === "pending" ? 12 : 300;

    // 状态数据 - 中等缓存
    case "eth_getBalance":
    case "eth_call":
    case "eth_getTransactionCount":
      return 30; // 30秒

    case "eth_getCode":
    case "eth_getStorageAt":
      return 300; // 5分钟

    // 最新数据 - 短期缓存
    case "eth_blockNumber":
    case "eth_gasPrice":
    case "eth_estimateGas":
      return 12; // 12秒

    // 网络信息 - 长期缓存
    case "net_version":
    case "web3_clientVersion":
      return 3600; // 1小时

    // 日志查询 - 短期缓存
    case "eth_getLogs":
      return 60; // 1分钟

    default:
      return 300; // 默认5分钟
  }
};

/**
 * 设置响应缓存头
 */
export const setCacheHeaders = (response: Response, ttl: number): Response => {
  const headers = new Headers(response.headers);

  if (ttl > 0) {
    headers.set("Cache-Control", `public, max-age=${ttl}, s-maxage=${ttl}`);
    headers.set("CDN-Cache-Control", `max-age=${ttl}`);
    headers.set("Cloudflare-CDN-Cache-Control", `max-age=${ttl}`);
  } else {
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  }

  headers.set("Vary", "Accept-Encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/**
 * 创建缓存键
 */
export const createCacheKey = (request: RequestInfo): string => {
  return `${request.chainId}:${request.method}:${JSON.stringify(
    request.params
  )}`;
};

/**
 * 检查是否应该缓存
 */
export const shouldCacheResponse = (method: string, result: any): boolean => {
  // 不缓存错误响应
  if (!result || (typeof result === "object" && result.error)) {
    return false;
  }

  // 不缓存 pending 状态的数据
  if (typeof result === "object" && result.status === "pending") {
    return false;
  }

  return true;
};
