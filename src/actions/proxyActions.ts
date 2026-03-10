import type { Client, Chain, Transport } from "viem";
import type { ProxyActionConfig } from "./types";
import type { GetBalanceParameters } from "./getBalance.client";
import type { GetBlockParameters } from "./getBlock.client";
import type { GetTransactionParameters } from "./getTransaction.client";
import type { GetTransactionReceiptParameters } from "./getTransactionReceipt.client";
import type { ReadContractParameters } from "./readContract.client";
import type { CallParameters } from "./call.client";
import type { EstimateGasParameters } from "./estimateGas.client";
import type { GetLogsParameters } from "./getLogs.client";
import type { GetCodeParameters } from "./getCode.client";
import { getBalance } from "./getBalance.client";
import { getBlock } from "./getBlock.client";
import { getBlockNumber } from "./getBlockNumber.client";
import { getTransaction } from "./getTransaction.client";
import { getTransactionReceipt } from "./getTransactionReceipt.client";
import { readContract } from "./readContract.client";
import { call } from "./call.client";
import { estimateGas } from "./estimateGas.client";
import { getGasPrice } from "./getGasPrice.client";
import { getLogs } from "./getLogs.client";
import { getCode } from "./getCode.client";

/**
 * Proxy actions for extending a viem client
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { proxyActions } from 'viem-proxy/actions'
 * import { mainnet } from 'viem/chains'
 *
 * const client = createPublicClient({
 *   chain: mainnet,
 *   transport: http()
 * }).extend(proxyActions({
 *   endpoint: 'https://proxy.example.com',
 *   fallback: true
 * }))
 *
 * const balance = await client.getBalance({ address: '0x...' })
 */
export const proxyActions = (config: ProxyActionConfig) => {
  return <TChain extends Chain | undefined>(
    client: Client<Transport, TChain>
  ) => ({
    /**
     * Get the balance of an address
     */
    getBalance: (args: GetBalanceParameters) =>
      getBalance(client, { ...args, proxy: config }),

    /**
     * Get a block
     */
    getBlock: (args?: GetBlockParameters) =>
      getBlock(client, { ...args, proxy: config }),

    /**
     * Get the current block number
     */
    getBlockNumber: () => getBlockNumber(client, { proxy: config }),

    /**
     * Get a transaction by hash
     */
    getTransaction: (args: GetTransactionParameters) =>
      getTransaction(client, { ...args, proxy: config }),

    /**
     * Get a transaction receipt by hash
     */
    getTransactionReceipt: (args: GetTransactionReceiptParameters) =>
      getTransactionReceipt(client, { ...args, proxy: config }),

    /**
     * Read a contract
     */
    readContract: (args: ReadContractParameters) =>
      readContract(client, { ...args, proxy: config }),

    /**
     * Execute a call
     */
    call: (args: CallParameters) => call(client, { ...args, proxy: config }),

    /**
     * Estimate gas
     */
    estimateGas: (args: EstimateGasParameters) =>
      estimateGas(client, { ...args, proxy: config }),

    /**
     * Get the current gas price
     */
    getGasPrice: () => getGasPrice(client, { proxy: config }),

    /**
     * Get logs
     */
    getLogs: (args?: GetLogsParameters) =>
      getLogs(client, { ...args, proxy: config }),

    /**
     * Get contract code
     */
    getCode: (args: GetCodeParameters) =>
      getCode(client, { ...args, proxy: config }),
  });
};

/**
 * Type for a client extended with proxy actions
 */
export type ProxyActionsReturnType = ReturnType<ReturnType<typeof proxyActions>>;
