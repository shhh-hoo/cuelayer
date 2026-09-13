import { test, expect } from "./fixtures";
import type { WebSocketRoute } from "@playwright/test";
import type { LiveRequest } from "../../src/projection";
import {
  projectMeaning,
  type LiveDecision,
  type WireOperation,
} from "../../src/live-wire";

test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});
const text =
  "Partial pressure is mole fraction times total pressure for an ideal gas mixture; pressures are in kPa and mole fraction is dimensionless.";
async function proposed(task: LiveRequest): Promise<LiveDecision> {
  const basis = [
    {
      source: task.source.source,
      start: task.source.start,
      end: task.source.end,
    },
  ];
  const operations: WireOperation[] = task.units.length
    ? []
    : [
        { type: "core", id: task.newCores[0], label: "Gas mixture", basis },
        {
          type: "put",
          id: task.newUnits[0],
          coreId: task.newCores[0],
          basis,
          dependencies: [],
          meaning: projectMeaning(
            {
              kind: "quantity",
              expression: ["Equal", "p_i", ["Multiply", "x_i", "P_total"]],
              symbols: {
                p_i: { label: "partial pressure", unit: "kPa" },
                x_i: { label: "mole fraction", unit: "1" },
                P_total: { label: "total pressure", unit: "kPa" },
              },
              conditions: ["ideal gas mixture"],
            },
            (x) => x,
          ),
        },
        { type: "mainline", coreId: task.newCores[0], basis },
      ];
  return {
    scope: task.scope,
    groups: [
      operations.length
        ? {
            throughBoundary: task.source.end,
            outcome: "APPLY",
            operations,
            resolutions: [],
          }
        : { throughBoundary: task.source.end, outcome: "NO_CHANGE" },
    ],
    suffixStatus: "NONE",
    contextRequest: null,
    reviewRequests: [],
    attentionCandidate: operations.length
      ? { targets: [task.newUnits[0]], mode: "FOCUS" }
      : null,
  };
}
function stream(raw: unknown) {
  return [
    { type: "response.output_text.delta", delta: JSON.stringify(raw) },
    {
      type: "response.completed",
      response: { status: "completed", model: "mock", id: "mock", usage: null },
    },
  ]
    .map((e) => JSON.stringify(e) + "\n")
    .join("");
}

test("teacher text is admitted while inference is pending, then reaches the learner DOM and survives reload (mock model)", async ({
  page,
}) => {
  let releaseModel!: () => void;
  const modelPending = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  const tasks: LiveRequest[] = [];
  let speechCalls = 0;
  await page.route("**/api/v2/speech-token", (route) => {
    speechCalls++;
    return route.abort();
  });
  await page.route("**/api/v2/live", async (route) => {
    const task = route.request().postDataJSON() as LiveRequest;
    tasks.push(task);
    if (tasks.length === 1) await modelPending;
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: stream(await proposed(task)),
    });
  });
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  const input = page.getByRole("textbox", { name: "Teacher text" });
  const submit = page.getByRole("button", { name: "Add to lesson" });
  try {
    await expect(submit).toBeDisabled();
    await input.fill("   ");
    await expect(submit).toBeDisabled();
    await input.fill(text);
    await submit.click();
    await expect(input).toHaveValue("");
    await expect.poll(() => tasks.length).toBe(1);
    expect(await page.evaluate(() => window.v2.session.state.revision)).toBe(0);
    await input.fill("The same relationship still holds.");
    await submit.click();
    await expect(input).toHaveValue("");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.v2.session.replay.evidence.map((e) => e.text),
        ),
      )
      .toEqual([text, "The same relationship still holds."]);
  } finally {
    releaseModel();
  }
  await expect(page.locator("[data-unit] .katex").first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.v2.session.window.consumedEvidenceIds.length),
    )
    .toBe(2);
  const state = await page.evaluate(() => window.v2.session.state);
  await page.screenshot({
    path: "../../.cuelayer/v2/teacher-text-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeInViewport();
  await expect(submit).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("[data-unit] .katex").first()).toBeInViewport();
  await page.screenshot({ path: "../../.cuelayer/v2/teacher-text-narrow.png" });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.v2));
  expect(await page.evaluate(() => window.v2.session.state)).toEqual(state);
  await expect(page.locator("[data-unit] .katex").first()).toBeVisible();
  await expect(page.locator("[data-unit] .katex").first()).toBeInViewport();
  expect(speechCalls).toBe(0);
});

test("teacher text keeps an unadmitted passage and respects saved lesson boundaries", async ({
  page,
}) => {
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  const input = page.getByRole("textbox", { name: "Teacher text" });
  const submit = page.getByRole("button", { name: "Add to lesson" });
  await page.waitForFunction(() => Boolean(window.v2));
  await page.evaluate(() => {
    window.v2.inject = async () => {
      throw new Error("test-admission-rejected");
    };
  });
  await input.fill(text);
  await submit.click();
  await expect(page.getByRole("alert")).toContainText(
    "Your text is still here",
  );
  await expect(input).toHaveValue(text);
  expect(await page.evaluate(() => window.v2.session.replay.evidence)).toEqual(
    [],
  );
  await page.evaluate(() => {
    Object.defineProperty(window.v2.session, "readOnly", {
      value: true,
      configurable: true,
    });
    window.v2.refresh();
  });
  await expect(input).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("read-only");
  await page.evaluate(() => {
    Object.defineProperty(window.v2.session, "readOnly", { value: false });
    (window.v2.session as any).value.captureClosed = true;
    window.v2.refresh();
  });
  await expect(input).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("lesson has ended");
});

test("real route: official microphone/ASR adapters, concurrent finals, complete model proposal, visible DOM and reload (mock services)", async ({
  page,
}) => {
  let socket: WebSocketRoute | undefined,
    audioChunks = 0,
    forceCalls = 0;
  const tasks: LiveRequest[] = [];
  await page.route("**/api/v2/speech-token", (r) =>
    r.fulfill({ json: { token: "offline-test" } }),
  );
  await page.routeWebSocket(/speechmatics\.com/, (ws) => {
    socket = ws;
    ws.onMessage((message) => {
      if (typeof message !== "string") {
        audioChunks++;
        return;
      }
      const data = JSON.parse(message);
      if (data.message === "StartRecognition")
        ws.send(
          JSON.stringify({ message: "RecognitionStarted", id: "mock-run" }),
        );
      if (data.message === "EndOfStream")
        ws.send(JSON.stringify({ message: "EndOfTranscript" }));
      if (data.message === "ForceEndOfUtterance") forceCalls++;
    });
  });
  await page.route("**/api/v2/live", async (r) => {
    const task = r.request().postDataJSON() as LiveRequest;
    tasks.push(task);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await r.fulfill({
      contentType: "application/x-ndjson",
      body: stream(await proposed(task)),
    });
  });
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await expect.poll(() => audioChunks).toBeGreaterThan(20);
  const send = (
    message: string,
    start: number,
    end: number,
    transcript = text,
  ) =>
    socket!.send(
      JSON.stringify({
        message,
        metadata: { start_time: start, end_time: end, transcript },
      }),
    );
  send("AddPartialTranscript", 0, 0.02, "uncommitted partial");
  await expect
    .poll(() => page.evaluate(() => window.v2.session.replay.evidence.length))
    .toBe(0);
  send("AddTranscript", 0, 0.04);
  await expect.poll(() => tasks.length).toBe(1);
  send("AddTranscript", 0.04, 0.08, "The same relationship still holds.");
  send("AddTranscript", 0.08, 0.12, "That relationship continues to hold.");
  await expect
    .poll(() => page.evaluate(() => window.v2.session.replay.evidence.length))
    .toBe(3);
  await expect
    .poll(() =>
      page.evaluate(() => window.v2.session.window.consumedEvidenceIds.length),
    )
    .toBe(3);
  await expect(page.locator("[data-unit] .katex").first()).toBeVisible();
  const snapshot = await page.evaluate(() => window.v2.snapshot());
  expect(tasks).toHaveLength(2);
  expect(tasks[1].source.text).toContain("relationship");
  expect(tasks[1]).not.toHaveProperty("dependencies");
  expect(
    snapshot.spans.some(
      (s) => s.name === "learner-visible-dom" && s.attributes.complete,
    ),
  ).toBe(true);
  expect(snapshot.spans.some((s) => s.name === "audio-to-final")).toBe(true);
  expect(forceCalls).toBe(0);
  await page.getByRole("button", { name: "Stop microphone" }).click();
  await expect
    .poll(() => page.evaluate(() => window.v2.mic.status))
    .toBe("stopped");
  // Reproduce a worklet callback queued before stop and delivered after provider close.
  await page.evaluate(() => {
    const recorder = (window.v2.mic as any).recorder;
    recorder.dispatchTypedEvent(
      "audio",
      Object.assign(new Event("audio"), { data: new Float32Array(128) }),
    );
  });
  expect(
    await page.evaluate(() => ({
      status: window.v2.mic.status,
      error: window.v2.mic.error,
    })),
  ).toEqual({ status: "stopped", error: null });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.v2));
  expect(await page.evaluate(() => window.v2.session.state)).toEqual(
    snapshot.state,
  );
  expect(
    await page.evaluate(
      () => window.v2.session.window.consumedEvidenceIds.length,
    ),
  ).toBe(3);
  await expect(page.locator("[data-unit] .katex").first()).toBeVisible();
});

test("real adapter's schema-valid fabricated grounding never reaches accepted state or DOM", async ({
  page,
}) => {
  await page.route("**/api/v2/live", async (r) => {
    const p = await proposed(r.request().postDataJSON());
    if (p.groups[0].outcome !== "APPLY")
      throw new Error("fixture-expected-apply");
    p.groups[0].operations[0].basis[0].end = "bUNISSUED";
    await r.fulfill({ contentType: "application/x-ndjson", body: stream(p) });
  });
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2));
  await page.evaluate((text) => window.v2.inject(text), text);
  await expect(page.getByRole("alert")).toContainText(
    "unknown-or-cross-task-source-alias",
  );
  expect(await page.evaluate(() => window.v2.session.state.revision)).toBe(0);
  expect(
    await page.evaluate(() => window.v2.session.window.consumedEvidenceIds),
  ).toEqual([]);
  await expect(page.locator("[data-unit]")).toHaveCount(0);
});

test("Teaching Representation: new relationship is dominant, required earlier equation remains, correction preserves the artifact (mock model)", async ({
  page,
}) => {
  await page.route("**/api/v2/live", async (r) => {
    const task: LiveRequest = r.request().postDataJSON(),
      p = await proposed(task);
    const prior = [...task.units].sort(
      (a, b) =>
        Number(
          b.meaning.kind === "quantity" &&
            b.meaning.symbols.some((s) => s.symbol === "p_i"),
        ) -
        Number(
          a.meaning.kind === "quantity" &&
            a.meaning.symbols.some((s) => s.symbol === "p_i"),
        ),
    );
    if (prior.length) {
      const basis = [
        {
          source: task.source.source,
          start: task.source.start,
          end: task.source.end,
        },
      ];
      const id = prior.length === 1 ? task.newUnits[0] : prior[1].id;
      const operations: WireOperation[] = [
        {
          type: "put",
          id,
          coreId: prior[0].core,
          basis,
          dependencies: [{ target: prior[0].id, kind: "IDENTITY" }],
          meaning: projectMeaning(
            {
              kind: "quantity",
              expression: ["Equal", "x_i", ["Divide", "n_i", "n_total"]],
              symbols: {
                x_i: { label: "mole fraction", unit: "1" },
                n_i: {
                  label: "amount of this gas",
                  unit: prior.length === 1 ? "mol" : "mmol",
                },
                n_total: {
                  label: "total amount of gas",
                  unit: prior.length === 1 ? "mol" : "mmol",
                },
              },
              conditions: [],
            },
            (x) => x,
          ),
        },
      ];
      if (prior.length > 1) {
        const put = operations[0];
        if (put.type !== "put" || put.meaning.kind !== "quantity")
          throw new Error("fixture-quantity");
        operations[0] = {
          type: "revise",
          id,
          change: { field: "symbols", value: put.meaning.symbols },
          basis,
        };
      }
      p.groups[0] = {
        outcome: "APPLY",
        throughBoundary: task.source.end,
        operations,
        resolutions: [],
      };
      p.attentionCandidate = { mode: "FOCUS", targets: [id] };
    }
    await r.fulfill({ contentType: "application/x-ndjson", body: stream(p) });
  });
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  for (const words of [
    text,
    "Mole fraction is amount of this gas divided by total amount of gas, both in mol.",
  ]) {
    await page.evaluate((words) => window.v2.inject(words), words);
    await page.evaluate(() => window.v2.session.drainLive());
  }
  const ids = await page.evaluate(() =>
    Object.keys(window.v2.session.state.units),
  );
  const earlier = page.locator(`[data-unit="${ids[0]}"]`),
    current = page.locator(`[data-unit="${ids[1]}"]`);
  await expect(current).toHaveAttribute("data-role", "primary");
  await expect(earlier).toHaveAttribute("data-role", "context");
  await expect(page.locator(".knowledge.selected .katex")).toHaveCount(2);
  await expect(earlier.locator(".conditions")).toHaveText("ideal gas mixture");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.v2
          .snapshot()
          .spans.some(
            (s) =>
              s.name === "learner-visible-dom" &&
              Array.isArray(s.attributes.targets) &&
              s.attributes.targets.length === 2,
          ),
      ),
    )
    .toBe(true);
  const originalNode = await current.elementHandle();
  await page.evaluate(() =>
    window.v2.inject(
      "Correction: express both amounts in mmol; the mole fraction relationship is unchanged.",
    ),
  );
  await page.evaluate(() => window.v2.session.drainLive());
  await expect(current).toHaveAttribute("data-version", "2");
  expect(
    await current.evaluate((node, old) => node === old, originalNode),
  ).toBe(true);
  expect(
    await page.evaluate(() => Object.keys(window.v2.session.state.units)),
  ).toEqual(ids);
  await expect(current.locator("dd")).toContainText([
    "mole fraction",
    "mmol",
    "mmol",
  ]);
  await page.screenshot({
    path: "../../.cuelayer/v2/representation-continuity.png",
  });
});
