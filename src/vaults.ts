// The Morpho catalog vaults a CDP fee-earning vault can supply into, on Base.
// Addresses come from vault-tec's deployment registry (pkg/abi/registry/deployments.yaml).
export const CATALOG_VAULTS = {
  steakhouse: {
    name: "Steakhouse USDC",
    curator: "Steakhouse Financial",
    address: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
    morphoVersion: "v1",
  },
  gauntlet: {
    name: "Gauntlet USDC Prime",
    curator: "Gauntlet",
    address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    morphoVersion: "v1",
  },
  clearstar: {
    name: "Clearstar cbAssets Vault",
    curator: "Clearstar",
    address: "0x91C056B6d4311a743614FBc03ac32d4E6A2d3a3c",
    morphoVersion: "v2",
  },
  bitwise: {
    name: "Bitwise Liquid Prime USDC",
    curator: "Bitwise",
    address: "0x5e03f8965e2957291B3c6990C6Cb9023c36d3d30",
    morphoVersion: "v2",
  },
} as const;

export type CatalogKey = keyof typeof CATALOG_VAULTS;
export type CatalogVault = (typeof CATALOG_VAULTS)[CatalogKey];

export type LendVault = {
  /** The CDP fee-earning vault ID passed to deposit, withdraw and positions calls. */
  vaultId: string;
  /** The fee-earning vault's address. Optional; enables the vault fee, its TVL and the wallet balance. */
  address?: `0x${string}`;
  catalogKey: CatalogKey;
  catalog: CatalogVault;
};

export function morphoVaultUrl(catalog: CatalogVault) {
  const slug = catalog.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `https://app.morpho.org/base/vault/${catalog.address}/${slug}`;
}

const isAddress = (value: string | undefined): value is `0x${string}` => /^0x[a-fA-F0-9]{40}$/.test(value ?? "");

/**
 * Reads the Lend vaults from the environment.
 *
 * `VITE_CDP_VAULTS` is a comma-separated list of `catalog:vaultId[:address]`, where `catalog`
 * is one of the keys of {@link CATALOG_VAULTS}. Falls back to the single-vault
 * `VITE_CDP_VAULT_ID` / `VITE_CDP_VAULT_ADDRESS` pair, treated as Steakhouse USDC.
 */
export function readLendVaults(env: Record<string, string | undefined>): LendVault[] {
  const list = env.VITE_CDP_VAULTS?.trim();
  if (list) {
    return list.split(",").flatMap((entry) => {
      const [key, vaultId, address] = entry.trim().split(":").map((part) => part.trim());
      if (!key || !vaultId || !(key in CATALOG_VAULTS)) {
        console.warn(`Ignoring VITE_CDP_VAULTS entry "${entry}": expected catalog:vaultId[:address] with catalog one of ${Object.keys(CATALOG_VAULTS).join(", ")}`);
        return [];
      }
      const catalogKey = key as CatalogKey;
      return [{ vaultId, address: isAddress(address) ? address : undefined, catalogKey, catalog: CATALOG_VAULTS[catalogKey] }];
    });
  }
  const vaultId = env.VITE_CDP_VAULT_ID?.trim();
  if (!vaultId) return [];
  return [{
    vaultId,
    address: isAddress(env.VITE_CDP_VAULT_ADDRESS) ? env.VITE_CDP_VAULT_ADDRESS : undefined,
    catalogKey: "steakhouse",
    catalog: CATALOG_VAULTS.steakhouse,
  }];
}
