import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.DEPLOY_BASE ?? "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        receive: resolve(import.meta.dirname, "receive.html"),
      },
    },
  },
});
