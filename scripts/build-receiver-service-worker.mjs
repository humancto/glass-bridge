import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const base = process.env.DEPLOY_BASE ?? "/";

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesIn(path));
    } else if (entry.isFile() && entry.name !== "receiver-sw.js") {
      files.push(path);
    }
  }
  return files;
}

const files = (await filesIn(dist)).sort();
const digest = createHash("sha256");
for (const file of files) {
  digest.update(relative(dist, file));
  digest.update(await readFile(file));
}
const cacheName = `glassbridge-receiver-${digest.digest("hex").slice(0, 16)}`;
const assets = files.map((file) => `${base}${relative(dist, file).split(sep).join("/")}`);

const source = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(assets, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("glassbridge-receiver-") && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok && response.status !== 206) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch {
      // A quota or storage failure must not replace a valid network response.
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetchAndCache(event.request).catch(() => caches.match(event.request).then((cached) => cached || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetchAndCache(event.request)),
  );
});
`;

await writeFile(join(dist, "receiver-sw.js"), source, { flag: "wx" });
