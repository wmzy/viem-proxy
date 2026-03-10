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
    
    const chainNames = ['mainnet', 'sepolia', 'goerli', 'polygon', 'arbitrum', 'optimism'];
    
    chainNames.forEach(chainName => {
      expect(chains[chainName as keyof typeof chains]).toBeDefined();
    });
  });
});