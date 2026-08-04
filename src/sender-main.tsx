import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SenderApp from "./sender/SenderApp";

const root = document.getElementById("root");

if (!root) {
  throw new Error("GlassBridge sender root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <SenderApp />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}receiver-sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
