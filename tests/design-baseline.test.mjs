import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const indexUrl = new URL("../index.html", import.meta.url);
const researchDocumentUrl = new URL(
  "../research/GlassBridge_AGX_PRD.html",
  import.meta.url,
);

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
