import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const indexUrl = new URL("../index.html", import.meta.url);
const researchDocumentUrl = new URL(
  "../research/GlassBridge_AGX_PRD.html",
  import.meta.url,
);
const serviceWorkerUrl = new URL("../dist/receiver-sw.js", import.meta.url);
const senderAppUrl = new URL("../src/sender/SenderApp.tsx", import.meta.url);
const senderCssUrl = new URL("../src/sender/sender.css", import.meta.url);
const receiverAppUrl = new URL("../src/receiver/ReceiverApp.tsx", import.meta.url);
const cameraCaptureUrl = new URL("../src/receiver/camera-capture.ts", import.meta.url);

test("contains the complete public design baseline", async () => {
  const page = await readFile(pageUrl, "utf8");
  const requiredSections = [
    "decision",
    "problem",
    "prior-art",
    "threat-model",
    "architecture",
    "agx",
    "workflow",
    "transport",
    "implementation",
    "api",
    "benchmarks",
    "research",
    "roadmap",
    "backlog",
    "sources",
  ];

  for (const id of requiredSections) {
    assert.match(page, new RegExp(`id=[\\\"']${id}[\\\"']`));
  }

  assert.match(page, /not a certified data diode/i);
  assert.match(page, /novelty remains a hypothesis/i);
  assert.match(page, /QRFerry/);
  assert.match(page, /Decimen Optical Transfer/);
  assert.match(page, /GB-052/);
});

test("uses product-specific metadata and no starter copy", async () => {
  const [page, index] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(indexUrl, "utf8"),
  ]);

  assert.match(index, /GlassBridge \/ AGX/);
  assert.match(index, /air-gapped boundaries/i);
  assert.doesNotMatch(`${page}\n${index}`, /Your site is taking shape|Starter Project/);
});

test("exports a self-contained, sanitized research document", async () => {
  const html = await readFile(researchDocumentUrl, "utf8");

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<style>[\s\S]+<\/style>/i);
  assert.match(html, /id="threat-model"/);
  assert.match(html, /id="backlog"/);
  assert.match(html, /id="sources"/);
  assert.doesNotMatch(html, /<script|\/@vite\/client|\/Users\//i);
});

test("uses network-first navigations to avoid mixed service-worker releases", async () => {
  const serviceWorker = await readFile(serviceWorkerUrl, "utf8");

  assert.match(serviceWorker, /event\.request\.mode === "navigate"/);
  assert.match(serviceWorker, /fetchAndCache\(event\.request\)\.catch/);
  assert.match(
    serviceWorker,
    /caches\.match\(event\.request\)\.then\(\(cached\) => cached \|\| fetchAndCache\(event\.request\)\)/,
  );

  const network = serviceWorkerHarness(serviceWorker, {
    networkResponse: new Response("network", { status: 200 }),
  });
  assert.equal(await (await network.dispatchNavigation()).text(), "network");
  assert.deepEqual(network.events, ["fetch", "open", "put"]);

  const fallback = serviceWorkerHarness(serviceWorker, {
    networkError: new Error("offline"),
    cachedResponse: new Response("cached", { status: 200 }),
  });
  assert.equal(await (await fallback.dispatchNavigation()).text(), "cached");
  assert.deepEqual(fallback.events, ["fetch", "match"]);

  const missing = serviceWorkerHarness(serviceWorker, {
    networkError: new Error("offline"),
  });
  const missingResponse = await missing.dispatchNavigation();
  assert.equal(missingResponse.type, "error");
  assert.equal(missingResponse.status, 0);

  const cacheFailure = serviceWorkerHarness(serviceWorker, {
    networkResponse: new Response("still-valid", { status: 200 }),
    cachePutError: new Error("quota exceeded"),
  });
  assert.equal(await (await cacheFailure.dispatchNavigation()).text(), "still-valid");

  const partial = serviceWorkerHarness(serviceWorker, {
    networkResponse: new Response("partial", { status: 206 }),
  });
  assert.equal(await (await partial.dispatchNavigation()).text(), "partial");
  assert.deepEqual(partial.events, ["fetch"]);
});

test("keeps status labels outside QR quiet zones", async () => {
  const [sender, css] = await Promise.all([
    readFile(senderAppUrl, "utf8"),
    readFile(senderCssUrl, "utf8"),
  ]);

  assert.match(sender, /className="sender-code-stage"/);
  assert.match(sender, /<\/div>\s*\{phase === "pair" && <div className="pair-label"/);
  assert.match(css, /\.sender-code-stage \{[^}]*display: grid/);
  assert.doesNotMatch(css, /\.pair-label \{[^}]*position: absolute/);
  assert.doesNotMatch(css, /\.burst-label \{[^}]*position: absolute/);
});

test("keeps transfer controls hidden when no payload is queued", async () => {
  const [sender, css] = await Promise.all([
    readFile(senderAppUrl, "utf8"),
    readFile(senderCssUrl, "utf8"),
  ]);

  assert.match(sender, /senderStatus = !file && !prepared && phase === "choose" \? "empty"/);
  assert.match(sender, /!file && phase === "choose" \? \(/);
  assert.match(sender, /className="empty-send-state"/);
  assert.match(sender, /There is nothing to send\./);
  assert.match(sender, /Transfer settings, pairing, and optical codes stay hidden/);
  assert.match(css, /\.phase-empty \{/);
  assert.match(css, /\.empty-send-state \{/);
});

test("never blocks camera startup using unreliable phone orientation metadata", async () => {
  const receiver = await readFile(receiverAppUrl, "utf8");
  const capture = await readFile(cameraCaptureUrl, "utf8");
  assert.doesNotMatch(receiver, /dualLaneNeedsLandscape|dualLaneViewportNeedsLandscape/);
  assert.match(receiver, /Landscape is recommended[^<]+never a blocker/);
  assert.match(capture, /Math\.sqrt\(maxPixels \/ \(sourceWidth \* sourceHeight\)\)/);
});

function serviceWorkerHarness(
  source,
  { networkResponse, networkError, cachedResponse, cachePutError } = {},
) {
  const events = [];
  let fetchHandler;
  const context = {
    URL,
    Response,
    fetch: async () => {
      events.push("fetch");
      if (networkError) throw networkError;
      return networkResponse;
    },
    caches: {
      open: async () => {
        events.push("open");
        return {
          put: async () => {
            events.push("put");
            if (cachePutError) throw cachePutError;
          },
        };
      },
      match: async () => {
        events.push("match");
        return cachedResponse;
      },
      keys: async () => [],
      delete: async () => true,
    },
    self: {
      location: { origin: "https://glassbridge.test" },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener: (type, handler) => {
        if (type === "fetch") fetchHandler = handler;
      },
    },
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof fetchHandler, "function");

  return {
    events,
    dispatchNavigation: async () => {
      let responsePromise;
      fetchHandler({
        request: {
          method: "GET",
          mode: "navigate",
          url: "https://glassbridge.test/send.html",
        },
        respondWith: (value) => { responsePromise = value; },
      });
      assert.ok(responsePromise);
      return responsePromise;
    },
  };
}
