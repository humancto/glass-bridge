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
const capacityReportUrl = new URL("../src/receiver/capacity-report.ts", import.meta.url);
const readinessUrl = new URL("../docs/open-source-readiness.md", import.meta.url);
const securityAuditUrl = new URL("../docs/open-source-security-audit.md", import.meta.url);
const launchArticleUrl = new URL("../docs/launch-article.md", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);
const conductUrl = new URL("../CODE_OF_CONDUCT.md", import.meta.url);
const governanceUrl = new URL("../GOVERNANCE.md", import.meta.url);
const supportUrl = new URL("../SUPPORT.md", import.meta.url);
const citationUrl = new URL("../CITATION.cff", import.meta.url);
const issueConfigUrl = new URL("../.github/ISSUE_TEMPLATE/config.yml", import.meta.url);
const deviceResultUrl = new URL("../.github/ISSUE_TEMPLATE/device-result.yml", import.meta.url);
const licenseUrl = new URL("../LICENSE", import.meta.url);
const packageJsonUrl = new URL("../package.json", import.meta.url);
const cargoManifestUrl = new URL("../Cargo.toml", import.meta.url);
const crateManifestUrls = [
  new URL("../crates/agx-core/Cargo.toml", import.meta.url),
  new URL("../crates/agx-visual/Cargo.toml", import.meta.url),
  new URL("../crates/glassbridge-cli/Cargo.toml", import.meta.url),
];
const contributingUrl = new URL("../CONTRIBUTING.md", import.meta.url);
const thirdPartyNoticesUrl = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);
const thirdPartyLicensesUrl = new URL("../THIRD_PARTY_LICENSES.md", import.meta.url);
const capacitySchemaUrl = new URL("../spec/glassbridge-capacity-5.schema.json", import.meta.url);
const deviceRunSchemaUrl = new URL("../spec/glassbridge-device-run-1.schema.json", import.meta.url);
const publishedCapacitySchemaUrl = new URL("../dist/spec/glassbridge-capacity-5.schema.json", import.meta.url);
const publishedDeviceRunSchemaUrl = new URL("../dist/spec/glassbridge-device-run-1.schema.json", import.meta.url);

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
  assert.match(page, /Runnable milestone 16/);
  assert.match(page, /Open-source status/);
  assert.match(page, /three undiscarded Grid 30 smoke attempts on one named device pair/i);
  assert.doesNotMatch(page, /Runnable milestone 9/);
  assert.doesNotMatch(page, /Runnable milestone 13/);
  assert.doesNotMatch(page, /Write AGX-0001 before optimizing/);
  assert.match(page, /GB-052/);
});

test("publishes an honest open-source and launch package", async () => {
  const [readiness, securityAudit, launchArticle] = await Promise.all([
    readFile(readinessUrl, "utf8"),
    readFile(securityAuditUrl, "utf8"),
    readFile(launchArticleUrl, "utf8"),
  ]);

  assert.match(readiness, /canonical Apache License 2\.0/i);
  assert.match(readiness, /session TOFU/i);
  assert.match(readiness, /five sender\/receiver pairs/i);
  assert.match(securityAudit, /No confirmed critical or high-severity frontend vulnerability/i);
  assert.match(securityAudit, /GB-WEB-001/);
  assert.match(securityAudit, /GB-TRUST-001/);
  assert.match(launchArticle, /We did not invent animated QR transfer/i);
  assert.match(launchArticle, /What If a File Crossing an Air Gap Carried Its Trust Contract/i);
  assert.match(launchArticle, /The QR transfer is prior art/i);
});

test("publishes a visitor-first community front door", async () => {
  const [readme, conduct, governance, support, citation, issueConfig, deviceResult] = await Promise.all([
    readFile(readmeUrl, "utf8"),
    readFile(conductUrl, "utf8"),
    readFile(governanceUrl, "utf8"),
    readFile(supportUrl, "utf8"),
    readFile(citationUrl, "utf8"),
    readFile(issueConfigUrl, "utf8"),
    readFile(deviceResultUrl, "utf8"),
  ]);

  assert.match(readme, /Move trusted data through light/i);
  assert.match(readme, /glassbridge-social-preview\.png/);
  assert.match(readme, /Try the browser flow/i);
  assert.match(readme, /Speed without fiction/i);
  assert.match(readme, /licensed under the.*Apache License 2\.0/is);
  assert.match(conduct, /technical candor/i);
  assert.match(governance, /maintainer-led research project/i);
  assert.match(support, /private vulnerability reporting/i);
  assert.match(citation, /cff-version: 1\.2\.0/);
  assert.match(issueConfig, /security\/advisories\/new/);
  assert.match(deviceResult, /glassbridge-capacity\/5/);
  assert.match(deviceResult, /glassbridge-device-run\/1/);
});

test("publishes coherent Apache-2.0 licensing metadata", async () => {
  const [license, packageJson, cargoManifest, citation, contributing, ...crateManifests] = await Promise.all([
    readFile(licenseUrl, "utf8"),
    readFile(packageJsonUrl, "utf8"),
    readFile(cargoManifestUrl, "utf8"),
    readFile(citationUrl, "utf8"),
    readFile(contributingUrl, "utf8"),
    ...crateManifestUrls.map((url) => readFile(url, "utf8")),
  ]);

  assert.match(license, /^Apache License\n\s+Version 2\.0, January 2004/);
  assert.match(license, /Grant of Patent License/);
  assert.equal(JSON.parse(packageJson).license, "Apache-2.0");
  assert.match(cargoManifest, /license = "Apache-2\.0"/);
  for (const crateManifest of crateManifests) {
    assert.match(crateManifest, /license\.workspace = true/);
  }
  assert.match(citation, /license: Apache-2\.0/);
  assert.match(contributing, /Under Section 5/i);
});

test("uses product-specific metadata and no starter copy", async () => {
  const [page, index] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(indexUrl, "utf8"),
  ]);

  assert.match(index, /GlassBridge \/ AGX/);
  assert.match(index, /disconnected security boundaries/i);
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

  assert.match(serviceWorker, /const PRECACHE_URLS = new Set/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(/);
  assert.match(serviceWorker, /event\.request\.mode === "navigate"/);
  assert.match(serviceWorker, /if \(!cachedUrl\) return/);

  const network = serviceWorkerHarness(serviceWorker, {
    networkResponse: new Response("network", { status: 200 }),
  });
  assert.equal(await (await network.dispatchNavigation()).text(), "network");
  assert.deepEqual(network.events, ["fetch"]);

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
  assert.deepEqual(cacheFailure.events, ["fetch"]);

  const cachedAsset = serviceWorkerHarness(serviceWorker, {
    cachedResponse: new Response("precache", { status: 200 }),
  });
  assert.equal(await (await cachedAsset.dispatchAsset()).text(), "precache");
  assert.deepEqual(cachedAsset.events, ["match"]);

  const unknown = serviceWorkerHarness(serviceWorker, {
    networkResponse: new Response("must-not-be-runtime-cached", { status: 200 }),
  });
  assert.equal(unknown.dispatchUnknown(), undefined);
  assert.deepEqual(unknown.events, []);
});

test("publishes current prior-art provenance and canonical measurement schemas", async () => {
  const [page, readme, launchArticle, notices, licenses, capacitySchema, deviceRunSchema, publishedCapacity, publishedDeviceRun] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(readmeUrl, "utf8"),
    readFile(launchArticleUrl, "utf8"),
    readFile(thirdPartyNoticesUrl, "utf8"),
    readFile(thirdPartyLicensesUrl, "utf8"),
    readFile(capacitySchemaUrl, "utf8"),
    readFile(deviceRunSchemaUrl, "utf8"),
    readFile(publishedCapacitySchemaUrl, "utf8"),
    readFile(publishedDeviceRunSchemaUrl, "utf8"),
  ]);
  const publicClaims = `${page}\n${readme}\n${launchArticle}`;

  assert.match(publicClaims, /418\.5 KB\/s/);
  assert.match(publicClaims, /199\.2 KB\/s/);
  assert.match(publicClaims, /AGPL-3\.0-or-later/);
  assert.match(notices, /29cba8fa25dd160c8b6aa18fe3b48fbc5bde2e36/);
  assert.match(notices, /Copyright \(c\) 2026 Evan Crawley \(Bash Alarmist\)/);
  assert.match(readme, /THIRD_PARTY_LICENSES\.md/);
  assert.match(licenses, /# Production npm dependency licenses/);
  assert.equal(publishedCapacity, capacitySchema);
  assert.equal(publishedDeviceRun, deviceRunSchema);
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

test("queues built-in samples before profile selection and preparation", async () => {
  const senderSource = await readFile(new URL("../src/sender/SenderApp.tsx", import.meta.url), "utf8");
  const demoHandler = extractFunctionBody(senderSource, "function useSample(): void");
  const capacityHandler = extractFunctionBody(senderSource, "function useCapacitySample(): void");

  assert.match(senderSource, /MILESTONE 16 OPTICAL LAB/);
  for (const handler of [demoHandler, capacityHandler]) {
    assert.match(handler, /selectFile\(sample\);/);
    assert.equal(handler.match(/selectFile\(sample\);/g)?.length, 1);
    assert.doesNotMatch(handler, /\bprepareTransfer\s*\(/);
  }
  assert.match(senderSource, /onClick=\{useSample\}/);
  assert.match(senderSource, /onClick=\{useCapacitySample\}/);
  assert.match(senderSource, /Grid 30 is the registered post-QR lab path/);
});

test("never blocks camera startup using unreliable phone orientation metadata", async () => {
  const receiver = await readFile(receiverAppUrl, "utf8");
  const capture = await readFile(cameraCaptureUrl, "utf8");
  assert.doesNotMatch(receiver, /dualLaneNeedsLandscape|dualLaneViewportNeedsLandscape/);
  assert.match(receiver, /Landscape is recommended[^<]+never a blocker/);
  assert.match(capture, /Math\.sqrt\(maxPixels \/ \(sourceWidth \* sourceHeight\)\)/);
});

test("keeps comparable post-receive analytics visible through release", async () => {
  const [receiver, report] = await Promise.all([
    readFile(receiverAppUrl, "utf8"),
    readFile(capacityReportUrl, "utf8"),
  ]);
  assert.equal(receiver.match(/<CapacityScorecard/g)?.length, 2);
  assert.match(receiver, /POST-RECEIVE ANALYTICS/);
  assert.match(receiver, /Copy benchmark JSON/);
  assert.match(receiver, /Save \/ share benchmark JSON/);
  assert.match(report, /glassbridge-capacity\/5/);
  assert.match(report, /run_id/);
  assert.match(report, /source_mode/);
  assert.match(report, /report\.profile\.id === current\.profile\.id &&[\s\S]+report\.device === current\.device &&[\s\S]+report\.payload_sha256 === current\.payload_sha256/);
  assert.match(report, /CAPACITY_HISTORY_LIMIT = 20/);
});

function serviceWorkerHarness(
  source,
  { networkResponse, networkError, cachedResponse, cachePutError } = {},
) {
  const events = [];
  let fetchHandler;
  const origin = "https://glassbridge.test";
  const sendUrl = new URL(precachePath(source, "send.html"), origin).href;
  const receiveUrl = new URL(precachePath(source, "receive.html"), origin).href;
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
      location: { origin },
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
          url: sendUrl,
        },
        respondWith: (value) => { responsePromise = value; },
      });
      assert.ok(responsePromise);
      return responsePromise;
    },
    dispatchAsset: () => {
      let responsePromise;
      fetchHandler({
        request: {
          method: "GET",
          mode: "same-origin",
          url: receiveUrl,
        },
        respondWith: (value) => { responsePromise = value; },
      });
      assert.ok(responsePromise);
      return responsePromise;
    },
    dispatchUnknown: () => {
      let responsePromise;
      fetchHandler({
        request: {
          method: "GET",
          mode: "same-origin",
          url: new URL("./not-in-the-release.txt", sendUrl).href,
        },
        respondWith: (value) => { responsePromise = value; },
      });
      return responsePromise;
    },
  };
}

function precachePath(source, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`\"([^\"]*\\/${escaped})\"`));
  assert.ok(match, `missing precached ${filename}`);
  return match[1];
}

function extractFunctionBody(source, signature) {
  const signatureStart = source.indexOf(signature);
  assert.notEqual(signatureStart, -1, `missing ${signature}`);
  const bodyStart = source.indexOf("{", signatureStart + signature.length);
  assert.notEqual(bodyStart, -1, `missing body for ${signature}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated body for ${signature}`);
}
