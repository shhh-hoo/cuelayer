import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { format } from "prettier";
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
for (const path of await walk("src"))
  if (/\.tsx?$/.test(path))
    report.v2Source[path] = await count(await readFile(path, "utf8"), path);
// Include the entire React shell and ingress adapter, even though their old
// counterparts are outside the selected comparison. Never hide wiring here.
report.v2InfrastructureUpperBound = {
  normalizedNonblank:
    report.totals.v2 +
    report.v2Source["src/main.tsx"].normalizedNonblank +
    report.v2Source["src/adapters/speech.ts"].normalizedNonblank,
  additionalFiles: ["src/main.tsx", "src/adapters/speech.ts"],
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
  "V2 lacks real microphone/model transport and legacy import. Their omitted code must not be counted as substrate savings.",
  "These totals are conservative infrastructure-bearing-file comparisons, not an exact separation of semantic vs generic statements. Semantic acceptance and contract source are separately listed.",
];
await mkdir("../../.cuelayer/v2", { recursive: true });
await writeFile(
  "../../.cuelayer/v2/complexity.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      totals: report.totals,
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
