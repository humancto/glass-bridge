import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = new URL("../", import.meta.url);
const outputUrl = new URL(
  "../research/GlassBridge_AGX_PRD.html",
  import.meta.url,
);

const server = await createServer({
  root: projectRoot.pathname,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

let body;
try {
  const { default: ProductResearchDefinition } = await server.ssrLoadModule(
    "/app/page.tsx",
  );
  body = renderToStaticMarkup(createElement(ProductResearchDefinition, {
    receiverHref: "../receive.html",
    senderHref: "../send.html",
  }));
} finally {
  await server.close();
}

const sourceCss = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const safeCss = sourceCss.replaceAll("</style", "<\\/style");

const document = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="GlassBridge / AGX runnable pre-alpha and research definition for signed, policy-gated optical exchange across disconnected security boundaries.">
    <meta name="generator" content="GlassBridge research document exporter">
    <meta name="theme-color" content="#101914">
    <title>GlassBridge / AGX — Signed Optical Boundary Research</title>
    <style>${safeCss}</style>
  </head>
  <body>${body}</body>
</html>
`;

await mkdir(new URL("../research/", import.meta.url), { recursive: true });
await writeFile(outputUrl, document, "utf8");
