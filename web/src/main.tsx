import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global styles first so feature CSS (imported by App's routes) can override them.
import "./shared/styles/tokens.css";
import "./shared/styles/arc-bridge.css";
import "./shared/styles/global.css";
import { App } from "./app/App";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
