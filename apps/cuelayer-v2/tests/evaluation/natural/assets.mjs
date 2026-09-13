import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { exclusive, readJSON, sha256 } from "../evidence.mjs";

const base = "https://cdn.tldraw.com/5.4.2/";
// Versioned default assets requested by the frozen tldraw 5.4.2 renderer. These
// are acquired before authorization; browser execution fulfills only these bytes.
export const NATURAL_RENDERER_URLS = [
  "translations/en.json",
  "icons/icon/0_merged.svg",
  ...[
    "tldraw",
    "figma",
    "canva",
    "google_maps",
    "val_town",
    "codesandbox",
    "codepen",
    "scratch",
    "youtube",
    "google_calendar",
    "google_slides",
    "github_gist",
    "replit",
    "felt",
    "spotify",
    "vimeo",
    "observable",
    "desmos",
  ].map((name) => `embed-icons/${name}.png`),
  ...["Mono", "Serif", "Sans"].flatMap((font) =>
    ["Medium", "MediumItalic", "Bold", "BoldItalic"].map(
      (style) => `fonts/IBMPlex${font}-${style}.woff2`,
    ),
  ),
  ...["Regular", "Regular_Italic", "Bold", "Bold_Italic"].map(
    (style) => `fonts/Shantell_Sans-Informal_${style}.woff2`,
  ),
].map((path) => base + path);

export async function acquireNaturalAssets(out, transport = fetch) {
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { recursive: false });
  const assets = [];
  // No authorization headers, credentials, redirects or provider endpoints.
  for (const url of NATURAL_RENDERER_URLS) {
    const response = await transport(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 200)
      throw Error("natural-renderer-asset-unavailable:" + url);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2 * 1024 * 1024)
      throw Error("natural-renderer-asset-size");
    const path = resolve(out, url.slice(base.length));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    assets.push({
      url,
      path,
      sha256: sha256(bytes),
      bytes: bytes.length,
      content_type:
        response.headers.get("content-type") ?? "application/octet-stream",
    });
  }
  const manifest = {
    identity: "cuelayer-v2-natural-renderer-assets-1",
    version: "5.4.2",
    assets,
  };
  await exclusive(resolve(out, "renderer-assets.json"), manifest);
  return manifest;
}

export async function verifyNaturalAssets(input) {
  const manifest = typeof input === "string" ? await readJSON(input) : input;
  if (
    manifest?.identity !== "cuelayer-v2-natural-renderer-assets-1" ||
    manifest.version !== "5.4.2" ||
    sha256(manifest.assets.map((a) => a.url)) !== sha256(NATURAL_RENDERER_URLS)
  )
    throw Error("natural-renderer-asset-manifest-drift");
  const bytes = new Map();
  for (const asset of manifest.assets) {
    const body = await readFile(asset.path);
    if (body.length !== asset.bytes || sha256(body) !== asset.sha256)
      throw Error("natural-renderer-asset-drift");
    bytes.set(asset.url, { ...asset, body });
  }
  return { manifest, bytes };
}
