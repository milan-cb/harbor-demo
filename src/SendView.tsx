import { useCurrentUser, useSendEvmSmartAccountUsdc } from "@coinbase/cdp-hooks";
import { ArrowRight, Check, Copy, LoaderCircle, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { erc20Abi, formatUnits, isAddress } from "viem";
import { formatAmount, publicClient, shortAddress } from "./format";
import { OperationFailure, OperationProgress, TokenIcon } from "./shared";

// Native USDC on Base.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;

type SendViewProps = {
  smartAccount: `0x${string}` | undefined;
  /** Called after a send confirms so the dashboard can refresh wallet balances. */
  onSent?: () => void;
};

function useUsdcBalance(account: `0x${string}` | undefined, refreshKey: number) {
  const [balance, setBalance] = useState<string>();
  const [isLoading, setIsLoading] = useState(Boolean(account));

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- loading mirrors the external RPC request.
    setIsLoading(true);
    publicClient
      .readContract({ authorizationList: undefined, address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [account] })
      .then((value) => { if (!cancelled) setBalance(formatUnits(value, USDC_DECIMALS)); })
      .catch(() => { if (!cancelled) setBalance(undefined); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [account, refreshKey]);

  return { balance, isLoading };
}

export function SendView({ smartAccount, onSent }: SendViewProps) {
  // Remounting the form resets the send hook, which has no reset of its own.
  const [formKey, setFormKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const { balance, isLoading } = useUsdcBalance(smartAccount, refreshKey);

  return (
    <section id="send" className="section-block">
      <div className="section-title">
        <div><span className="eyebrow muted">SEND</span><h2>Send USDC</h2></div>
        {smartAccount && (
          <button className="outline-button" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={isLoading ? "spin" : ""} size={16} /> Refresh
          </button>
        )}
      </div>

      {smartAccount ? (
        <SendForm
          key={formKey}
          smartAccount={smartAccount}
          balance={balance}
          onSent={() => { refresh(); onSent?.(); }}
          onReset={() => setFormKey((value) => value + 1)}
        />
      ) : (
        <article className="vault-card vault-card-muted"><p>Sign in to send USDC from your smart account.</p></article>
      )}
    </section>
  );
}

function SendForm({
  smartAccount,
  balance,
  onSent,
  onReset,
}: {
  smartAccount: `0x${string}`;
  balance: string | undefined;
  onSent: () => void;
  onReset: () => void;
}) {
  const { currentUser } = useCurrentUser();
  const send = useSendEvmSmartAccountUsdc();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [userOpHash, setUserOpHash] = useState<string>();
  const [copied, setCopied] = useState(false);

  const ownEoa = currentUser?.evmAccounts?.[0];
  const recipientIsValid = isAddress(recipient);
  const isSelf = recipientIsValid && recipient.toLowerCase() === smartAccount.toLowerCase();
  const amountNumber = Number(amount);
  const amountIsValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const exceedsBalance = balance !== undefined && amountIsValid && amountNumber > Number(balance);
  const isConfirmed = send.status === "success";
  const failure = submitError ?? (send.status === "error" ? send.error?.message ?? "The transfer failed." : undefined);

  // onSent is recreated each render; keep the latest in a ref so it fires once per confirmation.
  const onSentRef = useRef(onSent);
  useEffect(() => {
    onSentRef.current = onSent;
  });
  useEffect(() => {
    if (isConfirmed) onSentRef.current();
  }, [isConfirmed]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!recipientIsValid || isSelf || !amountIsValid || exceedsBalance) return;
    setSubmitError(undefined);
    setIsSubmitting(true);
    try {
      const result = await send.sendEvmSmartAccountUsdc({
        evmSmartAccount: smartAccount,
        to: recipient,
        amount,
        network: "base",
        useCdpPaymaster: true,
      });
      setUserOpHash(result.userOpHash);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : "The transfer could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function copyUserOp(hash: string) {
    void navigator.clipboard.writeText(hash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (failure) {
    return <article className="vault-card"><OperationFailure message={failure} onRetry={onReset} /></article>;
  }

  if (isConfirmed && userOpHash) {
    return (
      <article className="vault-card">
        <div className="success-state">
          <span className="success-icon"><Check size={26} /></span>
          <h3>Transfer confirmed</h3>
          <p>{formatAmount(amount, USDC_DECIMALS)} USDC was sent to {shortAddress(recipient)}.</p>
          <button className="userop-pill" onClick={() => copyUserOp(userOpHash)}>
            User operation {shortAddress(userOpHash)} {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button className="primary-button" onClick={onReset}>Send again</button>
        </div>
      </article>
    );
  }

  if (userOpHash) {
    return (
      <article className="vault-card">
        <OperationProgress
          title="Sending USDC"
          detail={`${formatAmount(amount, USDC_DECIMALS)} USDC is on its way to ${shortAddress(recipient)}. This screen will update after confirmation.`}
        />
      </article>
    );
  }

  return (
    <article className="vault-card">
      <form onSubmit={submit} className="borrow-form">
        <label>
          <span>Recipient</span>
          <div className="amount-field">
            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) => setRecipient(event.target.value.trim())}
              spellCheck={false}
              autoFocus
              required
            />
            {ownEoa && recipient.toLowerCase() !== ownEoa.toLowerCase() && (
              <button type="button" className="max-button" onClick={() => setRecipient(ownEoa)}>My EOA</button>
            )}
          </div>
          <small className={`input-estimate ${recipient && (!recipientIsValid || isSelf) ? "input-estimate-warning" : ""}`}>
            {!recipient
              ? "Any address on Base"
              : !recipientIsValid
                ? "Enter a valid 0x address"
                : isSelf
                  ? "That is the sending smart account"
                  : ownEoa && recipient.toLowerCase() === ownEoa.toLowerCase()
                    ? "Your embedded wallet EOA"
                    : `Sending to ${shortAddress(recipient)}`}
          </small>
        </label>

        <label>
          <span>Amount</span>
          <div className="amount-field">
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            {balance !== undefined && Number(balance) > 0 && (
              <button type="button" className="max-button" onClick={() => setAmount(balance)}>Max</button>
            )}
            <b>USDC</b>
          </div>
          <small className={`input-estimate ${exceedsBalance ? "input-estimate-warning" : ""}`}>
            {balance === undefined
              ? "Loading balance"
              : exceedsBalance
                ? `Exceeds your balance of ${formatAmount(balance, USDC_DECIMALS)} USDC`
                : `Available: ${formatAmount(balance, USDC_DECIMALS)} USDC`}
          </small>
        </label>

        <div className="borrow-summary">
          <div><span>Asset</span><strong><TokenIcon symbol="USDC" /> USDC on Base</strong></div>
          <div><span>From</span><strong>{shortAddress(smartAccount)}</strong></div>
          <div><span>Network fee</span><strong className="free-label">Sponsored</strong></div>
        </div>

        <button className="primary-button" disabled={isSubmitting || !recipientIsValid || isSelf || !amountIsValid || exceedsBalance}>
          {isSubmitting
            ? <><LoaderCircle className="spin" size={18} /> Submitting</>
            : <><Send size={16} /> Send USDC <ArrowRight size={18} /></>}
        </button>
        <p className="risk-copy">Transfers are final. Double-check the recipient address before sending.</p>
      </form>
    </article>
  );
}
