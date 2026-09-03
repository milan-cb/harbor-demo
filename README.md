# Harbor Borrow Demo

Harbor is a standalone React demo for collateral-backed borrowing through CDP Embedded Wallets and Morpho Blue on Base.

Users sign in with an email OTP, receive a CDP Smart Account automatically, browse curated USDC borrow markets, open a position, and manage or close it from a portfolio dashboard.

## Demo Features

- Email OTP authentication
- Automatic EVM Smart Account creation on first login
- Curated cbBTC, cbETH, cbXRP, and SOL/cbSOL markets borrowing USDC
- Smart Account token balances with estimated USD values
- Live collateral and loan USD estimates while entering amounts
- Projected LTV and maximum market LTV before borrowing
- Sponsored transactions through the CDP Paymaster
- Position cards with exact token balances
- Borrow APY, current LTV, health factor, and liquidation threshold details
- Add or withdraw collateral
- Borrow more or repay debt
- Fully repay and close a position
- Automatic position polling after create, adjust, and close operations
- Responsive light and dark themes

## Demo Walkthrough

1. Sign in with an email address and enter the OTP.
2. CDP creates or restores the user's Smart Account.
3. Review token balances at the top of the dashboard.
4. Choose one of the supported USDC borrow markets.
5. Enter collateral and loan amounts.
6. Review the estimated USD values, projected LTV, and maximum LTV.
7. Confirm the borrow transaction.
8. Wait for the transaction and indexed position to confirm.
9. Select **View position** to open the new position's details.
10. Use **Adjust** to add collateral, withdraw collateral, borrow more, or repay debt.
11. Use **Close** to repay the complete debt and return all collateral.

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- A CDP project configured for Embedded Wallets
- Email authentication enabled for the CDP project
- `http://localhost:5173` added to the project's allowed origins
- Access to the Base borrow-product APIs used by this demo

The application uses Base mainnet. Borrowing requires real collateral, and repaying or closing requires enough of the debt token in the user's Smart Account.

## Clone And Run

```bash
git clone <repository-url>
cd cdp-borrow-demo
corepack enable
pnpm install
cp .env.example .env
```

Edit `.env` and provide your CDP project ID:

```bash
VITE_CDP_PROJECT_ID=your-project-id
```

Start the application:

```bash
pnpm dev
```

Open `http://localhost:5173`.

Environment changes require restarting the Vite development server.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_CDP_PROJECT_ID` | Yes | Public CDP project identifier used by the browser SDK. |
| `VITE_CDP_BASE_PATH` | No | Overrides the CDP API base URL. Leave unset for the standard production API. |

Do not add server API secrets or private keys to Vite environment variables. Variables prefixed with `VITE_` are included in the browser bundle.

## Vendored CDP Packages

This repository uses unpublished CDP Web packages stored as tarballs under `vendor/`. They are intentionally committed so a fresh clone can install and run without requiring a local `cdp-web` checkout.

The `pnpm.overrides` entries in `package.json` ensure transitive dependencies also resolve to these tarballs instead of an npm release with the same version number.

To replace them with a newer local CDP Web build:

```bash
cd ~/cdp-web
pnpm build
pnpm --dir packages/api-client pack --pack-destination ~/cdp-borrow-demo/vendor
pnpm --dir packages/core pack --pack-destination ~/cdp-borrow-demo/vendor
pnpm --dir packages/hooks pack --pack-destination ~/cdp-borrow-demo/vendor

cd ~/cdp-borrow-demo
pnpm install --force
pnpm build
```

If the package version changes, update the tarball paths in both `dependencies` and `pnpm.overrides`.

## Available Commands

```bash
pnpm dev      # Start the Vite development server
pnpm build    # Type-check and create a production build
pnpm lint     # Run Oxlint
pnpm preview  # Preview the production build locally
```

## Supported Markets

The app requests up to 100 Morpho Blue borrow products and displays the first available match for each supported pair:

- cbBTC / USDC
- cbETH / USDC
- cbXRP / USDC
- SOL or cbSOL / USDC

If CDP does not return one of these products for the configured project, that market is omitted from the UI.

## Position Synchronization

Onchain confirmation can complete before the borrow-position index reflects the transaction. After create, adjust, or close operations, Harbor polls the positions endpoint for the updated snapshot before showing the final success state.

## Troubleshooting

### The application cannot authenticate

- Confirm `VITE_CDP_PROJECT_ID` is correct.
- Confirm `http://localhost:5173` is an allowed origin.
- Restart Vite after changing `.env`.
- Sign out and sign in again if the session belongs to a different project.

### A transaction reports an end-user key error

Sign out and authenticate again. The user session and temporary wallet credential must belong to the currently configured CDP project.

### Closing a position fails

The Smart Account must contain enough of the borrowed token to repay the complete outstanding debt, including accrued interest.

### A balance request is rate limited

Token balances are batched through Multicall and duplicate requests are cached. If the public Base RPC still rate limits the request, wait briefly and use the balance refresh control.

### A market is missing

The UI only shows the curated market pairs listed above. It also depends on those products being returned for the configured CDP project.

## Deployment

Vercel is the simplest deployment target for this Vite application:

1. Push this directory to a GitHub repository.
2. Import the repository into Vercel.
3. Add `VITE_CDP_PROJECT_ID` to the Vercel environment variables.
4. Add the deployed domain to the CDP project's allowed origins.
5. Deploy using the default Vite build settings.

GitHub Pages also works, but repositories deployed under a path such as `/cdp-borrow-demo/` need the matching Vite `base` setting. A custom domain served from `/` does not need that adjustment.

## Project Structure

```text
src/App.tsx       Authentication, markets, balances, and position flows
src/App.css       Responsive light and dark UI styles
src/main.tsx      CDP provider configuration
public/           Static icons and favicon
vendor/           Locally packed unpublished CDP modules
```

## Important Disclaimer

This repository is a product demonstration, not production lending advice. Borrowing involves interest, smart-contract risk, and liquidation risk. Review all market parameters and use appropriate test amounts.
