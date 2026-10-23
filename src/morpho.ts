import { useEffect, useState } from "react";

// Morpho's public GraphQL API. It serves the same figures shown on app.morpho.org
// and needs no API key. Every hook below fails soft: the UI renders "—" when the
// request is unavailable and never blocks a deposit or borrow.
const MORPHO_API = "https://blue-api.morpho.org/graphql";
const BASE_CHAIN_ID = 8453;

export type MorphoVaultStats = {
  name: string;
  symbol: string;
  /** Gross APY as a fraction (0.044 = 4.4%). */
  apy: number;
  /** APY net of the curator's fee, as a fraction. */
  netApy: number;
  /** Curator fee as a fraction of yield. */
  fee: number;
  totalAssetsUsd: number;
  assetSymbol: string;
  assetDecimals: number;
};

export type MorphoMarketStats = {
  /** Borrow APY as a fraction. */
  borrowApy: number;
  /** Utilization as a fraction. */
  utilization: number;
  liquidityUsd: number;
};

async function morphoQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Morpho API responded with status ${response.status}`);
  const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "Morpho API error");
  if (!result.data) throw new Error("Morpho API returned no data");
  return result.data;
}

const vaultRequests = new Map<string, Promise<MorphoVaultStats>>();

type MorphoVersion = "v1" | "v2";

function queryVaultV1(address: string): Promise<MorphoVaultStats> {
  return morphoQuery<{
    vaultByAddress: {
      name: string;
      symbol: string;
      asset: { symbol: string; decimals: number };
      state: { apy: number; netApy: number; fee: number; totalAssetsUsd: number } | null;
    } | null;
  }>(
    `query Vault($address: String!, $chainId: Int!) {
      vaultByAddress(address: $address, chainId: $chainId) {
        name symbol asset { symbol decimals } state { apy netApy fee totalAssetsUsd }
      }
    }`,
    { address, chainId: BASE_CHAIN_ID },
  ).then(({ vaultByAddress }) => {
    if (!vaultByAddress?.state) throw new Error("Vault not found on Morpho");
    return {
      name: vaultByAddress.name,
      symbol: vaultByAddress.symbol,
      apy: vaultByAddress.state.apy,
      netApy: vaultByAddress.state.netApy,
      fee: vaultByAddress.state.fee,
      totalAssetsUsd: vaultByAddress.state.totalAssetsUsd,
      assetSymbol: vaultByAddress.asset.symbol,
      assetDecimals: vaultByAddress.asset.decimals,
    };
  });
}

function queryVaultV2(address: string): Promise<MorphoVaultStats> {
  return morphoQuery<{
    vaultV2ByAddress: {
      name: string;
      symbol: string;
      asset: { symbol: string; decimals: number };
      apy: number | null;
      netApy: number | null;
      performanceFee: number | null;
      totalAssetsUsd: number | null;
    } | null;
  }>(
    `query VaultV2($address: String!, $chainId: Int!) {
      vaultV2ByAddress(address: $address, chainId: $chainId) {
        name symbol asset { symbol decimals } apy netApy performanceFee totalAssetsUsd
      }
    }`,
    { address, chainId: BASE_CHAIN_ID },
  ).then(({ vaultV2ByAddress: vault }) => {
    if (!vault || vault.apy === null || vault.netApy === null) throw new Error("Vault not found on Morpho");
    return {
      name: vault.name,
      symbol: vault.symbol,
      apy: vault.apy,
      netApy: vault.netApy,
      fee: vault.performanceFee ?? 0,
      totalAssetsUsd: vault.totalAssetsUsd ?? 0,
      assetSymbol: vault.asset.symbol,
      assetDecimals: vault.asset.decimals,
    };
  });
}

function fetchVaultStats(address: string, version: MorphoVersion) {
  const key = `${version}:${address.toLowerCase()}`;
  let request = vaultRequests.get(key);
  if (!request) {
    request = (version === "v2" ? queryVaultV2(address) : queryVaultV1(address)).catch((reason: unknown) => {
      vaultRequests.delete(key);
      throw reason;
    });
    vaultRequests.set(key, request);
  }
  return request;
}

/** Live APY, fee and TVL for a Morpho vault on Base. */
export function useMorphoVault(address: string | undefined, version: MorphoVersion = "v1") {
  const [data, setData] = useState<MorphoVaultStats>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(Boolean(address));

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- loading mirrors the external request.
    setIsLoading(true);
    fetchVaultStats(address, version)
      .then((stats) => {
        if (!cancelled) setData(stats);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load vault rates");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, version]);

  return { data, error, isLoading };
}

const marketRequests = new Map<string, Promise<Record<string, MorphoMarketStats>>>();

function fetchMarketStats(uniqueKeys: string[]) {
  const key = [...uniqueKeys].sort().join(":");
  let request = marketRequests.get(key);
  if (!request) {
    request = morphoQuery<{
      markets: {
        items: Array<{
          uniqueKey: string;
          state: { borrowApy: number; utilization: number; liquidityAssetsUsd: number } | null;
        }>;
      };
    }>(
      `query Markets($uniqueKeys: [String!]!, $chainId: Int!) {
        markets(where: { chainId_in: [$chainId], uniqueKey_in: $uniqueKeys }) {
          items { uniqueKey state { borrowApy utilization liquidityAssetsUsd } }
        }
      }`,
      { uniqueKeys, chainId: BASE_CHAIN_ID },
    )
      .then(({ markets }) => {
        const stats: Record<string, MorphoMarketStats> = {};
        for (const market of markets.items) {
          if (!market.state) continue;
          stats[market.uniqueKey.toLowerCase()] = {
            borrowApy: market.state.borrowApy,
            utilization: market.state.utilization,
            liquidityUsd: market.state.liquidityAssetsUsd,
          };
        }
        return stats;
      })
      .catch((reason: unknown) => {
        marketRequests.delete(key);
        throw reason;
      });
    marketRequests.set(key, request);
  }
  return request;
}

/** Live borrow APY, utilization and liquidity for Morpho Blue markets, keyed by lower-cased market ID. */
export function useMorphoMarkets(uniqueKeys: string[]) {
  const [stats, setStats] = useState<Record<string, MorphoMarketStats>>({});
  const requestKey = [...uniqueKeys].sort().join(":");

  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    fetchMarketStats(requestKey.split(":"))
      .then((nextStats) => {
        if (!cancelled) setStats(nextStats);
      })
      .catch(() => {
        if (!cancelled) setStats({});
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  return stats;
}
