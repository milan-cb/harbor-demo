import {
  useDepositToVaultFromEvmSmartAccount,
  useListLendPositions,
  useWithdrawFromVaultWithEvmSmartAccount,
  type LendPositionsPage,
} from "@coinbase/cdp-hooks";
import { ArrowRight, Check, ChevronRight, Copy, ExternalLink, Leaf, LoaderCircle, RefreshCw, ShieldCheck, Sprout, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useMorphoVault } from "./morpho";
import { formatAmount, formatCompactUsd, formatPercent, formatUsd, shortAddress } from "./format";
import { OperationFailure, OperationProgress, TokenIcon } from "./shared";
import { useVaultOnchain, useVaultRefresh } from "./vault";
import { morphoVaultUrl, type LendVault } from "./vaults";

type LendViewProps = {
  smartAccount: `0x${string}` | undefined;
  /** The fee-earning vaults from `VITE_CDP_VAULTS`. */
  vaults: LendVault[];
  /** Called after a deposit or withdrawal confirms so the dashboard can refresh wallet balances. */
  onBalancesChanged?: () => void;
};

type LendAction = "deposit" | "withdraw";
type LendPosition = LendPositionsPage["lendPositions"][number];

/** The per-vault figures a card shows, handed to the dialog when it opens. */
type VaultFigures = {
  assetSymbol: string;
  assetDecimals: number;
  depositorApy: number | undefined;
  depositedAmount: string | undefined;
  positionShares: string;
  walletAmount: string | undefined;
};

type ActiveAction = { vault: LendVault; action: LendAction; figures: VaultFigures };

function VaultSetupCard() {
  return (
    <div className="vault-setup">
      <span className="vault-setup-icon"><Sprout size={22} /></span>
      <div>
        <strong>Connect your fee-earning vaults</strong>
        <p>
          Create vaults on the Morpho catalog from the CDP Portal, then list them in <code>.env</code> and restart the dev
          server. End users deposit into your vaults; you earn the performance fee.
        </p>
        <pre>{`# catalog:vaultId:vaultAddress, comma-separated (address optional)\n# catalog is one of steakhouse, gauntlet, clearstar, bitwise\nVITE_CDP_VAULTS=steakhouse:vault_...:0x...,gauntlet:vault_...:0x...`}</pre>
      </div>
    </div>
  );
}

export function LendView({ smartAccount, vaults, onBalancesChanged }: LendViewProps) {
  const { refreshKey, refresh } = useVaultRefresh();
  const positions = useListLendPositions({
    evmAddress: smartAccount,
    vaultIds: vaults.length ? vaults.map((vault) => vault.vaultId) : undefined,
    enabled: vaults.length > 0,
  });
  const [active, setActive] = useState<ActiveAction | null>(null);
  const isRefreshing = positions.status === "pending";

  const totalDeposited = positions.data?.lendPositions.reduce((sum, position) => sum + Number(position.assetBalance), 0);

  function refreshAll() {
    refresh();
    void positions.refetch();
  }

  return (
    <section id="vaults" className="section-block">
      <div className="section-title">
        <div>
          <span className="eyebrow muted">LEND VAULTS</span>
          <h2>Earn on your USDC</h2>
        </div>
        {vaults.length > 0 && (
          <button className="outline-button" onClick={refreshAll} disabled={isRefreshing}>
            <RefreshCw className={isRefreshing ? "spin" : ""} size={16} /> Refresh
          </button>
        )}
      </div>

      {vaults.length === 0 ? <VaultSetupCard /> : (
        <>
          {totalDeposited !== undefined && totalDeposited > 0 && (
            <p className="lend-summary">
              You have <strong>{formatAmount(String(totalDeposited), 6)} USDC</strong> earning across {positions.data?.lendPositions.length} {positions.data?.lendPositions.length === 1 ? "vault" : "vaults"}.
            </p>
          )}
          {positions.status === "error" && <div className="inline-warning">Lend positions unavailable: {positions.error?.message}</div>}
          <div className="market-grid">
            {vaults.map((vault) => (
              <VaultCard
                key={vault.vaultId}
                vault={vault}
                smartAccount={smartAccount}
                position={positions.data?.lendPositions.find((item) => item.vaultId === vault.vaultId)}
                positionsLoaded={Boolean(positions.data)}
                refreshKey={refreshKey}
                onAction={(action, figures) => setActive({ vault, action, figures })}
              />
            ))}
          </div>
        </>
      )}

      <div className="vault-notes">
        <div><ShieldCheck size={17} /><div><strong>One sponsored transaction</strong><span>Deposits and withdrawals each run as a single user operation from your smart account. Gas is covered by CDP.</span></div></div>
        <div><Leaf size={17} /><div><strong>Yield accrues to your shares</strong><span>Your deposit value grows as the underlying Morpho vault earns. The rate shown is after the curator's and your vault's fees.</span></div></div>
      </div>

      {active && smartAccount && (
        <LendActionDialog
          key={`${active.vault.vaultId}:${active.action}`}
          {...active}
          smartAccount={smartAccount}
          refetchPositions={positions.refetch}
          onSettled={() => { refresh(); onBalancesChanged?.(); }}
          onClose={() => setActive(null)}
        />
      )}
    </section>
  );
}

function VaultCard({
  vault,
  smartAccount,
  position,
  positionsLoaded,
  refreshKey,
  onAction,
}: {
  vault: LendVault;
  smartAccount: `0x${string}` | undefined;
  position: LendPosition | undefined;
  positionsLoaded: boolean;
  refreshKey: number;
  onAction: (action: LendAction, figures: VaultFigures) => void;
}) {
  const { catalog } = vault;
  const morpho = useMorphoVault(catalog.address, catalog.morphoVersion);
  const onchain = useVaultOnchain(vault.address, smartAccount, refreshKey);

  const assetSymbol = position?.underlyingAsset?.toUpperCase() ?? onchain.data?.assetSymbol ?? morpho.data?.assetSymbol ?? "USDC";
  const assetDecimals = onchain.data?.assetDecimals ?? morpho.data?.assetDecimals ?? 6;
  const performanceFee = onchain.data?.performanceFee;
  // The fee-earning vault takes its performance fee out of the yield the catalog vault
  // pays, so the depositor's rate is the catalog vault's net APY less that fee.
  const depositorApy = morpho.data && performanceFee !== undefined
    ? morpho.data.netApy * (1 - performanceFee)
    : morpho.data?.netApy;
  // Prefer the CDP positions API; fall back to the chain when it has not loaded.
  const depositedAmount = positionsLoaded
    ? position?.assetBalance ?? "0"
    : onchain.data ? formatUnits(onchain.data.depositAssets, assetDecimals) : undefined;
  const hasDeposit = depositedAmount !== undefined && Number(depositedAmount) > 0;
  const walletAmount = onchain.data ? formatUnits(onchain.data.walletAssets, assetDecimals) : undefined;
  const vaultTvl = onchain.data ? Number(formatUnits(onchain.data.totalAssets, assetDecimals)) : undefined;

  const figures: VaultFigures = {
    assetSymbol,
    assetDecimals,
    depositorApy,
    depositedAmount,
    positionShares: position?.vaultShares ?? "0",
    walletAmount,
  };
  const disabled = !smartAccount;

  return (
    <article className="market-card">
      <div className="market-card-top">
        <span className="vault-logo"><TokenIcon symbol={assetSymbol} /><i><Leaf size={11} /></i></span>
        {hasDeposit
          ? <span className="protocol-pill open-pill"><span className="status-dot" /> Earning</span>
          : <span className="protocol-pill">Morpho {catalog.morphoVersion.toUpperCase()}</span>}
      </div>
      <h3>{catalog.name}</h3>
      <p>
        Curated by {catalog.curator}
        {performanceFee !== undefined && ` · ${formatPercent(performanceFee, 0)} vault fee`}
        {" · "}
        <a href={morphoVaultUrl(catalog)} target="_blank" rel="noreferrer">Morpho <ExternalLink size={10} /></a>
      </p>
      <div className="market-stats market-stats-three">
        <div>
          <span>{performanceFee !== undefined ? "Your APY" : "Net APY"}</span>
          <strong>{morpho.isLoading && !morpho.data ? <LoaderCircle className="spin" size={15} /> : formatPercent(depositorApy)}</strong>
        </div>
        <div><span>Morpho TVL</span><strong>{morpho.data ? formatCompactUsd(morpho.data.totalAssetsUsd) : "—"}</strong></div>
        <div><span>Your vault</span><strong>{vaultTvl !== undefined ? formatUsd(vaultTvl) : "—"}</strong></div>
      </div>
      <div className="market-context">
        {hasDeposit ? (
          <>
            <span>Your deposit</span>
            <strong>{formatAmount(depositedAmount, assetDecimals)} {assetSymbol}</strong>
          </>
        ) : (
          <>
            <span>Available</span>
            <strong>{walletAmount !== undefined ? `${formatAmount(walletAmount, 2)} ${assetSymbol}` : "—"}</strong>
          </>
        )}
      </div>
      {onchain.error && <div className="inline-warning">Vault RPC unavailable: {onchain.error}</div>}
      {hasDeposit ? (
        <div className="market-card-actions">
          <button disabled={disabled} onClick={() => onAction("deposit", figures)}>Deposit more<ChevronRight size={17} /></button>
          <button className="secondary" disabled={disabled} onClick={() => onAction("withdraw", figures)}>Withdraw</button>
        </div>
      ) : (
        <button disabled={disabled} onClick={() => onAction("deposit", figures)}>Deposit {assetSymbol}<ChevronRight size={17} /></button>
      )}
    </article>
  );
}

function LendActionDialog({
  vault,
  action,
  figures,
  smartAccount,
  refetchPositions,
  onSettled,
  onClose,
}: ActiveAction & {
  smartAccount: `0x${string}`;
  refetchPositions: () => Promise<{ data: LendPositionsPage | undefined; status: string }>;
  onSettled: () => void;
  onClose: () => void;
}) {
  const { vaultId, catalog } = vault;
  const { assetSymbol, assetDecimals, depositorApy, depositedAmount, positionShares, walletAmount } = figures;
  const deposit = useDepositToVaultFromEvmSmartAccount();
  const withdraw = useWithdrawFromVaultWithEvmSmartAccount();
  const isWithdraw = action === "withdraw";
  const operation = isWithdraw ? withdraw : deposit;
  const actionLabel = isWithdraw ? "Withdraw" : "Deposit";

  const [amount, setAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [synced, setSynced] = useState(false);
  const [copied, setCopied] = useState(false);
  const handledUserOp = useRef<string | undefined>(undefined);
  const baselineShares = useRef(positionShares);

  // Callbacks live in refs so a re-render does not cancel and restart an in-flight poll.
  const refetchRef = useRef(refetchPositions);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    refetchRef.current = refetchPositions;
    onSettledRef.current = onSettled;
  });

  const operationStatus = operation.status;
  const operationUserOp = operation.data?.userOpHash;

  // The positions API reads balances live, so polling it after a confirmed user
  // operation shows when the new share balance is visible.
  useEffect(() => {
    if (operationStatus !== "success" || !operationUserOp) return;
    if (handledUserOp.current === operationUserOp) return;
    handledUserOp.current = operationUserOp;
    let cancelled = false;
    let timer: number | undefined;
    const sleep = () => new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 2000); });

    const poll = async () => {
      for (let attempt = 0; attempt < 15 && !cancelled; attempt += 1) {
        if (attempt > 0) await sleep();
        if (cancelled) return;
        const result = await refetchRef.current();
        if (result.status !== "success") continue;
        const next = result.data?.lendPositions.find((item) => item.vaultId === vaultId)?.vaultShares ?? "0";
        if (next !== baselineShares.current) return;
      }
    };

    void poll().finally(() => {
      if (cancelled) return;
      onSettledRef.current();
      setSynced(true);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Let the next run pick this user operation up again.
      handledUserOp.current = undefined;
    };
  }, [operationStatus, operationUserOp, vaultId]);

  const amountNumber = Number(amount);
  const amountIsValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const limit = isWithdraw ? depositedAmount : walletAmount;
  const exceedsLimit = !withdrawAll && limit !== undefined && amountIsValid && amountNumber > Number(limit);
  const projectedYearly = depositorApy !== undefined && amountIsValid ? amountNumber * depositorApy : undefined;
  const displayedAmount = isWithdraw && withdrawAll ? depositedAmount ?? amount : amount;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!withdrawAll && !amountIsValid) return;
    setSubmitted(true);
    if (isWithdraw) {
      await withdraw.withdrawFromVaultWithEvmSmartAccount({
        vaultId,
        evmSmartAccount: smartAccount,
        ...(withdrawAll ? { withdrawAll: true } : { amount }),
        useCdpPaymaster: true,
      });
    } else {
      await deposit.depositToVaultFromEvmSmartAccount({ vaultId, evmSmartAccount: smartAccount, amount, useCdpPaymaster: true });
    }
  }

  function retry() {
    operation.reset();
    setSubmitted(false);
    setSynced(false);
  }

  function copyUserOp(hash: string) {
    void navigator.clipboard.writeText(hash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="borrow-modal" role="dialog" aria-modal="true" aria-labelledby="lend-action-title">
        <button className="modal-close" onClick={onClose}><X size={20} /></button>
        <span className="eyebrow muted">{actionLabel.toUpperCase()}</span>
        <h2 id="lend-action-title">{actionLabel} {assetSymbol}</h2>
        <p>
          {isWithdraw
            ? `Redeem ${catalog.name} vault shares for ${assetSymbol}, sent back to your smart account.`
            : `Supply ${assetSymbol} from your smart account and start earning ${catalog.name} yield.`}
        </p>

        <div className="borrow-pair">
          {isWithdraw ? (
            <>
              <div><span>You redeem</span><strong><span className="vault-share-icon"><Leaf size={13} /></span> Vault shares</strong></div>
              <ArrowRight size={18} />
              <div><span>You receive</span><strong><TokenIcon symbol={assetSymbol} /> {assetSymbol}</strong></div>
            </>
          ) : (
            <>
              <div><span>You deposit</span><strong><TokenIcon symbol={assetSymbol} /> {assetSymbol}</strong></div>
              <ArrowRight size={18} />
              <div><span>You receive</span><strong><span className="vault-share-icon"><Leaf size={13} /></span> Vault shares</strong></div>
            </>
          )}
        </div>

        {operation.status === "success" && operation.data?.userOpHash && synced ? (
          <div className="success-state">
            <span className="success-icon"><Check size={26} /></span>
            <h3>{actionLabel} confirmed</h3>
            <p>
              {isWithdraw
                ? `${formatAmount(displayedAmount, assetDecimals)} ${assetSymbol} is back in your smart account.`
                : `${formatAmount(displayedAmount, assetDecimals)} ${assetSymbol} is now earning in ${catalog.name}.`}
            </p>
            <button className="userop-pill" onClick={() => copyUserOp(operation.data?.userOpHash ?? "")}>
              User operation {shortAddress(operation.data.userOpHash)} {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button className="primary-button" onClick={onClose}>Back to vaults</button>
          </div>
        ) : submitted ? (
          operation.status === "error" ? (
            <OperationFailure message={operation.error?.message ?? `The ${actionLabel.toLowerCase()} could not be completed.`} onRetry={retry} />
          ) : (
            <OperationProgress
              title={operation.status === "success" ? "Refreshing your vault balance" : isWithdraw ? "Withdrawing from the vault" : "Depositing into the vault"}
              detail={operation.status === "success"
                ? "The user operation is confirmed. We are waiting for your new vault balance to appear."
                : isWithdraw
                  ? `Your vault shares are being redeemed for ${assetSymbol}. This screen will update automatically after confirmation.`
                  : `Your ${assetSymbol} is being supplied to the vault. This screen will update automatically after confirmation.`}
              isConfirmed={operation.status === "success"}
              confirmedLabel="Refreshing vault balance"
            />
          )
        ) : (
          <form onSubmit={submit} className="borrow-form">
            <label>
              <span>Amount</span>
              <div className="amount-field">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => { setAmount(event.target.value); setWithdrawAll(false); }}
                  autoFocus
                  required
                />
                {limit !== undefined && Number(limit) > 0 && (
                  <button type="button" className="max-button" onClick={() => { setAmount(limit); setWithdrawAll(isWithdraw); }}>Max</button>
                )}
                <b>{assetSymbol}</b>
              </div>
              <small className={`input-estimate ${exceedsLimit ? "input-estimate-warning" : ""}`}>
                {isWithdraw && withdrawAll
                  ? "Withdrawing your full position, including yield accrued until execution"
                  : limit !== undefined
                    ? exceedsLimit
                      ? `Exceeds your ${isWithdraw ? "deposit" : "balance"} of ${formatAmount(limit, isWithdraw ? assetDecimals : 2)} ${assetSymbol}`
                      : `${isWithdraw ? "Deposited" : "Available"}: ${formatAmount(limit, isWithdraw ? assetDecimals : 2)} ${assetSymbol}`
                    : amountIsValid ? `Approximately ${formatUsd(amountNumber)}` : `Enter the amount to ${isWithdraw ? "withdraw" : "supply"}`}
              </small>
            </label>

            {!isWithdraw && (
              <div className="yield-preview">
                <div className="yield-preview-values">
                  <div><span>Your APY</span><strong>{formatPercent(depositorApy)}</strong></div>
                  <div><span>Projected yearly earnings</span><strong>{projectedYearly !== undefined ? `≈ ${formatUsd(projectedYearly)}` : "—"}</strong></div>
                </div>
                <div className="yield-preview-caption">
                  <span>Variable rate, compounds continuously</span>
                  <span>Source: Morpho</span>
                </div>
              </div>
            )}

            <div className="borrow-summary">
              <div><span>Vault</span><strong>{catalog.name}</strong></div>
              <div><span>{isWithdraw ? "Recipient" : "Receiver"}</span><strong>{shortAddress(smartAccount)}</strong></div>
              {isWithdraw && <div><span>Max slippage</span><strong>1%</strong></div>}
              <div><span>Network fee</span><strong className="free-label">Sponsored</strong></div>
            </div>

            <button className="primary-button" disabled={operation.status === "pending" || (!withdrawAll && !amountIsValid) || exceedsLimit}>
              {operation.status === "pending"
                ? <><LoaderCircle className="spin" size={18} /> Confirming on Base</>
                : <>Confirm {actionLabel.toLowerCase()} <ArrowRight size={18} /></>}
            </button>
            <p className="risk-copy">
              {isWithdraw
                ? "Withdrawals depend on available liquidity in the underlying Morpho markets."
                : "Yield is variable and not guaranteed. You can withdraw at any time, subject to vault liquidity."}
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
