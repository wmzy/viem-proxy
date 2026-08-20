import type { Client, Chain, Transport } from "viem";
import { getStorageAt as viemGetStorageAt } from "viem/actions";
import { getProxyConfig } from "../proxy";
import { makeProxyRequest } from "./utils";

export type GetStorageAtParameters = {
  address: `0x${string}`;
  /** Storage slot as hex, or a number/bigint encoded to hex */
  slot: `0x${string}` | number | bigint;
  blockTag?: string;
  blockNumber?: bigint;
};

export type GetStorageAtReturnType = `0x${string}`;

/** Serialize a storage slot to its hex form */
const toSlotHex = (slot: GetStorageAtParameters["slot"]): `0x${string}` =>
  typeof slot === "string" ? slot : `0x${BigInt(slot).toString(16)}`;

/**
 * Get the value of a storage slot at an address through proxy
 */
export const getStorageAt = async <TChain extends Chain | undefined>(
  client: Client<Transport, TChain>,
  args: GetStorageAtParameters
): Promise<GetStorageAtReturnType> => {
  const proxy = getProxyConfig(client);
  const chainId = client.chain?.id ?? 1;

  if (!proxy?.endpoint) {
    return viemGetStorageAt(client, args as any) as Promise<GetStorageAtReturnType>;
  }

  try {
    const result = await makeProxyRequest<GetStorageAtReturnType>(
      "getStorageAt",
      chainId,
      {
        address: args.address,
        slot: toSlotHex(args.slot),
        blockTag: args.blockTag,
        blockNumber: args.blockNumber?.toString(),
      },
      proxy
    );
    return result;
  } catch (error) {
    if (proxy.fallback !== false) {
      if (proxy.debug) {
        console.warn("[viem-proxy] Fallback to direct RPC:", error);
      }
      return viemGetStorageAt(client, args as any) as Promise<GetStorageAtReturnType>;
    }
    throw error;
  }
};
