# Harbor Demo

A standalone demo for borrowing USDC against supported collateral using CDP Smart Accounts and Morpho Blue on Base.

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- A CDP project with email authentication enabled
- `http://localhost:5173` added to the CDP project's allowed origins
- Base assets for any borrow transactions you want to demonstrate

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

Set your CDP project ID in `.env`:

```bash
VITE_CDP_PROJECT_ID=your-project-id
```

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
