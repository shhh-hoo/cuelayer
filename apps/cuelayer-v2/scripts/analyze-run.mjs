import { readFile, writeFile } from "node:fs/promises";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Pass an ignored run.json; this analyzer never calls a provider.",
  );
const run = JSON.parse(await readFile(path, "utf8"));
const snapshots = run.rows ?? [run.snapshot];
const spans = [
  ...new Map(
    snapshots.flatMap((s) => s.spans).map((s) => [s.spanId, s]),
  ).values(),
];
const events = snapshots.at(-1)?.events ?? [];
const evidence = snapshots.at(-1)?.replay.evidence ?? [];
const sameSource = (a, b) =>
  a.attributes.traceSourceId === b.attributes.traceSourceId;
const named = (name) => spans.filter((s) => s.name === name);
const stats = (values) => {
  const v = values
      .filter((x) => Number.isFinite(x) && x >= 0)
      .sort((a, b) => a - b),
    n = v.length;
  return {
    n,
    medianMs: n
      ? (v[Math.floor((n - 1) / 2)] + v[Math.ceil((n - 1) / 2)]) / 2
      : null,
    p95Ms: n >= 20 ? v[Math.ceil(n * 0.95) - 1] : null,
    minMs: n ? v[0] : null,
    maxMs: n ? v.at(-1) : null,
    rawMs: v,
  };
};
const interval = (name) => stats(named(name).map((s) => s.end - s.start));
const first = named("first-useful-output").filter(
  (s) => s.attributes.lane === "Live",
);
const complete = named("model-complete").filter(
  (s) => s.attributes.lane === "Live",
);
const requestFor = (s) =>
  named("model-request").find(
    (r) => r.attributes.taskId === s.attributes.taskId && sameSource(s, r),
  );
const accepted = named("semantic-accepted").filter(
  (s) => s.attributes.lane === "Live",
);
const useful = [];
for (const a of accepted.filter((s) => s.attributes.changed)) {
  const output = named("model-complete").find(
    (s) => s.attributes.taskId === a.attributes.taskId && sameSource(a, s),
  );
  let proposal;
  try {
    proposal = JSON.parse(output?.attributes.output ?? "null");
  } catch {}
  const targets =
    proposal?.operations.filter((o) => o.type === "put").map((o) => o.id) ?? [];
  const cue = proposal?.operations.some((o) => o.type === "cue" && o.value);
  const dom = spans.find(
    (s) =>
      s.end >= a.end &&
      sameSource(a, s) &&
      s.attributes.revision === a.attributes.revision &&
      ((s.name === "learner-visible-dom" &&
        targets.some((id) => s.attributes.targets.includes(id))) ||
        (s.name === "cue-visible-dom" && cue)),
  );
  if (!dom) continue;
  const consumed = evidence.filter((e) => a.attributes.consumed.includes(e.id));
  const last = consumed.at(-1);
  useful.push({
    taskId: a.attributes.taskId,
    acceptedToDomMs: dom.end - a.end,
    finalToDomMs: last ? dom.end - last.receivedAt : null,
    audioToDomMs:
      run.identity === "cuelayer-v2-generated-audio-1" &&
      last?.audioObservedAt !== null &&
      last?.audioObservedAt !== undefined
        ? dom.end - last.audioObservedAt
        : null,
    boundary:
      "last consumed provider interval end; DOM contains a changed unit or newly visible Cue",
  });
}
const firstPartials = [
  ...new Map(
    named("speech-partial")
      .map((s) => [s.attributes.segmentId, s])
      .reverse(),
  ).values(),
];
const metrics = {
  audioToFirstPartial: stats(
    run.identity === "cuelayer-v2-generated-audio-1"
      ? firstPartials
          .filter((s) => s.attributes.audioObservedAt !== null)
          .map((s) => s.end - s.attributes.audioObservedAt)
      : [],
  ),
  audioToFinal:
    run.identity === "cuelayer-v2-generated-audio-1"
      ? interval("audio-to-final")
      : stats([]),
  finalToDurable: interval("final-to-window"),
  finalToLiveDispatch: interval("final-to-live-dispatch"),
  evidenceToLiveDispatch: interval("evidence-to-live-queued"),
  liveStartToFirstOutput: stats(first.map((s) => s.end - s.start)),
  liveStartToComplete: stats(
    complete.map((s) => s.end - (requestFor(s)?.start ?? NaN)),
  ),
  proposalToAccepted: stats(
    accepted.map(
      (a) =>
        a.end -
        (complete.find(
          (c) =>
            c.attributes.taskId === a.attributes.taskId && sameSource(a, c),
        )?.end ?? NaN),
    ),
  ),
  acceptedToDom: stats(useful.map((s) => s.acceptedToDomMs)),
  audioToUsefulDom: stats(
    useful.map((s) => s.audioToDomMs).filter((x) => x !== null),
  ),
};
const failures = named("proposal-rejected").map((s) => ({
  lane: s.attributes.lane,
  reason: s.attributes.reason,
  taskId: s.attributes.taskId,
}));
const final = snapshots.at(-1);
const report = {
  identity: run.identity,
  scenario: run.scenario,
  config: run.config,
  metrics,
  useful,
  quality: {
    liveAccepted: accepted.length,
    dispositions: Object.values(final?.replay.consumed ?? {}).reduce(
      (a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a),
      {},
    ),
    unresolvedRemaining: Object.keys(final?.replay.unresolved ?? {}).length,
    failures,
    attentionDiscarded: named("attention-discarded").length,
    semanticReview:
      "Counts describe structural outcomes, not semantic accuracy. Review expected stories and actual accepted objects separately.",
  },
  coverage: {
    evidence: evidence.length,
    consumed: Object.keys(final?.replay.consumed ?? {}).length,
    acceptedEvents: events.filter((e) => e.type === "accepted").length,
    maxPendingAgeMs: Math.max(
      0,
      ...(run.samples ?? []).map((s) => s.window.oldestPendingAge),
    ),
    pendingWhileInput: (run.samples ?? []).map((s) => ({
      at: s.at,
      count: s.window.livePendingCount,
      age: s.window.oldestPendingAge,
    })),
  },
  caveats: [
    "No p95 for fewer than 20 samples. Small medians are descriptive, not performance guarantees.",
    "Generated audio/emulated microphone is not owner microphone dogfood.",
    "Missing useful DOM, timeout and schema failure are missing/failed observations, never zero latency.",
    "All joined spans share one browser source/clock. Audio mapping uses PCM sample positions and <=100ms observation bins, not physical capture time.",
  ],
};
await writeFile(
  path.replace(/run\.json$/, "analysis.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      identity: report.identity,
      scenario: report.scenario,
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [
          k,
          { ...v, rawMs: undefined },
        ]),
      ),
      quality: {
        ...report.quality,
        failures: failures.map((f) => ({ lane: f.lane, reason: f.reason })),
      },
      coverage: { ...report.coverage, pendingWhileInput: undefined },
    },
    null,
    2,
  ),
);
