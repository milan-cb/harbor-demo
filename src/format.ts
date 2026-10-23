import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export const publicClient = createPublicClient({ chain: base, transport: http() });

export function formatAmount(value: string, maximumFractionDigits = 4) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(amount);
}

export function formatExactAmount(value: string) {
  const [integer, fraction] = value.split(".");
  if (!integer || !/^-?\d+$/.test(integer)) return value;
  const formattedInteger = BigInt(integer).toLocaleString("en-US");
  return fraction ? `${formattedInteger}.${fraction}` : formattedInteger;
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
  }).format(value);
}

export function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(fraction: number | undefined, digits = 2) {
  return fraction === undefined || !Number.isFinite(fraction) ? "—" : `${(fraction * 100).toFixed(digits)}%`;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
