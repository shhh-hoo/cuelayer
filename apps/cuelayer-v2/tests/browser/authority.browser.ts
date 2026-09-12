import { test, expect, fixtureUnit } from "./fixtures";
test("durable frontier, partial safety and screenshot stability through no-change", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  await page.evaluate(async () => {
    const s = window.v2.session;
    await s.speech.receive({
      message: "AddPartialTranscript",
      metadata: {
        transcript: "Unaccepted speculation",
        start_time: 0,
        end_time: 1,
      },
    });
    s.speech.preflight();
  });
  expect(await page.evaluate(() => window.v2.session.state.revision)).toBe(0);
  await expect(page.getByText("Unaccepted speculation")).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const s = window.v2.session,
      append = s.store.append.bind(s.store);
    let fail = true;
    s.store.append = async (event, expected) => {
      if (fail && event.type === "evidence")
        throw new Error("injected-disk-failure");
      await append(event, expected);
    };
    const final = (text: string, i: number) =>
      s.speech.receive({
        message: "AddTranscript",
        metadata: { transcript: text, start_time: i, end_time: i + 1 },
      });
    const failures = [];
    for (const [text, i] of [
      [window.v2.story[0], 0],
      [window.v2.story[2], 2],
    ] as const)
      try {
        await final(text, i);
      } catch (e) {
        failures.push(String(e));
      }
    const blocked = s.window.orderedCommittedEvidence.length;
    fail = false;
    await final(window.v2.story[0], 0);
    await s.drainLive();
    await final(window.v2.story[2], 2);
    await s.drainLive();
    return { failures, blocked, consumed: s.window.consumedEvidenceIds.length };
  });
  expect(result.blocked).toBe(0);
  expect(result.failures[1]).toContain("frontier-blocked");
  expect(result.consumed).toBe(2);
  await expect(
    (await fixtureUnit(page, "pressure")).locator(".katex"),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await page
    .getByTestId("board")
    .screenshot({ animations: "disabled" });
  await page.evaluate(async () => {
    await window.v2.session.speech.receive({
      message: "AddTranscript",
      metadata: { transcript: "Continue.", start_time: 4, end_time: 5 },
    });
    await window.v2.session.drainLive();
  });
  const after = await page
    .getByTestId("board")
    .screenshot({ animations: "disabled" });
  expect(after.equals(before)).toBe(true);
  expect(errors).toEqual([]);
});
test("motion allowed: drag interrupts camera and latest Follow Teaching recovers", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/?session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  for (const i of [0, 2]) await page.evaluate((i) => window.v2.step(i), i);
  const box = await page.getByTestId("board").boundingBox();
  await page.mouse.move(box!.x + 80, box!.y + 80);
  await page.mouse.down();
  await page.mouse.move(box!.x + 200, box!.y + 170, { steps: 5 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Follow Teaching" }),
  ).toBeVisible();
  const commands = await page.evaluate(
    () =>
      window.v2.session.trace.spans.filter((s) => s.name === "camera-command")
        .length,
  );
  await page.evaluate(() => window.v2.step(7));
  expect(
    await page.evaluate(
      () =>
        window.v2.session.trace.spans.filter((s) => s.name === "camera-command")
          .length,
    ),
  ).toEqual(commands);
  await page.getByRole("button", { name: "Follow Teaching" }).click();
  await expect(
    (await fixtureUnit(page, "ammonia")).locator(".katex"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.v2.session.state.cores[window.v2.session.state.currentCoreId!]
          .label,
    ),
  ).toBe("Chemical equilibrium");
});
