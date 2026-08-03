import { createRoot } from "react-dom/client";
import ReceiverApp from "./receiver/ReceiverApp";
import "./receiver/receiver.css";

const root = document.getElementById("receiver-root");

if (!root) {
  throw new Error("GlassBridge receiver root element was not found");
}

createRoot(root).render(<ReceiverApp />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}receiver-sw.js`);
  });
}
