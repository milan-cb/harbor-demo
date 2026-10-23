import { useCallback, useEffect, useState } from "react";
import { erc20Abi, parseAbi } from "viem";
import { publicClient } from "./format";

// The CDP fee-earning vault is a Morpho Vault V2 (ERC-4626). Everything the Lend
// view shows about it is read straight from the chain, so no developer-authenticated
// CDP endpoint is needed in the browser.
const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function performanceFee() view returns (uint96)",
]);

const WAD = 10n ** 18n;

export type VaultOnchain = {
  assetAddress: `0x${string}`;
  assetDecimals: number;
  assetSymbol: string;
  /** Assets managed by the vault, in the asset's atomic units. */
  totalAssets: bigint;
  /** The account's vault shares. */
  shares: bigint;
  /** The account's shares converted to the underlying asset. */
  depositAssets: bigint;
  /** The account's wallet balance of the underlying asset. */
  walletAssets: bigint;
  /** Performance fee as a fraction of yield, when the vault exposes it. */
  performanceFee?: number;
};

export async function readVaultOnchain(vaultAddress: `0x${string}`, account: `0x${string}`): Promise<VaultOnchain> {
  const vault = { address: vaultAddress, abi: vaultAbi } as const;
  const [assetAddress, totalAssets, shares, performanceFee] = await publicClient.multicall({
    allowFailure: true,
    authorizationList: undefined,
    contracts: [
      { ...vault, functionName: "asset" },
      { ...vault, functionName: "totalAssets" },
      { ...vault, functionName: "balanceOf", args: [account] },
      { ...vault, functionName: "performanceFee" },
    ],
  });
  if (assetAddress.status !== "success") throw new Error("The vault address does not look like an ERC-4626 vault");

  const token = { address: assetAddress.result, abi: erc20Abi } as const;
  const [depositAssets, walletAssets, assetDecimals, assetSymbol] = await publicClient.multicall({
    allowFailure: true,
    authorizationList: undefined,
    contracts: [
      { ...vault, functionName: "convertToAssets", args: [shares.status === "success" ? shares.result : 0n] },
      { ...token, functionName: "balanceOf", args: [account] },
      { ...token, functionName: "decimals" },
      { ...token, functionName: "symbol" },
    ],
  });

  return {
    assetAddress: assetAddress.result,
    assetDecimals: assetDecimals.status === "success" ? assetDecimals.result : 6,
    assetSymbol: assetSymbol.status === "success" ? assetSymbol.result : "USDC",
    totalAssets: totalAssets.status === "success" ? totalAssets.result : 0n,
    shares: shares.status === "success" ? shares.result : 0n,
    depositAssets: depositAssets.status === "success" ? depositAssets.result : 0n,
    walletAssets: walletAssets.status === "success" ? walletAssets.result : 0n,
    performanceFee: performanceFee.status === "success"
      ? Number((performanceFee.result * 10000n) / WAD) / 10000
      : undefined,
  };
}

/** Reads the vault's TVL, fee and the account's deposit from the chain. */
export function useVaultOnchain(
  vaultAddress: `0x${string}` | undefined,
  account: `0x${string}` | undefined,
  refreshKey: number,
) {
  const [data, setData] = useState<VaultOnchain>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(Boolean(vaultAddress && account));

  useEffect(() => {
    if (!vaultAddress || !account) return;
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- loading mirrors the external RPC request.
    setIsLoading(true);
    setError(undefined);
    readVaultOnchain(vaultAddress, account)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not read the vault");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultAddress, account, refreshKey]);

  return { data, error, isLoading };
}

export const useVaultRefresh = () => {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  return { refreshKey, refresh };
};
