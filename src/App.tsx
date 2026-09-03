import {
  useAdjustBorrowPosition,
  useCloseBorrowPosition,
  useCreateBorrowPosition,
  useCurrentUser,
  useEvmSmartAccounts,
  useIsInitialized,
  useListBorrowPositions,
  useListEvmBorrowProducts,
  useSignInWithEmail,
  useSignOut,
  useVerifyEmailOTP,
  type BorrowPositionsPage,
  type EvmBorrowProductsPage,
} from "@coinbase/cdp-hooks";
import {
  AlertTriangle,
  ArrowRight,
  Bitcoin,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Landmark,
  LoaderCircle,
  LogOut,
  Moon,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { base } from "viem/chains";
import "./App.css";

type Product = EvmBorrowProductsPage["borrowProducts"][number];
type Position = BorrowPositionsPage["borrowPositions"][number];
type Token = Product["assets"][number]["token"];
type TokenBalance = Token & { amount: string; rawAmount: bigint };
type UsdPrices = Record<string, number>;
type AdjustAction = "addCollateral" | "borrowMore" | "removeCollateral" | "repayDebt";
type AdjustAmounts = Record<AdjustAction, string>;
type Theme = "light" | "dark";

const publicClient = createPublicClient({ chain: base, transport: http() });
const EMPTY_PRODUCTS: Product[] = [];
const FEATURED_MARKETS = [
  { collateralSymbols: ["CBBTC"], debtSymbol: "USDC" },
  { collateralSymbols: ["CBETH"], debtSymbol: "USDC" },
  { collateralSymbols: ["CBXRP"], debtSymbol: "USDC" },
  { collateralSymbols: ["SOL", "CBSOL"], debtSymbol: "USDC" },
] as const;
const EMPTY_ADJUST_AMOUNTS: AdjustAmounts = {
  addCollateral: "",
  borrowMore: "",
  removeCollateral: "",
  repayDebt: "",
};
const balanceRequests = new Map<string, Promise<TokenBalance[]>>();
let exchangeRatesRequest: Promise<Record<string, string>> | undefined;

function getPriceTicker(symbol: string) {
  const normalized = symbol.toUpperCase();
  if (normalized === "CBBTC" || normalized === "WBTC") return "BTC";
  if (normalized === "CBETH" || normalized === "WETH") return "ETH";
  if (normalized === "CBXRP") return "XRP";
  if (normalized === "CBSOL") return "SOL";
  if (normalized === "USDBC") return "USDC";
  return normalized;
}

async function fetchExchangeRates() {
  if (!exchangeRatesRequest) {
    exchangeRatesRequest = fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Price request failed with status ${response.status}`);
        const result = await response.json() as { data: { rates: Record<string, string> } };
        return result.data.rates;
      })
      .catch((reason) => {
        exchangeRatesRequest = undefined;
        throw reason;
      });
  }
  return exchangeRatesRequest;
}

async function fetchTokenBalances(address: `0x${string}`, tokens: Token[]) {
  const results = await publicClient.multicall({
    allowFailure: true,
    authorizationList: undefined,
    contracts: tokens.map((token) => ({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address],
    })),
  });

  return tokens.map((token, index) => {
    const result = results[index];
    const rawAmount = result?.status === "success" ? (result.result as bigint) : 0n;
    return { ...token, rawAmount, amount: formatUnits(rawAmount, token.decimals) };
  });
}

function formatAmount(value: string, maximumFractionDigits = 4) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(amount);
}

function formatExactAmount(value: string) {
  const [integer, fraction] = value.split(".");
  if (!integer || !/^-?\d+$/.test(integer)) return value;
  const formattedInteger = BigInt(integer).toLocaleString("en-US");
  return fraction ? `${formattedInteger}.${fraction}` : formattedInteger;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
  }).format(value);
}

function estimateUsd(amount: string, symbol: string, prices: UsdPrices) {
  const price = prices[getPriceTicker(symbol)];
  const numericAmount = Number(amount);
  return price !== undefined && Number.isFinite(numericAmount) ? numericAmount * price : undefined;
}

function estimateAssetListUsd(
  assets: Array<{ amount: string; token: { symbol: string } }>,
  prices: UsdPrices,
) {
  const estimates = assets.map((asset) => estimateUsd(asset.amount, asset.token.symbol, prices));
  return estimates.every((estimate) => estimate !== undefined)
    ? estimates.reduce<number>((total, estimate) => total + (estimate ?? 0), 0)
    : undefined;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getProductAssets(product: Product) {
  const collateral = product.assets.find((asset) =>
    asset.capabilities.some((capability) => capability.type === "collateral" && capability.enabled),
  );
  const debt = product.assets.find((asset) =>
    asset.capabilities.some((capability) => capability.type === "debt" && capability.enabled),
  );
  return { collateral, debt };
}

function useTokenBalances(address: `0x${string}` | undefined, products: Product[], refreshKey: number) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const tokens = useMemo(
    () =>
      Array.from(
        new Map(
          products.flatMap((product) => product.assets.map((asset) => asset.token)).map((token) => [
            token.address.toLowerCase(),
            token,
          ]),
        ).values(),
      ),
    [products],
  );
  const tokenKey = tokens.map((token) => token.address).sort().join(":");

  useEffect(() => {
    if (!address || tokens.length === 0) {
      return;
    }

    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- loading mirrors the external RPC request.
    setIsLoading(true);
    setError(undefined);

    const requestKey = `${address}:${tokenKey}:${refreshKey}`;
    let request = balanceRequests.get(requestKey);
    if (!request) {
      request = fetchTokenBalances(address, tokens).catch((reason) => {
        balanceRequests.delete(requestKey);
        throw reason;
      });
      balanceRequests.set(requestKey, request);
    }

    request
      .then((nextBalances) => {
        if (!cancelled) setBalances(nextBalances);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load balances");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, tokenKey, refreshKey, tokens]);

  return { balances, isLoading, error };
}

function useUsdPrices(symbols: string[]) {
  const [prices, setPrices] = useState<UsdPrices>({});
  const tickerKey = Array.from(new Set(symbols.map(getPriceTicker))).sort().join(":");

  useEffect(() => {
    if (!tickerKey) return;
    let cancelled = false;

    void fetchExchangeRates().then((rates) => {
      if (cancelled) return;
      const nextPrices: UsdPrices = {};
      for (const ticker of tickerKey.split(":")) {
        const rate = Number(rates[ticker]);
        if (Number.isFinite(rate) && rate > 0) nextPrices[ticker] = 1 / rate;
      }
      setPrices(nextPrices);
    }).catch(() => {
      if (!cancelled) setPrices({});
    });

    return () => {
      cancelled = true;
    };
  }, [tickerKey]);

  return prices;
}

async function pollForPositionState(
  refetch: () => Promise<{ data: BorrowPositionsPage | undefined }>,
  isFresh: (positions: Position[]) => boolean,
) {
  let latestPositions: Position[] | undefined;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const result = await refetch();
    if (result.data) latestPositions = result.data.borrowPositions;
    if (latestPositions && isFresh(latestPositions)) return latestPositions;
  }
  return latestPositions;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Landmark size={19} strokeWidth={2.4} /></span>
      <span>Harbor</span>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button className="theme-toggle" onClick={onToggle} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
      <span className={theme === "light" ? "active" : ""}><Sun size={14} /></span>
      <span className={theme === "dark" ? "active" : ""}><Moon size={14} /></span>
    </button>
  );
}

function SignIn({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [flowId, setFlowId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const result = await signInWithEmail({ email });
      setFlowId(result.flowId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send a sign-in code");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOtpSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      await verifyEmailOTP({ flowId, otp });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That code could not be verified");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow"><Sparkles size={14} /> Onchain credit, simplified</span>
          <h1>Put your bitcoin to work.</h1>
          <p>Borrow stablecoins against your assets without leaving the Base ecosystem.</p>
        </div>
        <div className="story-card">
          <div className="coin-orbit"><Bitcoin size={38} /></div>
          <div>
            <span>Collateral stays yours</span>
            <strong>Unlock liquidity without selling</strong>
          </div>
        </div>
        <p className="story-footnote">Powered by CDP Smart Accounts and Morpho</p>
      </section>

      <section className="auth-panel">
        <div className="auth-theme-toggle"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
        <div className="auth-card">
          <span className="auth-kicker">WELCOME TO HARBOR</span>
          <h2>{flowId ? "Check your inbox" : "Access your credit line"}</h2>
          <p className="auth-description">
            {flowId ? `Enter the six-digit code sent to ${email}.` : "Sign in securely. Your smart account is created automatically."}
          </p>

          {!flowId ? (
            <form onSubmit={handleEmailSubmit}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoFocus
                required
              />
              <button className="primary-button" disabled={isLoading || !email}>
                {isLoading ? <LoaderCircle className="spin" size={18} /> : <>Continue <ArrowRight size={18} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <label htmlFor="otp">Verification code</label>
              <input
                id="otp"
                className="otp-input"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                autoFocus
                required
              />
              <button className="primary-button" disabled={isLoading || otp.length !== 6}>
                {isLoading ? <LoaderCircle className="spin" size={18} /> : <>Verify and continue <ArrowRight size={18} /></>}
              </button>
              <button type="button" className="text-button" onClick={() => { setFlowId(""); setOtp(""); }}>
                Use a different email
              </button>
            </form>
          )}

          {error && <div className="error-message">{error}</div>}
          <div className="security-note"><ShieldCheck size={18} /> Non-custodial. Secured by your embedded wallet.</div>
        </div>
      </section>
    </main>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  const normalized = symbol.toLowerCase();
  let icon: React.ReactNode = symbol.slice(0, 1);

  if (normalized.includes("btc")) {
    icon = <Bitcoin size={18} />;
  } else if (normalized.includes("eth")) {
    icon = (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2 5.8 12.3 12 15.9l6.2-3.6L12 2Zm0 15.1-6.2-3.6L12 22l6.2-8.5-6.2 3.6Z" />
      </svg>
    );
  } else if (normalized.includes("sol")) {
    icon = (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M6.1 5h13.2l-2.5 2.8H3.6L6.1 5Zm0 11.2h13.2L16.8 19H3.6l2.5-2.8Zm10.7-5.6H3.6l2.5 2.8h13.2l-2.5-2.8Z" />
      </svg>
    );
  } else if (normalized.includes("xrp")) {
    icon = (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M5.1 4h3.1c.6 0 1.1.2 1.5.6L12 6.9l2.3-2.3c.4-.4.9-.6 1.5-.6h3.1l-5.4 5.4a2.1 2.1 0 0 1-3 0L5.1 4Zm13.8 16h-3.1c-.6 0-1.1-.2-1.5-.6L12 17.1l-2.3 2.3c-.4.4-.9.6-1.5.6H5.1l5.4-5.4a2.1 2.1 0 0 1 3 0l5.4 5.4Z" />
      </svg>
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

function OperationProgress({ title, detail, isConfirmed = false }: { title: string; detail: string; isConfirmed?: boolean }) {
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
          {isConfirmed ? "Refreshing position data" : "Confirming on Base"}
        </span>
      </div>
    </div>
  );
}

function OperationFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="operation-state operation-failure">
      <span className="failure-icon"><AlertTriangle size={24} /></span>
      <h3>Transaction not completed</h3>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry}>Review and try again</button>
    </div>
  );
}

function Dashboard({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { currentUser } = useCurrentUser();
  const { evmSmartAccounts } = useEvmSmartAccounts();
  const { signOut } = useSignOut();
  const [selectedProductId, setSelectedProductId] = useState<string>();
  const [collateralAmount, setCollateralAmount] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [borrowSubmitted, setBorrowSubmitted] = useState(false);
  const [createSynced, setCreateSynced] = useState(false);
  const [isBorrowOpen, setIsBorrowOpen] = useState(false);
  const [positionAction, setPositionAction] = useState<"adjust" | "close" | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string>();
  const [actionPosition, setActionPosition] = useState<Position>();
  const [selectedAdjustActions, setSelectedAdjustActions] = useState<AdjustAction[]>([]);
  const [adjustAmounts, setAdjustAmounts] = useState<AdjustAmounts>({ ...EMPTY_ADJUST_AMOUNTS });
  const [adjustSubmitted, setAdjustSubmitted] = useState(false);
  const [adjustSynced, setAdjustSynced] = useState(false);
  const [closeConfirmed, setCloseConfirmed] = useState(false);
  const [closeSubmitted, setCloseSubmitted] = useState(false);
  const [closeSynced, setCloseSynced] = useState(false);
  const [activeTab, setActiveTab] = useState<"markets" | "positions">("markets");
  const [expandedPositionId, setExpandedPositionId] = useState<string>();
  const [latestPositions, setLatestPositions] = useState<Position[]>();
  const [copied, setCopied] = useState(false);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const handledUserOp = useRef<string | undefined>(undefined);
  const handledAdjustUserOp = useRef<string | undefined>(undefined);
  const handledCloseUserOp = useRef<string | undefined>(undefined);
  const adjustBaselineBlock = useRef<number | undefined>(undefined);
  const adjustTargetId = useRef<string | undefined>(undefined);
  const closeTargetId = useRef<string | undefined>(undefined);
  const createTargetId = useRef<string | undefined>(undefined);

  const smartAccount = evmSmartAccounts?.[0]?.address as `0x${string}` | undefined;
  const email = currentUser?.authenticationMethods?.email?.email;
  const productsQuery = useListEvmBorrowProducts({ network: "base", protocol: "morpho_blue", pageSize: 100 });
  const allProducts = productsQuery.data?.borrowProducts ?? EMPTY_PRODUCTS;
  const products = useMemo(
    () =>
      FEATURED_MARKETS.flatMap((market) => {
        const product = allProducts.find((candidate) => {
          const { collateral, debt } = getProductAssets(candidate);
          return Boolean(
            collateral &&
            debt &&
            market.collateralSymbols.some((symbol) => symbol === collateral.token.symbol.toUpperCase()) &&
            debt.token.symbol.toUpperCase() === market.debtSymbol,
          );
        });
        return product ? [product] : [];
      }),
    [allProducts],
  );
  const activeProductId = selectedProductId ?? products[0]?.borrowProductId;
  const selectedProduct = products.find((product) => product.borrowProductId === activeProductId);
  const selectedAssets = selectedProduct ? getProductAssets(selectedProduct) : undefined;
  const positionsQuery = useListBorrowPositions({
    evmSmartAccount: smartAccount,
    pageSize: 20,
    enabled: Boolean(smartAccount),
  });
  const positions = latestPositions ?? positionsQuery.data?.borrowPositions ?? [];
  const refetchPositions = positionsQuery.refetch;
  const createPosition = useCreateBorrowPosition();
  const adjustPosition = useAdjustBorrowPosition();
  const closePosition = useCloseBorrowPosition();
  const tokenBalances = useTokenBalances(smartAccount, products, balanceRefreshKey);
  const usdPrices = useUsdPrices([
    ...products.flatMap((product) => product.assets.map((asset) => asset.token.symbol)),
    ...positions.flatMap((position) => [
      ...position.onchainState.collateral.map((asset) => asset.token.symbol),
      ...position.onchainState.debt.map((asset) => asset.token.symbol),
    ]),
  ]);
  const selectedPosition = positions.find(
    (position) => position.borrowProductId === selectedPositionId,
  ) ?? actionPosition;

  useEffect(() => {
    if (createPosition.status !== "success" || !createPosition.data?.userOpHash) return;
    if (handledUserOp.current === createPosition.data.userOpHash) return;
    handledUserOp.current = createPosition.data.userOpHash;
    setBalanceRefreshKey((value) => value + 1);
    const targetId = createTargetId.current;
    void pollForPositionState(
      refetchPositions,
      (positions) => positions.some((position) => position.borrowProductId === targetId),
    ).then((freshPositions) => {
      if (freshPositions) setLatestPositions(freshPositions);
    }).finally(() => setCreateSynced(true));
  }, [createPosition.status, createPosition.data?.userOpHash, refetchPositions]);

  useEffect(() => {
    if (adjustPosition.status !== "success" || !adjustPosition.data?.userOpHash) return;
    if (handledAdjustUserOp.current === adjustPosition.data.userOpHash) return;
    handledAdjustUserOp.current = adjustPosition.data.userOpHash;
    setBalanceRefreshKey((value) => value + 1);
    const targetId = adjustTargetId.current;
    const baselineBlock = adjustBaselineBlock.current;
    void pollForPositionState(
      refetchPositions,
      (positions) => positions.some(
        (position) =>
          position.borrowProductId === targetId &&
          (baselineBlock === undefined || position.snapshot.blockNumber > baselineBlock),
      ),
    ).then((freshPositions) => {
      if (freshPositions) setLatestPositions(freshPositions);
    }).finally(() => setAdjustSynced(true));
  }, [adjustPosition.status, adjustPosition.data?.userOpHash, refetchPositions]);

  useEffect(() => {
    if (closePosition.status !== "success" || !closePosition.data?.userOpHash) return;
    if (handledCloseUserOp.current === closePosition.data.userOpHash) return;
    handledCloseUserOp.current = closePosition.data.userOpHash;
    setBalanceRefreshKey((value) => value + 1);
    const targetId = closeTargetId.current;
    void pollForPositionState(
      refetchPositions,
      (positions) => !positions.some((position) => position.borrowProductId === targetId),
    ).then((freshPositions) => {
      if (freshPositions) setLatestPositions(freshPositions);
    }).finally(() => setCloseSynced(true));
  }, [closePosition.status, closePosition.data?.userOpHash, refetchPositions]);

  useEffect(() => {
    if (activeTab !== "positions" || !expandedPositionId) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-position-id="${expandedPositionId}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, expandedPositionId, positions.length]);

  function openBorrow(product: Product) {
    createPosition.reset();
    setSelectedProductId(product.borrowProductId);
    setCollateralAmount("");
    setLoanAmount("");
    setBorrowSubmitted(false);
    setCreateSynced(false);
    setIsBorrowOpen(true);
  }

  async function submitBorrow(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProduct || !collateralAmount || !loanAmount) return;
    createTargetId.current = selectedProduct.borrowProductId;
    setCreateSynced(false);
    setBorrowSubmitted(true);
    await createPosition.createBorrowPosition({
      borrowProductId: selectedProduct.borrowProductId,
      collateralAmount,
      loanAmount,
      useCdpPaymaster: true,
    });
  }

  function openPositionAction(position: Position, action: "adjust" | "close") {
    adjustPosition.reset();
    closePosition.reset();
    setSelectedPositionId(position.borrowProductId);
    setActionPosition(position);
    setSelectedAdjustActions([]);
    setAdjustAmounts({ ...EMPTY_ADJUST_AMOUNTS });
    setAdjustSubmitted(false);
    setAdjustSynced(false);
    setCloseConfirmed(false);
    setCloseSubmitted(false);
    setCloseSynced(false);
    setPositionAction(action);
  }

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPosition) return;
    const hasAmount = selectedAdjustActions.some((action) => adjustAmounts[action].trim());
    if (!hasAmount) return;
    adjustTargetId.current = selectedPosition.borrowProductId;
    adjustBaselineBlock.current = selectedPosition.snapshot.blockNumber;
    setAdjustSynced(false);
    setAdjustSubmitted(true);
    await adjustPosition.adjustBorrowPosition({
      borrowProductId: selectedPosition.borrowProductId,
      useCdpPaymaster: true,
      ...(selectedAdjustActions.includes("addCollateral") && adjustAmounts.addCollateral && { addCollateralAmount: adjustAmounts.addCollateral }),
      ...(selectedAdjustActions.includes("borrowMore") && adjustAmounts.borrowMore && { borrowLoanAmount: adjustAmounts.borrowMore }),
      ...(selectedAdjustActions.includes("removeCollateral") && adjustAmounts.removeCollateral && { removeCollateralAmount: adjustAmounts.removeCollateral }),
      ...(selectedAdjustActions.includes("repayDebt") && adjustAmounts.repayDebt && { repayLoanAmount: adjustAmounts.repayDebt }),
    });
  }

  async function submitClosePosition() {
    if (!selectedPosition || !closeConfirmed) return;
    closeTargetId.current = selectedPosition.borrowProductId;
    setCloseSynced(false);
    setCloseSubmitted(true);
    await closePosition.closeBorrowPosition({
      borrowProductId: selectedPosition.borrowProductId,
      useCdpPaymaster: true,
    });
  }

  function viewPosition(borrowProductId: string) {
    setExpandedPositionId(borrowProductId);
    setActiveTab("positions");
  }

  function toggleAdjustAction(action: AdjustAction) {
    const increaseActions: AdjustAction[] = ["addCollateral", "borrowMore"];
    const actionIsIncrease = increaseActions.includes(action);
    const hasIncreaseAction = selectedAdjustActions.some((currentAction) => increaseActions.includes(currentAction));
    const hasDecreaseAction = selectedAdjustActions.some((currentAction) => !increaseActions.includes(currentAction));
    if ((actionIsIncrease && hasDecreaseAction) || (!actionIsIncrease && hasIncreaseAction)) return;

    if (selectedAdjustActions.includes(action)) {
      setSelectedAdjustActions((currentActions) => currentActions.filter((currentAction) => currentAction !== action));
      setAdjustAmounts((currentAmounts) => ({ ...currentAmounts, [action]: "" }));
      return;
    }
    setSelectedAdjustActions((currentActions) => [...currentActions, action]);
  }

  const visibleBalances = tokenBalances.balances
    .filter((balance) => balance.rawAmount > 0n || /btc|usd/i.test(balance.symbol))
    .sort((a, b) => Number(b.rawAmount > 0n) - Number(a.rawAmount > 0n));
  const borrowCollateralUsd = selectedAssets?.collateral
    ? estimateUsd(collateralAmount, selectedAssets.collateral.token.symbol, usdPrices)
    : undefined;
  const borrowLoanUsd = selectedAssets?.debt
    ? estimateUsd(loanAmount, selectedAssets.debt.token.symbol, usdPrices)
    : undefined;
  const projectedBorrowLtv = borrowCollateralUsd && borrowLoanUsd !== undefined
    ? (borrowLoanUsd / borrowCollateralUsd) * 100
    : undefined;
  const selectedMaxLtv = selectedProduct?.protocolDetails.type === "morpho_blue"
    ? selectedProduct.protocolDetails.marketParams.lltvBps / 100
    : undefined;
  const projectedLtvIsHigh = projectedBorrowLtv !== undefined && selectedMaxLtv !== undefined
    ? projectedBorrowLtv >= selectedMaxLtv
    : false;
  const adjustCollateralSymbol = selectedPosition?.onchainState.collateral[0]?.token.symbol;
  const adjustDebtSymbol = selectedPosition?.onchainState.debt[0]?.token.symbol;
  const hasIncreaseAdjustment = selectedAdjustActions.some((action) => action === "addCollateral" || action === "borrowMore");
  const hasDecreaseAdjustment = selectedAdjustActions.some((action) => action === "removeCollateral" || action === "repayDebt");
  const hasAdjustmentAmount = selectedAdjustActions.some((action) => adjustAmounts[action].trim());

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <nav aria-label="Dashboard views">
          <button className={activeTab === "markets" ? "active" : ""} onClick={() => setActiveTab("markets")}>Markets</button>
          <button className={activeTab === "positions" ? "active" : ""} onClick={() => setActiveTab("positions")}>Positions</button>
        </nav>
        <div className="account-menu">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {smartAccount && (
            <button
              className="address-pill"
              onClick={() => {
                void navigator.clipboard.writeText(smartAccount);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              <span className="status-dot" /> {shortAddress(smartAccount)} {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          <button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={18} /></button>
        </div>
      </header>

      <main className="dashboard">
        <section className="welcome-row">
          <div>
            <h1>Good morning{email ? `, ${email.split("@")[0]}` : ""}.</h1>
            <p>Your smart account is ready. Explore available liquidity below.</p>
          </div>
          <div className="smart-badge"><ShieldCheck size={19} /><div><strong>Smart Account active</strong><span>Gas sponsored by CDP</span></div></div>
        </section>

        <section className="portfolio-grid">
          <article className="balance-card dark-card">
            <div className="card-heading"><span>Available assets</span><WalletCards size={20} /></div>
            <strong className="hero-number">{visibleBalances.length}</strong>
            <p>Tracked tokens in your smart account</p>
            <div className="mini-token-row">
              {visibleBalances.slice(0, 4).map((balance) => <TokenIcon key={balance.address} symbol={balance.symbol} />)}
            </div>
          </article>

          <article className="balance-card">
            <div className="card-heading"><span>Token balances</span><button className="mini-refresh" onClick={() => setBalanceRefreshKey((value) => value + 1)}><RefreshCw className={tokenBalances.isLoading ? "spin" : ""} size={16} /></button></div>
            <div className="asset-list">
              {tokenBalances.isLoading && visibleBalances.length === 0 ? <div className="skeleton-lines"><i /><i /></div> : visibleBalances.slice(0, 3).map((balance) => {
                const usdValue = estimateUsd(balance.amount, balance.symbol, usdPrices);
                return (
                  <div className="asset-row" key={balance.address}>
                    <TokenIcon symbol={balance.symbol} />
                    <div>
                      <strong>{formatAmount(balance.amount, balance.symbol.toLowerCase().includes("btc") ? 8 : 2)} {balance.symbol}</strong>
                      <span>Base</span>
                    </div>
                    <div className="asset-usd">
                      <strong>{usdValue !== undefined ? `≈ ${formatUsd(usdValue)}` : "—"}</strong>
                      <span>estimated</span>
                    </div>
                  </div>
                );
              })}
              {!tokenBalances.isLoading && visibleBalances.length === 0 && <p className="empty-copy">Balances appear once markets load.</p>}
            </div>
          </article>

          <article className="balance-card accent-card">
            <div className="card-heading"><span>Open positions</span><CircleDollarSign size={20} /></div>
            <strong className="hero-number">{positions.length}</strong>
            <p>{positions.length ? "Your borrowing activity is healthy" : "Start with a collateral-backed loan"}</p>
            <button className="card-link" onClick={() => setActiveTab("positions")}>View positions <ArrowRight size={15} /></button>
          </article>
        </section>

        {tokenBalances.error && <div className="inline-warning">Balance RPC unavailable: {tokenBalances.error}</div>}

        {activeTab === "markets" ? <section id="markets" className="section-block">
          <div className="section-title">
            <div><span className="eyebrow muted">BORROW MARKETS</span><h2>Choose your credit line</h2></div>
            <button className="outline-button" onClick={() => void productsQuery.refetch()} disabled={productsQuery.status === "pending"}>
              <RefreshCw className={productsQuery.status === "pending" ? "spin" : ""} size={16} /> Refresh
            </button>
          </div>

          {productsQuery.status === "pending" && !productsQuery.data ? (
            <div className="market-grid"><div className="market-skeleton" /><div className="market-skeleton" /><div className="market-skeleton" /></div>
          ) : productsQuery.error ? (
            <div className="error-panel">{productsQuery.error.message}</div>
          ) : (
            <div className="market-grid">
              {products.map((product) => {
                const { collateral, debt } = getProductAssets(product);
                const lltv = product.protocolDetails.type === "morpho_blue" ? product.protocolDetails.marketParams.lltvBps / 100 : undefined;
                return (
                  <article className="market-card" key={product.borrowProductId}>
                    <div className="market-card-top">
                      <div className="pair-icons">
                        {collateral && <TokenIcon symbol={collateral.token.symbol} />}
                        {debt && <TokenIcon symbol={debt.token.symbol} />}
                      </div>
                      <span className="protocol-pill">{product.venue.name}</span>
                    </div>
                    <h3>{collateral?.token.symbol ?? "Collateral"} / {debt?.token.symbol ?? "Loan"}</h3>
                    <p>{product.name}</p>
                    <div className="market-stats">
                      <div><span>Max LTV</span><strong>{lltv ? `${lltv.toFixed(0)}%` : "Market"}</strong></div>
                      <div><span>Rate</span><strong>Variable</strong></div>
                    </div>
                    <button onClick={() => openBorrow(product)}>Borrow {debt?.token.symbol ?? "assets"}<ChevronRight size={17} /></button>
                  </article>
                );
              })}
            </div>
          )}
        </section> : null}

        {activeTab === "positions" ? <section id="positions" className="section-block positions-section">
          <div className="section-title">
            <div><span className="eyebrow muted">YOUR ACTIVITY</span><h2>Open positions</h2></div>
          </div>
          {positionsQuery.status === "pending" && !positionsQuery.data ? (
            <div className="position-empty"><LoaderCircle className="spin" /> Loading your positions</div>
          ) : positions.length ? (
            <div className="position-grid">
              {positions.map((position) => {
                const product = products.find((item) => item.borrowProductId === position.borrowProductId);
                const collateral = position.onchainState.collateral[0];
                const debt = position.onchainState.debt[0];
                const lltv = product?.protocolDetails.type === "morpho_blue"
                  ? product.protocolDetails.marketParams.lltvBps / 100
                  : undefined;
                const borrowApy = debt?.borrowApyBps !== undefined ? debt.borrowApyBps / 100 : undefined;
                const currentLtv = position.onchainState.currentLtvBps !== undefined
                  ? position.onchainState.currentLtvBps / 100
                  : undefined;
                const liquidationThreshold = position.onchainState.liquidationThresholdBps !== undefined
                  ? position.onchainState.liquidationThresholdBps / 100
                  : undefined;
                const liquidationBuffer = currentLtv !== undefined && liquidationThreshold !== undefined
                  ? liquidationThreshold - currentLtv
                  : undefined;
                const collateralUsd = estimateAssetListUsd(position.onchainState.collateral, usdPrices);
                const debtUsd = estimateAssetListUsd(position.onchainState.debt, usdPrices);
                const isExpanded = expandedPositionId === position.borrowProductId;
                return (
                  <article
                    className={`position-card ${isExpanded ? "expanded" : ""}`}
                    data-position-id={position.borrowProductId}
                    key={position.borrowProductId}
                  >
                    <div className="position-card-head">
                      <div className="position-market">
                        <div className="pair-icons">
                          {collateral && <TokenIcon symbol={collateral.token.symbol} />}
                          {debt && <TokenIcon symbol={debt.token.symbol} />}
                        </div>
                        <div>
                          <strong>{collateral?.token.symbol ?? "Collateral"} / {debt?.token.symbol ?? "Debt"}</strong>
                          <span>{product?.venue.name ?? "Morpho Blue"} on Base</span>
                        </div>
                      </div>
                      <span className={`health-pill health-${position.onchainState.healthStatus}`}>
                        <span className="status-dot" /> {position.onchainState.healthStatus}
                      </span>
                    </div>

                    <div className="position-balance-grid">
                      <div>
                        <span>Collateral supplied</span>
                        <strong>{position.onchainState.collateral.map((asset) => `${formatExactAmount(asset.amount)} ${asset.token.symbol}`).join(", ")}</strong>
                        {collateralUsd !== undefined && <small>≈ {formatUsd(collateralUsd)}</small>}
                      </div>
                      <div>
                        <span>Outstanding debt</span>
                        <strong>{position.onchainState.debt.map((asset) => `${formatExactAmount(asset.amount)} ${asset.token.symbol}`).join(", ")}</strong>
                        {debtUsd !== undefined && <small>≈ {formatUsd(debtUsd)}</small>}
                      </div>
                    </div>

                    <div className="position-metrics">
                      <div><span>Borrow APY</span><strong>{borrowApy !== undefined ? `${borrowApy.toFixed(2)}%` : "Unavailable"}</strong></div>
                      <div><span>Current LTV</span><strong>{currentLtv !== undefined ? `${currentLtv.toFixed(2)}%` : "No debt"}</strong></div>
                      <div><span>Health factor</span><strong>{position.onchainState.healthFactor ?? "N/A"}</strong></div>
                    </div>

                    <button
                      className="position-details-toggle"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedPositionId(isExpanded ? undefined : position.borrowProductId)}
                    >
                      <span>{isExpanded ? "Hide position details" : "View position details"}</span>
                      <ChevronRight size={16} />
                    </button>

                    {isExpanded && (
                      <div className="position-detail-panel">
                        <div className="detail-risk-card">
                          <div className="detail-risk-heading"><ShieldCheck size={18} /><span>Liquidation health</span></div>
                          <div className="ltv-track">
                            <span style={{ width: `${Math.min(currentLtv ?? 0, 100)}%` }} />
                            {liquidationThreshold !== undefined && <i style={{ left: `${Math.min(liquidationThreshold, 100)}%` }} />}
                          </div>
                          <div className="ltv-labels">
                            <span>Current {currentLtv !== undefined ? `${currentLtv.toFixed(2)}%` : "N/A"}</span>
                            <span>Liquidation {liquidationThreshold !== undefined ? `${liquidationThreshold.toFixed(2)}%` : "N/A"}</span>
                          </div>
                          <strong>{liquidationBuffer !== undefined ? `${liquidationBuffer.toFixed(2)} percentage points of buffer` : "Liquidation buffer unavailable"}</strong>
                        </div>

                        <div className="position-detail-grid">
                          <div><span>Borrow APY</span><strong>{borrowApy !== undefined ? `${borrowApy.toFixed(2)}%` : "Unavailable"}</strong></div>
                          <div><span>Health factor</span><strong>{position.onchainState.healthFactor ?? "N/A"}</strong></div>
                          <div><span>Max market LTV</span><strong>{lltv !== undefined ? `${lltv.toFixed(2)}%` : "Unavailable"}</strong></div>
                          <div><span>Snapshot block</span><strong>{position.snapshot.blockNumber.toLocaleString()}</strong></div>
                          <div><span>Last observed</span><strong>{new Date(position.snapshot.observedAt).toLocaleString()}</strong></div>
                          <div><span>Network</span><strong>{position.network}</strong></div>
                        </div>

                        <div className="position-identifiers">
                          <div><span>Smart account</span><code>{position.address}</code></div>
                          <div><span>Borrow product</span><code>{position.borrowProductId}</code></div>
                          {product?.protocolDetails.type === "morpho_blue" && (
                            <div><span>Morpho market</span><code>{product.protocolDetails.marketParams.onchainMarketId}</code></div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="position-actions">
                      <button className="position-action adjust-action" onClick={() => openPositionAction(position, "adjust")}>
                        <span className="action-bullet"><SlidersHorizontal size={15} /></span>
                        <span className="action-label"><strong>Adjust</strong><small>Change position</small></span>
                        <ChevronRight size={15} />
                      </button>
                      <button className="position-action close-action" onClick={() => openPositionAction(position, "close")}>
                        <span className="action-bullet"><X size={15} /></span>
                        <span className="action-label"><strong>Close</strong><small>Repay & withdraw</small></span>
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="position-empty"><Landmark size={28} /><div><strong>No open positions yet</strong><span>Visit the Markets tab to open your first credit line.</span></div></div>
          )}
        </section> : null}
      </main>

      {positionAction === "adjust" && selectedPosition && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPositionAction(null); }}>
          <section className="borrow-modal position-modal" role="dialog" aria-modal="true" aria-labelledby="adjust-title">
            <button className="modal-close" onClick={() => setPositionAction(null)}><X size={20} /></button>
            <span className="eyebrow muted">MANAGE POSITION</span>
            <h2 id="adjust-title">Adjust your position</h2>
            <p>Choose one change to make. You can adjust again after it confirms.</p>

            {adjustPosition.status === "success" && adjustPosition.data?.userOpHash && adjustSynced ? (
              <div className="success-state">
                <span className="success-icon"><Check size={26} /></span>
                <h3>Position updated</h3>
                <p>Your balances and position details are refreshing now.</p>
                <button className="primary-button" onClick={() => setPositionAction(null)}>Back to positions</button>
              </div>
            ) : adjustSubmitted ? (
              adjustPosition.status === "error" ? (
                <OperationFailure
                  message={adjustPosition.error?.message ?? "The position could not be adjusted."}
                  onRetry={() => { adjustPosition.reset(); setAdjustSubmitted(false); setAdjustSynced(false); }}
                />
              ) : (
                <OperationProgress
                  title={adjustPosition.data?.userOpHash ? "Refreshing your position" : "Updating your position"}
                  detail={adjustPosition.data?.userOpHash
                    ? "The transaction is confirmed. We are waiting for the latest indexed position snapshot."
                    : "Your adjustment is being processed onchain. This screen will update automatically after confirmation."}
                  isConfirmed={Boolean(adjustPosition.data?.userOpHash)}
                />
              )
            ) : (
              <form className="borrow-form" onSubmit={submitAdjustment}>
                <div className="adjust-options" role="group" aria-label="Adjustment type">
                  <button type="button" className={selectedAdjustActions.includes("addCollateral") ? "active" : ""} disabled={hasDecreaseAdjustment} onClick={() => toggleAdjustAction("addCollateral")}>
                    <Plus size={17} /><span><strong>Add collateral</strong><small>Improve position health</small></span>
                  </button>
                  <button type="button" className={selectedAdjustActions.includes("borrowMore") ? "active" : ""} disabled={hasDecreaseAdjustment} onClick={() => toggleAdjustAction("borrowMore")}>
                    <TrendingUp size={17} /><span><strong>Borrow more</strong><small>Increase outstanding debt</small></span>
                  </button>
                  <button type="button" className={selectedAdjustActions.includes("removeCollateral") ? "active" : ""} disabled={hasIncreaseAdjustment} onClick={() => toggleAdjustAction("removeCollateral")}>
                    <Minus size={17} /><span><strong>Withdraw collateral</strong><small>Returns assets to wallet</small></span>
                  </button>
                  <button type="button" className={selectedAdjustActions.includes("repayDebt") ? "active" : ""} disabled={hasIncreaseAdjustment} onClick={() => toggleAdjustAction("repayDebt")}>
                    <CircleDollarSign size={17} /><span><strong>Repay debt</strong><small>Reduce outstanding debt</small></span>
                  </button>
                </div>

                <div className="adjust-input-grid">
                  {selectedAdjustActions.includes("addCollateral") && (
                    <label>
                      <span>Collateral to add</span>
                      <div className="amount-field">
                        <input inputMode="decimal" placeholder="0.00" value={adjustAmounts.addCollateral} onChange={(event) => setAdjustAmounts((amounts) => ({ ...amounts, addCollateral: event.target.value }))} autoFocus />
                        <b>{adjustCollateralSymbol}</b>
                      </div>
                      {adjustCollateralSymbol && adjustAmounts.addCollateral && estimateUsd(adjustAmounts.addCollateral, adjustCollateralSymbol, usdPrices) !== undefined && (
                        <small className="input-estimate">Approximately {formatUsd(estimateUsd(adjustAmounts.addCollateral, adjustCollateralSymbol, usdPrices) ?? 0)}</small>
                      )}
                    </label>
                  )}
                  {selectedAdjustActions.includes("borrowMore") && (
                    <label>
                      <span>Additional amount to borrow</span>
                      <div className="amount-field">
                        <input inputMode="decimal" placeholder="0.00" value={adjustAmounts.borrowMore} onChange={(event) => setAdjustAmounts((amounts) => ({ ...amounts, borrowMore: event.target.value }))} autoFocus={!selectedAdjustActions.includes("addCollateral")} />
                        <b>{adjustDebtSymbol}</b>
                      </div>
                      {adjustDebtSymbol && adjustAmounts.borrowMore && estimateUsd(adjustAmounts.borrowMore, adjustDebtSymbol, usdPrices) !== undefined && (
                        <small className="input-estimate">Approximately {formatUsd(estimateUsd(adjustAmounts.borrowMore, adjustDebtSymbol, usdPrices) ?? 0)}</small>
                      )}
                    </label>
                  )}
                  {selectedAdjustActions.includes("removeCollateral") && (
                    <label>
                      <span>Collateral to withdraw</span>
                      <div className="amount-field">
                        <input inputMode="decimal" placeholder="0.00" value={adjustAmounts.removeCollateral} onChange={(event) => setAdjustAmounts((amounts) => ({ ...amounts, removeCollateral: event.target.value }))} autoFocus />
                        <b>{adjustCollateralSymbol}</b>
                      </div>
                      {adjustCollateralSymbol && adjustAmounts.removeCollateral && estimateUsd(adjustAmounts.removeCollateral, adjustCollateralSymbol, usdPrices) !== undefined && (
                        <small className="input-estimate">Approximately {formatUsd(estimateUsd(adjustAmounts.removeCollateral, adjustCollateralSymbol, usdPrices) ?? 0)}</small>
                      )}
                    </label>
                  )}
                  {selectedAdjustActions.includes("repayDebt") && (
                    <label>
                      <span>Debt to repay</span>
                      <div className="amount-field">
                        <input inputMode="decimal" placeholder="0.00" value={adjustAmounts.repayDebt} onChange={(event) => setAdjustAmounts((amounts) => ({ ...amounts, repayDebt: event.target.value }))} autoFocus={!selectedAdjustActions.includes("removeCollateral")} />
                        <b>{adjustDebtSymbol}</b>
                      </div>
                      {adjustDebtSymbol && adjustAmounts.repayDebt && estimateUsd(adjustAmounts.repayDebt, adjustDebtSymbol, usdPrices) !== undefined && (
                        <small className="input-estimate">Approximately {formatUsd(estimateUsd(adjustAmounts.repayDebt, adjustDebtSymbol, usdPrices) ?? 0)}</small>
                      )}
                    </label>
                  )}
                </div>

                {selectedAdjustActions.length === 0 && (
                  <div className="action-note">Choose an action above. You can select both actions in the same row.</div>
                )}
                {hasIncreaseAdjustment && (
                  <div className="action-caution"><AlertTriangle size={17} /> Borrowing more can reduce position health; adding collateral can offset that change.</div>
                )}
                {hasDecreaseAdjustment && (
                  <div className="action-caution"><AlertTriangle size={17} /> Withdrawing collateral can reduce position health; repaying debt can offset that change.</div>
                )}
                <button className="primary-button" disabled={!hasAdjustmentAmount || adjustPosition.status === "pending"}>
                  {adjustPosition.status === "pending" ? <><LoaderCircle className="spin" size={18} /> Confirming adjustment</> : <>Review and confirm <ArrowRight size={18} /></>}
                </button>
              </form>
            )}
          </section>
        </div>
      )}

      {positionAction === "close" && selectedPosition && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPositionAction(null); }}>
          <section className="borrow-modal close-modal" role="dialog" aria-modal="true" aria-labelledby="close-title">
            <button className="modal-close" onClick={() => setPositionAction(null)}><X size={20} /></button>
            <span className="eyebrow danger-eyebrow">CLOSE POSITION</span>
            <h2 id="close-title">Repay and withdraw</h2>
            <p>Closing settles the full loan and returns all remaining collateral to your smart account.</p>

            {closePosition.status === "success" && closePosition.data?.userOpHash && closeSynced ? (
              <div className="success-state">
                <span className="success-icon"><Check size={26} /></span>
                <h3>Position closed</h3>
                <p>Your collateral has been returned and your portfolio is refreshing.</p>
                <button className="primary-button" onClick={() => setPositionAction(null)}>Back to positions</button>
              </div>
            ) : closeSubmitted ? (
              closePosition.status === "error" ? (
                <OperationFailure
                  message={closePosition.error?.message ?? "The position could not be closed."}
                  onRetry={() => { closePosition.reset(); setCloseSubmitted(false); setCloseSynced(false); }}
                />
              ) : (
                <OperationProgress
                  title={closePosition.data?.userOpHash ? "Refreshing your positions" : "Closing your position"}
                  detail={closePosition.data?.userOpHash
                    ? "The transaction is confirmed. We are waiting for the closed position to clear from your portfolio."
                    : "The debt is being repaid and your collateral will be returned after the transaction confirms."}
                  isConfirmed={Boolean(closePosition.data?.userOpHash)}
                />
              )
            ) : (
              <div className="close-content">
                <div className="close-summary">
                  <div>
                    <span>Debt to repay</span>
                    <strong>{selectedPosition.onchainState.debt.map((asset) => `${formatExactAmount(asset.amount)} ${asset.token.symbol}`).join(", ")}</strong>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span>Collateral returned</span>
                    <strong>{selectedPosition.onchainState.collateral.map((asset) => `${formatExactAmount(asset.amount)} ${asset.token.symbol}`).join(", ")}</strong>
                  </div>
                </div>
                <div className="action-caution"><AlertTriangle size={17} /> Your smart account needs enough loan tokens to repay the full outstanding debt.</div>
                <label className="confirm-check">
                  <input type="checkbox" checked={closeConfirmed} onChange={(event) => setCloseConfirmed(event.target.checked)} />
                  <span>I understand this will fully repay and close the position.</span>
                </label>
                <button className="danger-button" disabled={!closeConfirmed || closePosition.status === "pending"} onClick={() => void submitClosePosition()}>
                  {closePosition.status === "pending" ? <><LoaderCircle className="spin" size={18} /> Closing position</> : "Repay debt and close"}
                </button>
                <button className="text-button" onClick={() => setPositionAction(null)}>Keep position open</button>
              </div>
            )}
          </section>
        </div>
      )}

      {isBorrowOpen && selectedProduct && selectedAssets && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsBorrowOpen(false); }}>
          <section className="borrow-modal" role="dialog" aria-modal="true" aria-labelledby="borrow-title">
            <button className="modal-close" onClick={() => setIsBorrowOpen(false)}><X size={20} /></button>
            <span className="eyebrow muted">OPEN A POSITION</span>
            <h2 id="borrow-title">Borrow {selectedAssets.debt?.token.symbol}</h2>
            <p>Deposit collateral and receive funds directly in your smart account.</p>

            <div className="borrow-pair">
              <div><span>Collateral</span><strong><TokenIcon symbol={selectedAssets.collateral?.token.symbol ?? "?"} /> {selectedAssets.collateral?.token.symbol}</strong></div>
              <ArrowRight size={18} />
              <div><span>You receive</span><strong><TokenIcon symbol={selectedAssets.debt?.token.symbol ?? "?"} /> {selectedAssets.debt?.token.symbol}</strong></div>
            </div>

            {createPosition.status === "success" && createPosition.data?.userOpHash && createSynced ? (
              <div className="success-state">
                <span className="success-icon"><Check size={26} /></span>
                <h3>Borrow confirmed</h3>
                <p>Your {selectedAssets.debt?.token.symbol} balance and position are refreshing now.</p>
                <button className="primary-button" onClick={() => { setIsBorrowOpen(false); viewPosition(selectedProduct.borrowProductId); }}>View position</button>
              </div>
            ) : borrowSubmitted ? (
              createPosition.status === "error" ? (
                <OperationFailure
                  message={createPosition.error?.message ?? "The borrow transaction could not be completed."}
                  onRetry={() => { createPosition.reset(); setBorrowSubmitted(false); setCreateSynced(false); }}
                />
              ) : (
                <OperationProgress
                  title={createPosition.data?.userOpHash ? "Refreshing your positions" : "Opening your position"}
                  detail={createPosition.data?.userOpHash
                    ? "The transaction is confirmed. We are waiting for your new position to appear in the latest indexed snapshot."
                    : `Your ${selectedAssets.debt?.token.symbol ?? "loan"} will appear in your smart account after confirmation.`}
                  isConfirmed={Boolean(createPosition.data?.userOpHash)}
                />
              )
            ) : (
              <form onSubmit={submitBorrow} className="borrow-form">
                <label>
                  <span>Collateral amount</span>
                  <div className="amount-field"><input inputMode="decimal" placeholder="0.00" value={collateralAmount} onChange={(event) => setCollateralAmount(event.target.value)} required /><b>{selectedAssets.collateral?.token.symbol}</b></div>
                  {selectedAssets.collateral && collateralAmount && estimateUsd(collateralAmount, selectedAssets.collateral.token.symbol, usdPrices) !== undefined && (
                    <small className="input-estimate">Approximately {formatUsd(estimateUsd(collateralAmount, selectedAssets.collateral.token.symbol, usdPrices) ?? 0)}</small>
                  )}
                </label>
                <label>
                  <span>Amount to borrow</span>
                  <div className="amount-field"><input inputMode="decimal" placeholder="0.00" value={loanAmount} onChange={(event) => setLoanAmount(event.target.value)} required /><b>{selectedAssets.debt?.token.symbol}</b></div>
                  {selectedAssets.debt && loanAmount && estimateUsd(loanAmount, selectedAssets.debt.token.symbol, usdPrices) !== undefined && (
                    <small className="input-estimate">Approximately {formatUsd(estimateUsd(loanAmount, selectedAssets.debt.token.symbol, usdPrices) ?? 0)}</small>
                  )}
                </label>
                <div className={`projected-ltv ${projectedLtvIsHigh ? "over-limit" : ""}`}>
                  <div className="projected-ltv-values">
                    <div><span>Projected LTV</span><strong>{projectedBorrowLtv !== undefined ? `${projectedBorrowLtv.toFixed(2)}%` : "—"}</strong></div>
                    <div><span>Max LTV</span><strong>{selectedMaxLtv !== undefined ? `${selectedMaxLtv.toFixed(2)}%` : "—"}</strong></div>
                  </div>
                  <div className="projected-ltv-track">
                    <span style={{ width: `${Math.min(projectedBorrowLtv ?? 0, 100)}%` }} />
                    {selectedMaxLtv !== undefined && <i style={{ left: `${Math.min(selectedMaxLtv, 100)}%` }} />}
                  </div>
                  <div className="projected-ltv-caption">
                    <span>Lower risk</span>
                    <span>{projectedLtvIsHigh ? "Above market limit" : "Liquidation threshold"}</span>
                  </div>
                </div>
                <div className="borrow-summary">
                  <div><span>Protocol</span><strong>Morpho Blue</strong></div>
                  <div><span>Network fee</span><strong className="free-label">Sponsored</strong></div>
                </div>
                <button className="primary-button" disabled={createPosition.status === "pending" || !collateralAmount || !loanAmount}>
                  {createPosition.status === "pending" ? <><LoaderCircle className="spin" size={18} /> Confirming on Base</> : <>Confirm borrow <ArrowRight size={18} /></>}
                </button>
                <p className="risk-copy">Borrowing involves liquidation risk. Review the market parameters before confirming.</p>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { isInitialized } = useIsInitialized();
  const { currentUser } = useCurrentUser();
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("harbor-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("harbor-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((currentTheme) => currentTheme === "light" ? "dark" : "light");

  if (!isInitialized) {
    return <div className="loading-screen"><Brand /><LoaderCircle className="spin" size={24} /></div>;
  }

  return currentUser
    ? <Dashboard theme={theme} onToggleTheme={toggleTheme} />
    : <SignIn theme={theme} onToggleTheme={toggleTheme} />;
}
