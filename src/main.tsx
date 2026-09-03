import { CDPHooksProvider } from "@coinbase/cdp-hooks";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const projectId = import.meta.env.VITE_CDP_PROJECT_ID;
const basePath = import.meta.env.VITE_CDP_BASE_PATH;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CDPHooksProvider
      config={{
        projectId: projectId || "YOUR_PROJECT_ID",
        ...(basePath && { basePath }),
        ethereum: { createOnLogin: "smart" },
      }}
    >
      <App />
    </CDPHooksProvider>
  </StrictMode>,
);
