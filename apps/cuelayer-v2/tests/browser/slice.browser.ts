import { writeFile } from "node:fs/promises";
import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
const open = async (page: Page, query = "") => {
  await page.goto(`/?session=${crypto.randomUUID()}${query}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
};
const step = async (page: Page, i: number) =>
  page.evaluate((i) => window.v2.step(i), i);
async function readable(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const safe = document
          .querySelector('[data-testid="board"]')!
          .getBoundingClientRect();
        return window.v2.handle.frame!.targets.every((id) => {
          const el = document.querySelector(`[data-unit="${id}"]`),
            r = el?.getBoundingClientRect();
          return (
            r &&
            r.left >= safe.left - 1 &&
            r.right <= safe.right + 1 &&
            r.top >= safe.top - 1 &&
            r.bottom <= safe.bottom + 1 &&
            r.width >= 300
          );
        });
      }),
    )
    .toBe(true);
  await expect(page.locator(".degraded")).toHaveCount(0);
}
test("deterministic complete teaching story; independent delayed Stage", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await open(page);
  await page.getByRole("button", { name: "Run teaching story" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.v2.session.window.consumedEvidenceIds.length),
    )
    .toBe(11);
  await expect(page.locator('[data-unit="sine"] [data-plot]')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window.v2.session.state.units["fraction-share"]),
      ),
    )
    .toBe(true);
  await readable(page);
  expect(
    await page.evaluate(
      () => Object.keys(window.v2.session.replay.unresolved).length,
    ),
  ).toBe(1);
  expect(await page.evaluate(() => window.v2.session.state.currentCoreId)).toBe(
    "functions",
  );
  expect(
    await page.evaluate(() =>
      window.v2.session.trace.spans.some(
        (s) =>
          s.name === "attention-discarded" && s.attributes.lane === "Stage",
      ),
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../.cuelayer/v2/story.png" });
  const measurement = await page.evaluate(() => {
    const spans = window.v2.session.trace.spans;
    const metrics = Object.fromEntries(
      [...new Set(spans.map((s) => s.name))].map((name) => {
        const values = spans
          .filter((s) => s.name === name)
          .map((s) => s.end - s.start)
          .sort((a, b) => a - b);
        return [
          name,
          {
            count: values.length,
            p50: values[Math.floor(values.length * 0.5)],
            p95: values[
              Math.min(values.length - 1, Math.floor(values.length * 0.95))
            ],
          },
        ];
      }),
    );
    const accepted = spans.filter((s) => s.name === "semantic-accepted");
    const e2e = accepted.flatMap((a) => {
      if (
        !a.attributes.changed ||
        spans.some(
          (s) =>
            s.name === "attention-discarded" &&
            s.attributes.taskId === a.attributes.taskId,
        )
      )
        return [];
      const work = spans.find(
        (s) =>
          s.name === "work-created" &&
          s.attributes.taskId === a.attributes.taskId,
      );
      const visible = spans.find(
        (s) =>
          s.name === "learner-visible-dom" &&
          s.attributes.revision === a.attributes.revision &&
          s.end >= a.end,
      );
      if (!work || !visible || !Array.isArray(work.attributes.evidenceIds))
        return [];
      const evidence = window.v2.session.replay.evidence.filter((e) =>
        (work.attributes.evidenceIds as string[]).includes(e.id),
      );
      return [
        {
          lane: a.attributes.lane,
          revision: a.attributes.revision,
          finalToVisibleMs:
            visible.end - Math.max(...evidence.map((e) => e.receivedAt)),
        },
      ];
    });
    return {
      mode: "deterministic-fixture",
      clock: "browser performance.now",
      audioTiming: "synthetic observation only",
      modelCost: null,
      speculativeWorkStarted: 0,
      speculativeWorkDiscarded: 0,
      metrics,
      e2e,
      spans,
      pending: window.v2.session.window,
    };
  });
  await writeFile(
    "../../.cuelayer/v2/measurements.json",
    JSON.stringify(measurement, null, 2),
  );
  expect(errors).toEqual([]);
});
for (const [name, query, viewport] of [
  ["desktop", "", { width: 1280, height: 800 }],
  ["overlay", "&mode=overlay", { width: 1280, height: 800 }],
  ["narrow", "", { width: 390, height: 844 }],
  ["narrow-overlay", "&mode=overlay", { width: 390, height: 844 }],
] as const) {
  test(`${name}: FOCUS, COMPARE, safe Cue, inspection and Follow Teaching`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, query);
    for (const i of [0, 2, 3, 4]) await step(page, i);
    await expect(page.locator('[data-unit="pressure"] .katex')).toBeVisible();
    await expect(page.locator('[data-unit="fraction"] .katex')).toBeVisible();
    await readable(page);
    await expect(page.getByTestId("teaching-cue")).toBeVisible();
    const safe = await page.getByTestId("board").boundingBox(),
      cue = await page.getByTestId("teaching-cue").boundingBox();
    expect(cue!.y).toBeGreaterThanOrEqual(safe!.y + safe!.height);
    expect(cue!.x).toBeGreaterThanOrEqual(0);
    expect(cue!.x + cue!.width).toBeLessThanOrEqual(viewport.width);
    const before = await page.evaluate(() => window.v2.session.state);
    const board = page.getByTestId("board");
    await board.hover();
    await page.mouse.wheel(0, -120);
    await expect(
      page.getByRole("button", { name: "Follow Teaching" }),
    ).toBeVisible();
    const inspected = await page.evaluate(() => window.v2.session.state);
    expect(inspected).toEqual(before);
    await step(page, 7);
    expect(await page.evaluate(() => window.v2.handle.inspection)).toBe(true);
    await page.getByRole("button", { name: "Follow Teaching" }).click();
    await expect(page.locator('[data-unit="ammonia"] .katex')).toBeVisible();
    await readable(page);
    await step(page, 8);
    await readable(page);
    // Returning to a Core preserves Cue history without reissuing its expired invitation.
    await expect(page.getByTestId("teaching-cue")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.v2.session.state.cue),
    ).not.toBeNull();
    await page.screenshot({ path: `../../.cuelayer/v2/${name}.png` });
  });
}
test("continuous arrival overlaps Live; stale Stage rejected; reload preserves obligations", async ({
  page,
}) => {
  await open(page, "&live=180&stage=800");
  for (const i of [0, 1, 2, 3, 5, 6]) await step(page, i);
  await page.waitForFunction(() =>
    Boolean(window.v2.session.window.activeStage),
  );
  await step(page, 9);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.v2.session.trace.spans.some(
          (s) =>
            s.name === "proposal-rejected" &&
            String(s.attributes.reason).startsWith("stale-dependency"),
        ),
      ),
    )
    .toBe(true);
  const result = await page.evaluate(async () => {
    const ages: number[] = [];
    let overlap = false,
      maxAge = 0,
      progressDuringArrival = false;
    for (let i = 0; i < 240; i++) {
      await window.v2.inject("Continue the explanation.");
      overlap ||= Boolean(window.v2.session.window.activeLive);
      ages.push(window.v2.session.window.oldestPendingAge);
      maxAge = Math.max(maxAge, window.v2.session.window.oldestPendingAge);
      progressDuringArrival ||=
        window.v2.session.window.consumedEvidenceIds.length > 10;
      await new Promise((r) => setTimeout(r, 45));
    }
    const accountedBeforeStop =
      window.v2.session.window.consumedEvidenceIds.length;
    const recordedBeforeStop =
      window.v2.session.window.orderedCommittedEvidence.length;
    await window.v2.session.drainLive();
    return {
      accountedBeforeStop,
      recordedBeforeStop,
      ages,
      overlap,
      maxAge,
      progressDuringArrival,
      count: window.v2.session.window.livePendingCount,
    };
  });
  await writeFile(
    "../../.cuelayer/v2/throughput.json",
    JSON.stringify(result, null, 2),
  );
  expect(result.overlap).toBe(true);
  expect(result.progressDuringArrival).toBe(true);
  expect(result.maxAge).toBeLessThan(1000);
  expect(result.count).toBe(0);
  expect(
    result.recordedBeforeStop - result.accountedBeforeStop,
  ).toBeLessThanOrEqual(12);
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  expect(median(result.ages.slice(-40))).toBeLessThanOrEqual(
    median(result.ages.slice(40, 80)) + 100,
  );
  const before = await page.evaluate(() => ({
    state: window.v2.session.state,
    consumed: window.v2.session.window.consumedEvidenceIds,
    unresolved: window.v2.session.replay.unresolved,
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  const after = await page.evaluate(() => ({
    state: window.v2.session.state,
    consumed: window.v2.session.window.consumedEvidenceIds,
    unresolved: window.v2.session.replay.unresolved,
  }));
  expect(after).toEqual(before);
  expect(await page.evaluate(() => window.v2.session.attention)).toBeNull();
});
test("representation failure and growth preserve semantic identity", async ({
  page,
}) => {
  await open(page);
  for (const i of [0, 2, 3, 4]) await step(page, i);
  const before = await page.evaluate(() => ({
    state: window.v2.session.state,
    homes: [...window.v2.handle.geography.homes],
  }));
  await page.evaluate(() => window.v2.failRepresentation(true));
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(await page.evaluate(() => window.v2.session.state)).toEqual(
    before.state,
  );
  await page.evaluate(() => window.v2.failRepresentation(false));
  await expect(page.locator('[data-unit="fraction"] .katex')).toBeVisible();
  for (const i of [7, 8, 10]) await step(page, i);
  const after = await page.evaluate(() => [
    ...window.v2.handle.geography.homes,
  ]);
  expect(after.length).toBeGreaterThan(before.homes.length);
  expect(after.slice(0, before.homes.length)).toEqual(before.homes);
});
