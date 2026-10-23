import { AlertTriangle, Bitcoin, Check, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

export function TokenIcon({ symbol }: { symbol: string }) {
  const normalized = symbol.toLowerCase();
  let icon: React.ReactNode = symbol.slice(0, 1);

  if (normalized === "cbbtc") {
    icon = (
      <img
        src="https://s2.coinmarketcap.com/static/img/coins/64x64/32994.png"
        srcSet="https://s2.coinmarketcap.com/static/img/coins/64x64/32994.png 1x, https://s2.coinmarketcap.com/static/img/coins/128x128/32994.png 2x"
        alt=""
      />
    );
  } else if (normalized.includes("btc")) {
    icon = <Bitcoin size={18} />;
  } else if (normalized === "cbeth") {
    icon = (
      <img
        src="https://s2.coinmarketcap.com/static/img/coins/64x64/21535.png"
        srcSet="https://s2.coinmarketcap.com/static/img/coins/64x64/21535.png 1x, https://s2.coinmarketcap.com/static/img/coins/128x128/21535.png 2x"
        alt=""
      />
    );
  } else if (normalized.includes("eth")) {
    icon = (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2 5.8 12.3 12 15.9l6.2-3.6L12 2Zm0 15.1-6.2-3.6L12 22l6.2-8.5-6.2 3.6Z" />
      </svg>
    );
  } else if (normalized === "sol") {
    icon = (
      <img
        src="https://s2.coinmarketcap.com/static/img/coins/64x64/16116.png"
        srcSet="https://s2.coinmarketcap.com/static/img/coins/64x64/16116.png 1x, https://s2.coinmarketcap.com/static/img/coins/128x128/16116.png 2x"
        alt=""
      />
    );
  } else if (normalized.includes("sol")) {
    icon = (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M6.1 5h13.2l-2.5 2.8H3.6L6.1 5Zm0 11.2h13.2L16.8 19H3.6l2.5-2.8Zm10.7-5.6H3.6l2.5 2.8h13.2l-2.5-2.8Z" />
      </svg>
    );
  } else if (normalized === "cbxrp") {
    icon = (
      <img
        src="https://s2.coinmarketcap.com/static/img/coins/64x64/36707.png"
        srcSet="https://s2.coinmarketcap.com/static/img/coins/64x64/36707.png 1x, https://s2.coinmarketcap.com/static/img/coins/128x128/36707.png 2x"
        alt=""
      />
    );
  } else if (normalized.includes("xrp")) {
    icon = (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M5.1 4h3.1c.6 0 1.1.2 1.5.6L12 6.9l2.3-2.3c.4-.4.9-.6 1.5-.6h3.1l-5.4 5.4a2.1 2.1 0 0 1-3 0L5.1 4Zm13.8 16h-3.1c-.6 0-1.1-.2-1.5-.6L12 17.1l-2.3 2.3c-.4.4-.9.6-1.5.6H5.1l5.4-5.4a2.1 2.1 0 0 1 3 0l5.4 5.4Z" />
      </svg>
    );
  } else if (normalized === "usdc") {
    icon = (
      <img
        src="https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png"
        srcSet="https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png 1x, https://s2.coinmarketcap.com/static/img/coins/128x128/3408.png 2x"
        alt=""
      />
    );
  } else if (normalized.includes("usd")) {
    icon = "$";
  }

  return (
    <span className={`token-icon token-${normalized}`}>
      {icon}
    </span>
  );
}

export function OperationProgress({
  title,
  detail,
  isConfirmed = false,
  confirmedLabel = "Refreshing position data",
}: {
  title: string;
  detail: string;
  isConfirmed?: boolean;
  confirmedLabel?: string;
}) {
  return (
    <div className="operation-state">
      <div className="operation-spinner">
        <span />
        <ShieldCheck size={24} />
      </div>
      <span className="operation-pill"><span /> In progress</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      <div className="operation-steps">
        <span className="complete"><Check size={13} /> Request prepared</span>
        <i />
        <span className="active">
          {isConfirmed ? <RefreshCw className="spin" size={13} /> : <LoaderCircle className="spin" size={13} />}
          {isConfirmed ? confirmedLabel : "Confirming on Base"}
        </span>
      </div>
    </div>
  );
}

export function OperationFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="operation-state operation-failure">
      <span className="failure-icon"><AlertTriangle size={24} /></span>
      <h3>Transaction not completed</h3>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>Review and try again</button>
    </div>
  );
}
