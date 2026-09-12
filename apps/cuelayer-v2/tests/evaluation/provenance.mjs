import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve, relative, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { transformSync } from "rolldown/utils";
import { createHash } from "node:crypto";
import { PRODUCT_SHA } from "./contract.mjs";
import { sha256, assertInside } from "./evidence.mjs";

export const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const blobHash = (bytes) =>
  createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
export class Provenance {
  constructor(
    product,
    evaluator,
    { allowDirtyEvaluator = false, productSha = PRODUCT_SHA } = {},
  ) {
    this.productSha = productSha;
    this.product = realpathSync(product);
    this.evaluator = realpathSync(evaluator);
    if (this.product === this.evaluator) throw Error("dual-checkout-required");
    if (git(this.product, "rev-parse", "HEAD") !== this.productSha)
      throw Error("product-sha-mismatch");
    if (git(this.product, "status", "--porcelain", "--untracked-files=normal"))
      throw Error("product-worktree-dirty");
    this.evaluatorClean = !git(
      this.evaluator,
      "status",
      "--porcelain",
      "--untracked-files=normal",
    );
    if (!allowDirtyEvaluator && !this.evaluatorClean)
      throw Error("evaluator-worktree-dirty");
    this.tree = new Map(
      git(this.product, "ls-tree", "-r", this.productSha)
        .split("\n")
        .map((line) => {
          const [meta, path] = line.split("\t");
          return [path, meta.split(" ")[2]];
        }),
    );
    this.records = new Map();
    this.edges = [];
    this.dependencies = new Map();
    this.buildInputs = new Map();
    this.dependencySources = new Map();
    this.buildIdentity = {
      node: process.version,
      config: "frozen-root:no-env:no-config-file:no-alias:no-optimizer:v1",
    };
  }
  verifyFile(path, surface = "node", transformed = null) {
    const actual = realpathSync(path);
    assertInside(this.product, actual);
    const rel = relative(this.product, actual),
      bytes = readFileSync(actual),
      blob = blobHash(bytes);
    if (!this.tree.has(rel) || this.tree.get(rel) !== blob)
      throw Error("product-blob-mismatch:" + rel);
    const record = {
      surface,
      path: actual,
      relative_path: rel,
      git_blob: blob,
      source_sha256: sha256(bytes),
      ...(transformed === null
        ? {}
        : {
            transform_sha256: sha256(transformed),
            build_identity: this.buildIdentity,
          }),
    };
    this.records.set(surface + ":" + actual, record);
    return record;
  }
  inspect(path, surface, parent = null, transformed = null) {
    if (!existsSync(path)) throw Error("missing-runtime-module:" + path);
    const actual = realpathSync(path);
    if (this.cache && actual.startsWith(realpathSync(this.cache) + "/")) {
      const metadataPath = resolve(this.cache, "deps/_metadata.json");
      if (!existsSync(metadataPath) || !this.buildInputs.size)
        throw Error("unproven-browser-cache");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      const entry = Object.values({
        ...metadata.optimized,
        ...metadata.chunks,
      }).find((x) => resolve(dirname(metadataPath), x.file) === actual);
      if (!entry) throw Error("unknown-browser-cache-file");
      if (entry.src)
        this.inspect(
          resolve(dirname(metadataPath), entry.src),
          "dependency-cache-origin",
        );
      this.records.set("cache:" + actual, {
        surface,
        path: actual,
        transform_sha256: sha256(readFileSync(actual)),
        metadata_sha256: sha256(readFileSync(metadataPath)),
        build_identity: this.buildIdentity,
      });
      return actual;
    }
    if (actual.includes("/node_modules/")) {
      let dir = dirname(actual);
      while (dir !== dirname(dir) && !existsSync(resolve(dir, "package.json")))
        dir = dirname(dir);
      if (!existsSync(resolve(dir, "package.json")))
        throw Error("dependency-identity-missing");
      const packagePath = resolve(dir, "package.json"),
        bytes = readFileSync(packagePath),
        pkg = JSON.parse(bytes);
      // Resolve from the product's dependency tree, not a sibling/evaluator install.
      const roots = [
        resolve(this.product, "node_modules"),
        resolve(this.product, "apps/cuelayer-v2/node_modules"),
      ]
        .filter(existsSync)
        .map((x) => realpathSync(x));
      const fromProduct = roots.some((root) => actual.startsWith(root + "/"));
      const tooling =
        (pkg.name === "vite" && actual.includes("/vite/dist/client/")) ||
        (surface === "node" &&
          actual.startsWith(this.evaluator + "/") &&
          parent &&
          !parent.startsWith(pathToFileURL(this.product).href + "/"));
      if (!fromProduct && !tooling)
        throw Error("dependency-outside-frozen-install:" + actual);
      this.dependencies.set(packagePath, {
        path: packagePath,
        name: pkg.name,
        version: pkg.version,
        package_sha256: sha256(bytes),
      });
      this.dependencySources.set(actual, {
        path: actual,
        source_sha256: sha256(readFileSync(actual)),
        role: fromProduct ? "product-dependency" : "evaluator-tooling",
      });
      if (surface === "dependency-build")
        this.buildInputs.set(actual, {
          path: actual,
          source_sha256: sha256(readFileSync(actual)),
        });
    } else if (actual.startsWith(this.product + "/"))
      this.verifyFile(actual, surface, transformed);
    else if (/\/apps\/cuelayer-v2\/(src|server)\//.test(actual))
      throw Error("evaluator-product-copy-forbidden:" + actual);
    this.edges.push({ surface, importer: parent, resolved: actual });
    return actual;
  }
  nodeHooks() {
    const provenance = this;
    return registerHooks({
      resolve(specifier, context, nextResolve) {
        let candidate;
        if (specifier.startsWith("file:")) candidate = fileURLToPath(specifier);
        else if (
          specifier.startsWith(".") &&
          context.parentURL?.startsWith("file:")
        )
          candidate = resolve(
            dirname(fileURLToPath(context.parentURL)),
            specifier,
          );
        if (candidate && !extname(candidate))
          candidate =
            [
              candidate,
              ...[".ts", ".tsx", ".js", ".mjs"].map((x) => candidate + x),
            ].find(existsSync) ?? candidate;
        const rewrite =
          candidate &&
          candidate.startsWith(provenance.product + "/") &&
          !candidate.includes("/node_modules/") &&
          candidate.endsWith(".ts");
        const result = nextResolve(
          rewrite ? pathToFileURL(candidate).href : specifier,
          context,
        );
        if (result.url.startsWith("file:"))
          provenance.inspect(
            fileURLToPath(result.url),
            "node",
            context.parentURL ?? null,
          );
        return result;
      },
      load(url, context, nextLoad) {
        if (
          url.startsWith("file:") &&
          url.endsWith(".ts") &&
          fileURLToPath(url).startsWith(provenance.product + "/") &&
          !url.includes("/node_modules/")
        ) {
          const transformed = transformSync(
            fileURLToPath(url),
            readFileSync(fileURLToPath(url), "utf8"),
            { lang: "ts", target: "esnext" },
          );
          if (transformed.errors.length)
            throw Error("node-transform-failed:" + url);
          const source = transformed.code;
          provenance.verifyFile(fileURLToPath(url), "node", source);
          return { format: "module", source, shortCircuit: true };
        }
        const result = nextLoad(url, context);
        if (
          url.startsWith("file:") &&
          fileURLToPath(url).startsWith(provenance.product + "/") &&
          !url.includes("/node_modules/")
        )
          provenance.verifyFile(
            fileURLToPath(url),
            "node",
            result.source === null ? null : String(result.source),
          );
        return result;
      },
    });
  }
  vitePlugin() {
    const p = this;
    return {
      name: "gate3b-frozen-product-provenance",
      enforce: "post",
      async resolveId(id, importer, options) {
        if (id.startsWith("\0") || id.startsWith("/@")) return null;
        const result = await this.resolve(id, importer, {
          ...options,
          skipSelf: true,
        });
        if (result?.id?.startsWith("/") && existsSync(result.id.split("?")[0]))
          p.inspect(result.id.split("?")[0], "browser", importer ?? null);
        return result;
      },
      transform(code, id) {
        const path = id.split("?")[0];
        if (path.startsWith("/") && existsSync(path))
          p.inspect(path, "browser", null, code);
        return null;
      },
    };
  }
  verifyBrowserGraph(server, loadedURLs) {
    const graph = [];
    for (const url of loadedURLs) {
      const pathname = new URL(url).pathname;
      const moduleGraph = server.environments.client.moduleGraph;
      const node =
        moduleGraph.urlToModuleMap.get(pathname + new URL(url).search) ||
        moduleGraph.urlToModuleMap.get(pathname) ||
        [...moduleGraph.idToModuleMap.values()].find(
          (n) => n.url.split("?")[0] === pathname,
        );
      if (!node?.file || !existsSync(node.file)) {
        const cacheFile = pathname.startsWith("/@fs/")
          ? pathname.slice(4)
          : null;
        if (
          cacheFile &&
          this.cache &&
          cacheFile.startsWith(this.cache + "/") &&
          existsSync(cacheFile)
        ) {
          graph.push({
            url,
            module: this.inspect(cacheFile, "browser-loaded"),
            imports: [],
            transform_sha256: sha256(readFileSync(cacheFile)),
          });
          continue;
        }
        if (pathname.startsWith("/src/") || pathname.startsWith("/@fs/"))
          throw Error("browser-module-source-missing:" + pathname);
        continue;
      }
      const record = this.inspect(
        node.file,
        "browser-loaded",
        node.url,
        node.transformResult?.code ?? null,
      );
      if (
        node.file.startsWith(this.product + "/apps/cuelayer-v2/src/") &&
        !node.transformResult
      )
        throw Error("browser-transform-missing");
      graph.push({
        url,
        module: record,
        imports: [...node.importedModules].map((n) => n.file ?? n.id),
        transform_sha256: node.transformResult
          ? sha256(node.transformResult.code)
          : null,
      });
    }
    for (const role of [
      "session.ts",
      "projection.ts",
      "live-wire.ts",
      "acceptance.ts",
      "contract.ts",
      "adapters/canvas.tsx",
      "adapters/cue.tsx",
    ])
      if (!graph.some((r) => r.module.endsWith("/src/" + role)))
        throw Error("browser-required-module-not-loaded:" + role);
    return graph;
  }
  snapshot() {
    return {
      product_sha: this.productSha,
      product_checkout: this.product,
      evaluator_checkout: this.evaluator,
      evaluator_sha: git(this.evaluator, "rev-parse", "HEAD"),
      clean_worktree: { product: true, evaluator: this.evaluatorClean },
      locks: ["package-lock.json", "apps/cuelayer-v2/package-lock.json"].map(
        (path) => this.verifyFile(resolve(this.product, path)),
      ),
      build_identity: this.buildIdentity,
      modules: [...this.records.values()],
      edges: this.edges,
      dependencies: [...this.dependencies.values()],
      dependency_sources: [...this.dependencySources.values()],
      dependency_build_inputs: [...this.buildInputs.values()],
    };
  }
  verifyRecorded(snapshot) {
    for (const m of snapshot.modules) {
      if (m.relative_path) {
        const actual = this.verifyFile(m.path, m.surface);
        if (
          actual.git_blob !== m.git_blob ||
          actual.source_sha256 !== m.source_sha256
        )
          throw Error("recorded-module-drift");
      } else if (
        m.transform_sha256 &&
        sha256(readFileSync(m.path)) !== m.transform_sha256
      )
        throw Error("stale-browser-build");
    }
    for (const input of snapshot.dependency_build_inputs ?? []) {
      this.inspect(input.path, "dependency-proof");
      if (sha256(readFileSync(input.path)) !== input.source_sha256)
        throw Error("stale-browser-build-input");
    }
    for (const input of snapshot.dependency_sources ?? [])
      if (sha256(readFileSync(input.path)) !== input.source_sha256)
        throw Error("runtime-dependency-bytes-drift");
    return true;
  }
}

export async function loadProduct(provenance) {
  await import("fake-indexeddb/auto");
  provenance.hooks = provenance.nodeHooks();
  const load = (path) =>
    import(
      pathToFileURL(resolve(provenance.product, "apps/cuelayer-v2", path)).href
    );
  const entries = {
    session: "src/session.ts",
    storage: "src/adapters/storage.ts",
    provider: "server/live.ts",
    contract: "src/contract.ts",
    projection: "src/projection.ts",
    acceptance: "src/acceptance.ts",
    stage: "src/stage.ts",
    wire: "src/live-wire.ts",
    fixture: "src/fixture-author.ts",
    display: "src/display.ts",
  };
  const result = {};
  for (const [name, path] of Object.entries(entries))
    result[name] = await load(path);
  return result;
}
