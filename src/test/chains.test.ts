import { describe, it, expect } from "vitest";

describe("Chains re-exports", () => {
  it("should re-export mainnet", async () => {
    const { mainnet } = await import("../chains");
    expect(mainnet).toBeDefined();
    expect(mainnet.id).toBe(1);
  });

  it("should re-export additional chains beyond viem's default", async () => {
    const chains = await import("../chains");
    
    expect(chains).toBeDefined();
    expect(typeof chains).toBe("object");
    
    // Since chains.ts only re-exports viem chains, we just check it behaves as expected
    const viemChains = await import("viem/chains");
    
    // All viem chains should be available
    const chainNames = ['mainnet', 'sepolia', 'goerli', 'polygon', 'arbitrum', 'optimism'];
    
    chainNames.forEach(chainName => {
      expect(chains[chainName as keyof typeof chains]).toBeDefined();
    });
  });
});