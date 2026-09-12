// Explicit authorized paired experiment. Only tracked authored source enters fresh sessions.
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
if (
  [
    "prepare",
    "verify",
    "preflight",
    "self-test",
    "assess",
    "replay-display",
    "replay-events",
  ].includes(process.argv[2])
) {
  await (await import("../tests/evaluation/cli.mjs")).run();
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes("--live"))
  throw new Error(
    "Legacy paid execution is disabled on the Gate 3b evaluator branch. A final manifest needs separate paid authorization.",
  );
const opt = (name, fallback) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
if (process.argv.includes("--protocol-compare")) {
  const baseline = opt("baseline", null);
  if (!baseline)
    throw new Error(
      "--baseline must identify the unchanged PR46 starting checkout (727accf).",
    );
  const baselineRef = "727accfe79e03c85856a77db645139bae9523ed4";
  const { createHash } = await import("node:crypto");
  const tree = execFileSync(
    "git",
    ["ls-tree", "-rz", "--full-tree", baselineRef, "--", "apps/cuelayer-v2"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const entry of tree) {
    const [meta, path] = entry.split("\t"),
      [mode, type, hash] = meta.split(" ");
    if (type !== "blob" || mode === "120000")
      throw new Error(`unsupported baseline entry: ${path}`);
    const content = await readFile(resolve(baseline, path));
    const actual = createHash("sha1")
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest("hex");
    if (actual !== hash)
      throw new Error(`baseline differs from ${baselineRef}: ${path}`);
  }
  await import("fake-indexeddb/auto");
  const { pathToFileURL } = await import("node:url");
  const load = (p) => import(pathToFileURL(resolve(baseline, p)).href);
  const [
    oldHost,
    oldStorage,
    oldProvider,
    oldStory,
    newHost,
    newStorage,
    newProvider,
    newStory,
  ] = await Promise.all([
    load("apps/cuelayer-v2/src/session.ts"),
    load("apps/cuelayer-v2/src/adapters/storage.ts"),
    load("apps/cuelayer-v2/server/live.ts"),
    load("apps/cuelayer-v2/src/story.ts"),
    import("../src/session.ts"),
    import("../src/adapters/storage.ts"),
    import("../server/live.ts"),
    import("../src/story.ts"),
  ]);
  const old = await oldHost.Session.open(
    "equivalent",
    async () => null,
    new oldStorage.EventStore(`wire-old-${crypto.randomUUID()}`),
  );
  const fresh = await newHost.Session.open(
    "equivalent",
    async () => null,
    new newStorage.EventStore(`wire-new-${crypto.randomUUID()}`),
  );
  old.pause();
  fresh.pause();
  const size = (v) => Buffer.byteLength(JSON.stringify(v));
  const semantic = (state) => ({
    cores: Object.values(state.cores).map((c) => ({
      id: c.id,
      label: c.label ?? c.title,
    })),
    units: Object.values(state.units).map((u) => ({
      id: u.id,
      coreId: u.coreId,
      meaning: u.meaning,
      requires: u.requires,
    })),
    cue: state.cue && { text: state.cue.text, targets: state.cue.targets },
    mainline: state.currentCoreId,
  });
  const rows = [];
  for (const [sequence, index] of [0, 2, 3, 4, 9].entries()) {
    const text = newStory.story[index];
    for (const host of [old, fresh])
      await host.commitEvidence({
        id: `e${sequence}`,
        run: "equivalent",
        source: String(sequence),
        text,
        start: sequence,
        end: sequence + 1,
        receivedAt: performance.now(),
        audioObservedAt: null,
        stability: "COMMITTED",
      });
    const oldTask = old.capture("Live"),
      task = fresh.capture("Live"),
      oldDecision = oldStory.fixtureProposal(oldTask),
      decision = newStory.fixtureProposal(task);
    const oldPayload = await oldProvider.liveRequest(oldTask.capture.request),
      payload = await newProvider.liveRequest(task.capture.request);
    rows.push({
      storyIndex: index,
      sourceChars: text.length,
      old: {
        provider: size(oldPayload),
        projection: size(oldTask.capture.request),
        schema: size(oldPayload.text.format.schema),
        response: size(oldDecision),
      },
      new: {
        provider: size(payload),
        projection: size(task.capture.request),
        schema: size(payload.text.format.schema),
        response: size(decision),
      },
    });
    await old.accept(oldTask, oldDecision);
    await fresh.accept(task, decision);
    if (
      JSON.stringify(semantic(old.state)) !==
      JSON.stringify(semantic(fresh.state))
    )
      throw new Error(`non-equivalent semantic work at story index ${index}`);
  }
  const totals = Object.fromEntries(
    ["provider", "projection", "schema", "response"].map((key) => {
      const previous = rows.reduce((n, r) => n + r.old[key], 0),
        current = rows.reduce((n, r) => n + r.new[key], 0);
      return [
        key,
        { old: previous, new: current, reduction: 1 - current / previous },
      ];
    }),
  );
  const out = resolve(
    opt("out", "../../.cuelayer/v2/repair/protocol-volume.json"),
  );
  await mkdir(resolve(out, ".."), { recursive: true });
  const report = {
    identity: "event3-wire2-equivalent-work-1",
    baseline: baselineRef,
    baselineFilesVerified: tree.length,
    rows,
    totals,
    semanticEquivalent: true,
    providerInvocations: 0,
  };
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  old.close();
  fresh.close();
  process.exit(0);
}
if (process.argv.includes("--offline-baseline")) {
  const baseline = opt("baseline", null);
  if (!baseline)
    throw new Error("--baseline must point to the preserved PR43 repository.");
  await import("fake-indexeddb/auto");
  const { pathToFileURL } = await import("node:url");
  const load = (p) => import(pathToFileURL(resolve(baseline, p)).href);
  const [
    { Session: OldSession },
    { EventStore: OldStore },
    { liveRequest: oldRequest },
    { validate: oldValidate },
  ] = await Promise.all([
    load("apps/cuelayer-v2/src/session.ts"),
    load("apps/cuelayer-v2/src/adapters/storage.ts"),
    load("apps/cuelayer-v2/server/live.ts"),
    load("apps/cuelayer-v2/src/acceptance.ts"),
  ]);
  const { rangeSize } = await import("../src/source.ts");
  const { Session } = await import("../src/session.ts"),
    { EventStore } = await import("../src/adapters/storage.ts"),
    { liveRequest } = await import("../server/live.ts");
  const old = await OldSession.open(
      "offline-old",
      async () => null,
      new OldStore(`offline-old-${crypto.randomUUID()}`),
    ),
    fresh = await Session.open(
      "offline-new",
      async () => null,
      new EventStore(`offline-new-${crypto.randomUUID()}`),
    );
  old.pause();
  fresh.pause();
  const fragments = [
    "this is your",
    "last",
    "lesson.",
    "Well,",
    "please",
    "turn",
    "the",
    "page.",
  ];
  for (const [i, text] of fragments.entries())
    for (const session of [old, fresh])
      await session.commitEvidence({
        id: `e${i}`,
        run: "authored",
        source: String(i),
        text,
        start: i * 0.3,
        end: (i + 1) * 0.3,
        receivedAt: performance.now(),
        audioObservedAt: null,
        stability: "COMMITTED",
      });
  const oldTask = old.capture("Live", old.replay.evidence.slice(0, 4), []),
    newTask = fresh.capture("Live");
  const proposal = {
    version: "v2-proposal-1",
    taskId: oldTask.id,
    complete: true,
    operations: [],
    dispositions: oldTask.evidence.map((e) => ({
      evidenceId: e.id,
      status: "unresolved",
    })),
    unresolved: oldTask.evidence.map((e) => ({
      evidenceId: e.id,
      phrase: e.text,
      coreId: null,
    })),
    resolve: [],
    attention: null,
  };
  await old.accept(oldTask, proposal);
  const stage = old.capture("Stage", old.replay.evidence.slice(0, 4), []);
  let contradiction;
  try {
    oldValidate(old.replay, stage, {
      ...proposal,
      taskId: stage.id,
      dispositions: [],
    });
  } catch (e) {
    contradiction = e.message;
  }
  const oldPayload = await oldRequest(oldTask),
    newPayload = await liveRequest(newTask.capture.request);
  const authored = JSON.parse(
    await readFile("tests/real/frontier-stories.json", "utf8"),
  );
  const payloadCases = [];
  for (const scenario of authored.cases) {
    const pair = [
      await OldSession.open(
        `old-${scenario.id}`,
        async () => null,
        new OldStore(`measure-${crypto.randomUUID()}`),
      ),
      await Session.open(
        `new-${scenario.id}`,
        async () => null,
        new EventStore(`measure-${crypto.randomUUID()}`),
      ),
    ];
    pair.forEach((s) => s.pause());
    for (const [i, text] of Array.from(
      { length: scenario.repeat ?? 1 },
      () => scenario.fragments,
    )
      .flat()
      .entries())
      for (const s of pair)
        await s.commitEvidence({
          id: `e${i}`,
          run: "authored",
          source: String(i),
          text,
          start: i,
          end: i + 1,
          receivedAt: performance.now(),
          audioObservedAt: null,
          stability: "COMMITTED",
        });
    const ot = pair[0].capture("Live", pair[0].replay.evidence.slice(0, 4), []),
      nt = pair[1].capture("Live");
    payloadCases.push({
      scenario: scenario.id,
      old: {
        providerBytes: Buffer.byteLength(JSON.stringify(await oldRequest(ot))),
        sourceChars: ot.evidence.reduce((n, e) => n + e.text.length, 0),
        finals: ot.evidence.length,
      },
      new: {
        providerBytes: Buffer.byteLength(
          JSON.stringify(await liveRequest(nt.capture.request)),
        ),
        projectionBytes: Buffer.byteLength(JSON.stringify(nt.capture.request)),
        sourceChars: rangeSize(pair[1].replay.evidence, nt.capture.range),
        finals: nt.evidence.length,
      },
    });
    pair.forEach((s) => s.close());
  }
  const result = {
    payloadCases,
    identity: "cuelayer-v2-frontier-baseline-regression-1",
    baselineSha: execFileSync("git", ["-C", baseline, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    source: fragments,
    old: {
      capturedFinals: oldTask.evidence.length,
      obligations: Object.keys(old.replay.unresolved).length,
      stageContradiction: contradiction,
      providerBytes: Buffer.byteLength(JSON.stringify(oldPayload)),
      taskBytes: Buffer.byteLength(JSON.stringify(oldTask)),
    },
    new: {
      capturedFinals: newTask.evidence.length,
      sourceChars: rangeSize(fresh.replay.evidence, newTask.capture.range),
      providerBytes: Buffer.byteLength(JSON.stringify(newPayload)),
      projectionBytes: Buffer.byteLength(
        JSON.stringify(newTask.capture.request),
      ),
    },
    limits:
      "Offline counterexample reproduces protocol mechanics, not paid semantic quality or latency.",
  };
  const out = resolve("../../.cuelayer/v2/frontier/offline-baseline.json");
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  old.close();
  fresh.close();
  process.exit(0);
}
if (!process.argv.includes("--live"))
  throw new Error("Use --offline-baseline or explicitly authorized --live.");
const corpus = JSON.parse(
  await readFile("tests/real/frontier-stories.json", "utf8"),
);
const ids = opt("cases", corpus.cases.map((c) => c.id).join(",")).split(",");
const tracks = opt("tracks", "OLD,NEW").split(",");
const urls = {
  OLD: opt("old-url", "http://127.0.0.1:5192"),
  NEW: opt("new-url", "http://127.0.0.1:5193"),
};
const out = resolve(
  "../../.cuelayer/v2/frontier",
  `paired-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of corpus.cases.filter((c) => ids.includes(c.id)))
    for (const track of tracks) {
      const page = await browser.newPage({
          viewport: { width: 1280, height: 800 },
          reducedMotion: "reduce",
        }),
        requests = [],
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.url().endsWith("/api/v2/live")) {
          const body = r.postData();
          requests.push({
            bytes: Buffer.byteLength(body ?? ""),
            body: JSON.parse(body ?? "null"),
          });
        }
      });
      await page.goto(
        `${urls[track]}/?services=real&session=frontier-${track}-${scenario.id}-${crypto.randomUUID()}`,
      );
      await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
      const config = await page.evaluate(() =>
        fetch("/api/v2/config").then((r) => r.json()),
      );
      if (!config.modelConfigured)
        throw new Error(`${track}:model-not-configured`);
      if (config.model !== "gpt-5.6-luna" || config.reasoning !== "low")
        throw new Error("comparison-profile-mismatch");
      const samples = [];
      const capture = () =>
        page.evaluate(() => {
          const s = window.v2.session,
            r = s.replay,
            w = s.window;
          const recorded = r.evidence.reduce((n, e) => n + e.text.length, 0);
          const accounted = r.accounted
            ? r.evidence
                .slice(0, Math.max(0, r.accounted.sequence - 1))
                .reduce((n, e) => n + e.text.length, 0) + r.accounted.offset
            : r.evidence
                .filter((e) => r.consumed[e.id])
                .reduce((n, e) => n + e.text.length, 0);
          return {
            at: performance.now(),
            recorded,
            accounted,
            gap: recorded - accounted,
            window: w,
            error: s.error,
          };
        });
      const begin = await page.evaluate(() => performance.now());
      for (let round = 0; round < (scenario.repeat ?? 1); round++)
        for (const fragment of scenario.fragments) {
          await page.evaluate((text) => window.v2.inject(text), fragment);
          samples.push(await capture());
          await page.waitForTimeout(scenario.intervalMs);
        }
      const speechEnd = await capture();
      samples.push(speechEnd);
      // Bounded observation permits WAIT: missing semantic output is never counted as zero latency.
      const deadline = Date.now() + 35000;
      while (Date.now() < deadline) {
        const sample = await capture();
        samples.push(sample);
        if (
          !sample.window.activeLive &&
          !sample.window.activeStage &&
          (sample.error ||
            sample.gap === 0 ||
            sample.window.repeatedWaitSuppressions > 0)
        )
          break;
        await page.waitForTimeout(500);
      }
      const beforeClose = await page.evaluate(() => ({
        ...window.v2.snapshot(),
        error: window.v2.session.error,
      }));
      // Matched explicit finalization only after continuous-input measurements are captured.
      let finalizationError = null;
      try {
        await page.evaluate(() => window.v2.session.finish());
      } catch (e) {
        finalizationError = String(e).slice(0, 250);
      }
      await page.waitForTimeout(200);
      const snapshot = await page.evaluate(async () => ({
        ...window.v2.snapshot(),
        events: await window.v2.session.store.read(window.v2.session.id),
        error: window.v2.session.error,
        dom: document.body.innerText,
      }));
      const row = {
        identity: corpus.identity,
        track,
        scenario,
        config,
        begin,
        speechEnd,
        samples,
        requests,
        errors,
        beforeClose,
        finalizationError,
        snapshot,
      };
      await page.screenshot({
        path: resolve(out, `${scenario.id}-${track}.png`),
      });
      await writeFile(
        resolve(out, `${scenario.id}-${track}.json`),
        JSON.stringify(row, null, 2),
      );
      results.push({
        scenario: scenario.id,
        track,
        atInputEnd: {
          recorded: speechEnd.recorded,
          accounted: speechEnd.accounted,
          gap: speechEnd.gap,
        },
        error: snapshot.error,
        finalizationError,
        units: Object.keys(snapshot.state.units).length,
        carry: Object.keys(snapshot.replay.unresolved).length,
        calls: requests.length,
      });
      console.log(JSON.stringify(results.at(-1)));
      await page.close();
    }
  await writeFile(
    resolve(out, "index.json"),
    JSON.stringify({ identity: corpus.identity, results }, null, 2),
  );
  console.log(`Local paired evidence: ${out}`);
} finally {
  await browser.close();
}
