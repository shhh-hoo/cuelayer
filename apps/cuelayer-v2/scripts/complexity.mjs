import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { format } from "prettier";
const deterministicHead = "1c7c0ce05a1f54406d435d62f09d3ad0ac585587";
const root = resolve("../.."),
  base = "3ac50ab0918191605c8b7152d9ae943061f3a459";
const groups = {
  "queue/retry": {
    old: [
      "src/lesson-stream/pending-evidence.ts",
      "src/session/retry-backoff.ts",
    ],
    v2: [],
  },
  persistence: {
    old: ["src/lesson-stream/store.ts"],
    v2: ["src/adapters/storage.ts"],
  },
  "Canvas mechanics and policy": {
    old: [
      "src/canvas-spatial/Canvas.tsx",
      "src/canvas-spatial/geometry.ts",
      "src/canvas-spatial/motion.ts",
      "src/canvas-spatial/presentation.ts",
      "src/canvas-spatial/semantic-space.ts",
      "src/canvas-spatial/relations.ts",
    ],
    v2: ["src/adapters/canvas.tsx", "src/adapters/cue.tsx", "src/display.ts"],
  },
  "plot/math mechanics and grounding": {
    old: [
      "src/representation-capabilities/mathematics.tsx",
      "src/representation-capabilities/sine.ts",
    ],
    v2: ["src/adapters/notation.tsx", "src/adapters/plot.tsx"],
  },
  "session lifecycle and domain coordination": {
    old: [
      "src/lesson-stream/core/live-session.ts",
      "src/lesson-stream/core/runtime.ts",
    ],
    v2: ["src/session.ts"],
  },
  "trace plumbing": {
    old: [
      "src/trace/store.ts",
      "src/trace/writer.ts",
      "src/trace/dom-visibility.ts",
      "src/trace/learner-latency.ts",
    ],
    v2: ["src/adapters/trace.ts"],
  },
};
const count = async (code, path) => {
  const normalized = await format(code, { filepath: path, printWidth: 80 });
  return {
    rawNonblank: code.split("\n").filter((s) => s.trim()).length,
    normalizedNonblank: normalized.split("\n").filter((s) => s.trim()).length,
    bytes: Buffer.byteLength(code),
  };
};
const report = {
  baseline: base,
  method:
    "Complete files, consistently Prettier-formatted at 80 columns. Mixed semantic policy is INCLUDED, never hidden in adapters. Nonblank LOC includes comments/types. No feature-parity claim.",
  groups: {},
  totals: { old: 0, v2: 0 },
  v2Source: {},
  bundle: {},
};
for (const [name, group] of Object.entries(groups)) {
  const result = { old: [], v2: [], oldLOC: 0, v2LOC: 0 };
  for (const path of group.old) {
    const source = execFileSync("git", ["show", `${base}:${path}`], {
      cwd: root,
      encoding: "utf8",
    });
    const n = await count(source, path);
    result.old.push({ path, ...n });
    result.oldLOC += n.normalizedNonblank;
  }
  for (const path of group.v2) {
    const n = await count(await readFile(path, "utf8"), path);
    result.v2.push({ path, ...n });
    result.v2LOC += n.normalizedNonblank;
  }
  report.groups[name] = result;
  report.totals.old += result.oldLOC;
  report.totals.v2 += result.v2LOC;
}
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      ),
    )
  ).flat();
}
for (const path of [...(await walk("src")), ...(await walk("server"))])
  if (/\.tsx?$/.test(path))
    report.v2Source[path] = await count(await readFile(path, "utf8"), path);
const addedInfrastructure = [
  "src/adapters/live.ts",
  "src/adapters/microphone.ts",
  "src/model-context.ts",
  "server/live.ts",
  "server/plugin.ts",
];
// Include the entire React shell and ingress adapter, even though their old
// counterparts are outside the selected comparison. Never hide wiring here.
report.v2InfrastructureUpperBound = {
  normalizedNonblank:
    report.totals.v2 +
    report.v2Source["src/main.tsx"].normalizedNonblank +
    report.v2Source["src/adapters/speech.ts"].normalizedNonblank +
    addedInfrastructure.reduce(
      (sum, p) => sum + report.v2Source[p].normalizedNonblank,
      0,
    ),
  additionalFiles: [
    "src/main.tsx",
    "src/adapters/speech.ts",
    ...addedInfrastructure,
  ],
  definition:
    "All infrastructure-bearing TypeScript files, including mixed domain/display policy and the full React shell. Excludes pure contract/acceptance policy, authored story fixture, CSS, configuration and tests. This is an upper bound, not an exact generic-only statement count.",
};
for (const [label, dir] of [
  ["v2", "dist/assets"],
  ["production", "../../dist/assets"],
]) {
  try {
    const files = (await walk(dir)).filter((p) => p.endsWith(".js"));
    const chunks = [];
    for (const path of files) {
      const bytes = await readFile(path);
      chunks.push({ path, bytes: bytes.length, gzip: gzipSync(bytes).length });
    }
    report.bundle[label] = {
      chunks,
      totalBytes: chunks.reduce((s, c) => s + c.bytes, 0),
      totalGzip: chunks.reduce((s, c) => s + c.gzip, 0),
    };
  } catch {
    report.bundle[label] = { unavailable: true };
  }
}
report.caveats = [
  "Queue/retry V2 shows zero standalone engines; ALL p-queue/p-retry integration and lifecycle code is counted in src/session.ts, including CueLayer policy.",
  "Canvas includes React render boundary, shape mounting, Cue, display selection and geography; generic DOM visibility measurement also lives there and is fully counted.",
  "Baseline plot category includes three sine variants and their grounding; V2 has one finite sine plot. These are different capability envelopes.",
  "Trace baseline includes durable batching, priority, retries and retention; V2 stores a bounded span ring on explicit flush and does not replace all observability features.",
  "Real microphone/model integration, prompt/schema generation and all adapter wiring are now included. Legacy import and broader production capabilities remain omitted, not substrate savings.",
  "These totals are conservative infrastructure-bearing-file comparisons, not an exact separation of semantic vs generic statements. Semantic acceptance and contract source are separately listed.",
];
// Reapply the exact same formatter/count function to EVERY authored TS runtime
// file at #42 and now. Model prompts/schema glue are code, never excluded.
const baselinePaths = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", deterministicHead, "apps/cuelayer-v2"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .map((p) => p.replace("apps/cuelayer-v2/", ""));
const baselineSource = {};
for (const path of baselinePaths.filter(
  (p) => p.startsWith("src/") && /\.tsx?$/.test(p),
))
  baselineSource[path] = await count(
    execFileSync(
      "git",
      ["show", `${deterministicHead}:apps/cuelayer-v2/${path}`],
      { cwd: root, encoding: "utf8" },
    ),
    path,
  );
const categories = {
  "speech/provider adapter": [
    "src/adapters/speech.ts",
    "src/adapters/microphone.ts",
  ],
  "Session/runtime": ["src/session.ts"],
  "semantic acceptance and contract": ["src/acceptance.ts", "src/contract.ts"],
  "model adapter/prompt/schema/HTTP": [
    "src/adapters/live.ts",
    "src/model-context.ts",
    "server/live.ts",
    "server/plugin.ts",
  ],
  persistence: ["src/adapters/storage.ts"],
  tracing: ["src/adapters/trace.ts"],
  display: [
    "src/display.ts",
    "src/adapters/canvas.tsx",
    "src/adapters/cue.tsx",
    "src/adapters/notation.tsx",
    "src/adapters/plot.tsx",
    "src/main.tsx",
  ],
  "authored synthetic interpreter": ["src/story.ts"],
};
const sum = (paths, source) =>
  paths.reduce((n, p) => n + (source[p]?.normalizedNonblank ?? 0), 0);
report.completeRuntime = {
  deterministicHead,
  method: report.method,
  deterministicLOC: sum(Object.keys(baselineSource), baselineSource),
  realServiceLOC: sum(Object.keys(report.v2Source), report.v2Source),
  categories: Object.fromEntries(
    Object.entries(categories).map(([key, paths]) => [
      key,
      {
        paths,
        deterministicLOC: sum(paths, baselineSource),
        realServiceLOC: sum(paths, report.v2Source),
      },
    ]),
  ),
};
report.evaluationPlumbing = {
  method: report.method,
  deterministicLOC: 0,
  realServiceLOC: 0,
  files: [],
};
for (const path of [
  ...(await walk("tests")),
  ...(await walk("scripts")),
].filter((p) => /\.(ts|tsx|mjs|json)$/.test(p))) {
  const current = await count(await readFile(path, "utf8"), path);
  const prior = baselinePaths.includes(path)
    ? await count(
        execFileSync(
          "git",
          ["show", `${deterministicHead}:apps/cuelayer-v2/${path}`],
          { cwd: root, encoding: "utf8" },
        ),
        path,
      )
    : null;
  report.evaluationPlumbing.files.push({
    path,
    deterministicLOC: prior?.normalizedNonblank ?? 0,
    realServiceLOC: current.normalizedNonblank,
  });
  report.evaluationPlumbing.deterministicLOC += prior?.normalizedNonblank ?? 0;
  report.evaluationPlumbing.realServiceLOC += current.normalizedNonblank;
}
report.configurationAndStyle = [];
for (const path of [
  "src/style.css",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "tsconfig.json",
  "package.json",
  "index.html",
]) {
  const current = await count(await readFile(path, "utf8"), path);
  const prior = await count(
    execFileSync(
      "git",
      ["show", `${deterministicHead}:apps/cuelayer-v2/${path}`],
      { cwd: root, encoding: "utf8" },
    ),
    path,
  );
  report.configurationAndStyle.push({
    path,
    deterministicLOC: prior.normalizedNonblank,
    realServiceLOC: current.normalizedNonblank,
  });
}
await mkdir("../../.cuelayer/v2", { recursive: true });
await writeFile(
  "../../.cuelayer/v2/complexity.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      totals: report.totals,
      completeRuntime: report.completeRuntime,
      evaluationPlumbing: {
        deterministicLOC: report.evaluationPlumbing.deterministicLOC,
        realServiceLOC: report.evaluationPlumbing.realServiceLOC,
      },
      v2InfrastructureUpperBound: report.v2InfrastructureUpperBound,
      groups: Object.fromEntries(
        Object.entries(report.groups).map(([k, v]) => [
          k,
          { old: v.oldLOC, v2: v.v2LOC },
        ]),
      ),
      bundle: Object.fromEntries(
        Object.entries(report.bundle).map(([k, v]) => [
          k,
          { gzip: v.totalGzip, bytes: v.totalBytes },
        ]),
      ),
    },
    null,
    2,
  ),
);
