import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ProductResearchDefinition from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("GlassBridge root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <ProductResearchDefinition />
  </StrictMode>,
);
