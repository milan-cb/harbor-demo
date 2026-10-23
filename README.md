# Harbor Demo

A standalone demo for borrowing USDC against supported collateral, and lending USDC into fee-earning vaults, using CDP Smart Accounts and Morpho on Base.

- **Borrow** — Markets and Positions on Morpho Blue.
- **Lend** — Vaults: deposit USDC into your project's fee-earning vaults, one per Morpho catalog vault (Steakhouse USDC, Gauntlet USDC Prime, Clearstar cbAssets, Bitwise Liquid Prime USDC), and withdraw part or all of it. Each user's position comes from `useListLendPositions`; deposits and withdrawals use `useDepositToVaultFromEvmSmartAccount` and `useWithdrawFromVaultWithEvmSmartAccount` as sponsored user operations. Live APY, fee and TVL come from Morpho's public API and the vault contract; no developer credentials are needed in the browser.

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- A CDP project with email authentication enabled
- `http://localhost:5173` added to the CDP project's allowed origins
- Base assets for any borrow transactions you want to demonstrate
- A fee-earning vault created from the CDP Portal on the Steakhouse USDC catalog vault (for Lend)

The app uses Base mainnet. Borrowing uses real collateral, and closing a position requires enough USDC in the Smart Account to repay its outstanding debt.

## Running the App

Clone the repository and install dependencies with pnpm:

```bash
git clone https://github.com/milan-cb/harbor-demo.git
cd harbor-demo
pnpm install
```

npm also works if you do not have pnpm installed:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set your CDP project ID and vaults in `.env`:

```bash
VITE_CDP_PROJECT_ID=your-project-id
# catalog:vaultId:vaultAddress, comma-separated. catalog is steakhouse, gauntlet, clearstar or bitwise.
VITE_CDP_VAULTS=steakhouse:your-vault-id:0x...,gauntlet:your-vault-id:0x...
```

Each entry becomes a card on the Lend tab. Without `VITE_CDP_VAULTS`, the Lend tab shows setup instructions (a single `VITE_CDP_VAULT_ID` / `VITE_CDP_VAULT_ADDRESS` pair is still read as a Steakhouse USDC vault). The vault address is optional: deposits, withdrawals and the user's position work with just the ID, but the browser cannot resolve an ID to an address (that endpoint requires developer authentication), so the address is what enables each vault's fee, its TVL and the wallet balance. Portal shows the address next to each vault ID.

Start the development server:

```bash
pnpm dev
```

Or, with npm:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

Restart the development server after changing `.env`.
