import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const captureName = process.argv[2] || "2026-08-30";
const captureRoot = path.join(projectRoot, "reference-captures", captureName);
const manifestPath = path.join(captureRoot, "resource-manifest.json");
const outputRoot = path.join(captureRoot, "frontend-assets");
const resultsPath = path.join(captureRoot, "download-results.json");

const allowedPrefixes = ["/cdn/assets/", "/images/", "/favicon"];
const concurrency = 8;
const maxAssets = 3000;
const staticAssetExtension = /\.(?:js|mjs|css|map|json|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|avif|ico)$/i;

const isAllowed = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      allowedPrefixes.some((prefix) => url.pathname.startsWith(prefix)) &&
      staticAssetExtension.test(url.pathname)
    );
  } catch {
    return false;
  }
};

const canonicalize = (value) => {
  const url = new URL(value);
  url.hash = "";
  return url.href;
};

const outputPathFor = (value) => {
  const url = new URL(value);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  return path.join(outputRoot, ...relative.split("/"));
};

const existsWithContent = async (filePath) => {
  try {
    return (await stat(filePath)).size > 0;
  } catch {
    return false;
  }
};

const discoverReferences = (sourceUrl, text) => {
  const matches = new Set();
  const patterns = [
    /(?:https:\/\/chatgpt\.com)?(\/cdn\/assets\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%\/?-]*)?)/g,
    /(?:https:\/\/chatgpt\.com)?(\/images\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%\/?-]*)?)/g,
    /(?:url\(|from\s*|import\s*\()?\s*["'](\.\.?\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+\.(?:js|css|map|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|avif))(?:\?[^"')\s]*)?["')]/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      try {
        const reference = match[1].replace(/\)format\($/i, "");
        const resolved = new URL(reference, sourceUrl).href;
        if (isAllowed(resolved)) matches.add(canonicalize(resolved));
      } catch {
        // Ignore malformed strings inside minified bundles.
      }
    }
  }
  return [...matches];
};

const initialManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const queue = [];
const seen = new Set();
const results = [];

const enqueue = (value, discoveredFrom = "manifest") => {
  if (!isAllowed(value) || seen.size >= maxAssets) return;
  const canonical = canonicalize(value);
  if (seen.has(canonical)) return;
  seen.add(canonical);
  queue.push({ url: canonical, discoveredFrom });
};

for (const entry of initialManifest) enqueue(entry.url);

await mkdir(outputRoot, { recursive: true });

const downloadOne = async ({ url, discoveredFrom }) => {
  const outputPath = outputPathFor(url);
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (await existsWithContent(outputPath)) {
    results.push({ url, path: path.relative(captureRoot, outputPath), status: "cached", discoveredFrom });
    if (/\.(?:js|css|map)$/i.test(new URL(url).pathname)) {
      try {
        const cachedText = await readFile(outputPath, "utf8");
        for (const discovered of discoverReferences(url, cachedText)) enqueue(discovered, url);
      } catch {
        // A cached binary with a misleading extension is still a valid captured asset.
      }
    }
    return;
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "accept": "*/*",
          "user-agent": "Mozilla/5.0 CodexReferenceCapture/1.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // The timeout can also fire while consuming the response body, so keep
      // fetch + body read inside the same guarded attempt.
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, bytes);
      const contentType = response.headers.get("content-type") || "";
      results.push({
        url,
        path: path.relative(captureRoot, outputPath),
        status: "downloaded",
        bytes: bytes.length,
        contentType,
        discoveredFrom,
      });

      if (/javascript|css|json|text/.test(contentType) || /\.(?:js|css|map)$/i.test(new URL(url).pathname)) {
        const text = bytes.toString("utf8");
        for (const discovered of discoverReferences(url, text)) enqueue(discovered, url);
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }

  results.push({ url, status: "failed", error: String(lastError), discoveredFrom });
};

let cursor = 0;
const worker = async () => {
  while (cursor < queue.length) {
    const index = cursor;
    cursor += 1;
    await downloadOne(queue[index]);
  }
};

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const summary = {
  startedFrom: manifestPath,
  outputRoot,
  uniqueAssets: seen.size,
  downloaded: results.filter((item) => item.status === "downloaded").length,
  cached: results.filter((item) => item.status === "cached").length,
  failed: results.filter((item) => item.status === "failed").length,
  totalBytes: results.reduce((sum, item) => sum + (item.bytes || 0), 0),
};

await writeFile(resultsPath, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
