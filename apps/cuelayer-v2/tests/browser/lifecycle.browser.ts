import { test, expect } from "./fixtures";

test("a value-dependent outside the Live capture disappears from the DOM immediately; corrected fields survive reload", async ({
  page,
}) => {
  await page.goto(`/?session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  const ids = await page.evaluate(async () => {
    const { admit, waitDecision, fixtureBasis, authoredPut } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    const { projectMeaning } = (await import(
      "/src/live-wire.ts" as string
    )) as typeof import("../../src/live-wire");
    const s = window.v2.session;
    s.pause();
    const text =
      "At constant temperature, pressure P is 200 kPa. Derived Q is 400 kPa.";
    await admit(s, text);
    let t = s.capture("Live"),
      r = t.capture!.request,
      b = fixtureBasis(t, text),
      c = r.newCores[0];
    await s.accept(t, {
      ...waitDecision(t),
      suffixStatus: "NONE",
      groups: [
        {
          outcome: "APPLY",
          throughBoundary: r.source.end,
          resolutions: [],
          operations: [
            { type: "core", id: c, label: "Pressure", basis: b },
            { type: "mainline", coreId: c, basis: b },
            ...["P", "Q"].map((symbol, i) =>
              authoredPut({
                type: "put",
                id: r.newUnits[i],
                coreId: c,
                meaning: projectMeaning(
                  {
                    kind: "quantity",
                    expression: ["Equal", symbol, i ? 400 : 200],
                    symbols: {
                      [symbol]: {
                        label: i ? "derived flow" : "pressure",
                        unit: "kPa",
                      },
                    },
                    conditions: ["at constant temperature"],
                  },
                  (x) => x,
                ),
                dependencies: i
                  ? [{ target: r.newUnits[0], kind: "VALUE" }]
                  : [],
                basis: b,
              }),
            ),
          ],
        },
      ],
    });
    const [p, q] = Object.keys(s.state.units);
    for (let n = 0; n < 10; n++) {
      const text = `Independent concept ${n}.`;
      await admit(s, text);
      t = s.capture("Live");
      r = t.capture!.request;
      await s.accept(t, {
        ...waitDecision(t),
        suffixStatus: "NONE",
        groups: [
          {
            outcome: "APPLY",
            throughBoundary: r.source.end,
            resolutions: [],
            operations: [
              {
                type: "put",
                id: r.newUnits[0],
                coreId: r.currentCore!,
                meaning: { kind: "statement", text },
                dependencies: [],
                basis: fixtureBasis(t, text),
              },
            ],
          },
        ],
      });
    }
    return { p, q };
  });
  await expect
    .poll(() =>
      page.evaluate(
        (q) =>
          window.v2.handle
            .editor!.getCurrentPageShapes()
            .some((s) => s.type === "knowledge" && s.props.unitId === q),
        ids.q,
      ),
    )
    .toBe(true);
  await page.evaluate((q) => {
    const e = window.v2.handle.editor!,
      shape = e
        .getCurrentPageShapes()
        .find((s) => s.type === "knowledge" && s.props.unitId === q)!;
    e.zoomToBounds(e.getShapePageBounds(shape)!, {
      animation: { duration: 0 },
    });
  }, ids.q);
  await expect(page.locator(`[data-unit="${ids.q}"]`)).toBeVisible();
  const result = await page.evaluate(async ({ p, q }) => {
    const { admit, waitDecision, fixtureBasis } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    const { projectExpression } = (await import(
      "/src/live-wire.ts" as string
    )) as typeof import("../../src/live-wire");
    const s = window.v2.session,
      text = "Correction: pressure increases to 250.";
    await admit(s, text);
    let t = s.capture("Live");
    await s.accept(t, {
      ...waitDecision(t),
      contextRequest: { query: "pressure", purpose: "MODIFY", after: null },
    });
    t = s.capture("Live");
    const outside = !t.state.units[q],
      alias = Object.keys(t.capture!.units).find(
        (a) => t.capture!.units[a] === p,
      )!;
    await s.accept(t, {
      ...waitDecision(t),
      suffixStatus: "NONE",
      groups: [
        {
          outcome: "APPLY",
          throughBoundary: t.capture!.request.source.end,
          resolutions: [],
          operations: [
            {
              type: "revise",
              id: alias,
              change: {
                field: "expression",
                value: projectExpression(["Equal", "P", 250]),
              },
              basis: fixtureBasis(t, text),
            },
          ],
        },
      ],
    });
    return {
      outside,
      review: s.state.units[q].reviewRequired,
      meaning: s.state.units[p].meaning,
    };
  }, ids);
  expect(result.outside).toBe(true);
  expect(result.review).toBe(true);
  await expect(page.locator(`[data-unit="${ids.q}"]`)).toHaveCount(0);
  const p = page.locator(`[data-unit="${ids.p}"]`);
  await expect(p).toBeVisible();
  await expect(p).toHaveAttribute("data-version", "2");
  await expect(p).toContainText("250");
  await expect(p).toContainText("kPa");
  await expect(p).toContainText("constant temperature");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  await expect(p).toBeVisible();
  await expect(p).toHaveAttribute("data-version", "2");
  await expect(p).toContainText("250");
  await expect(p).toContainText("constant temperature");
  await expect(page.locator(`[data-unit="${ids.q}"]`)).toHaveCount(0);
});

test("a wrapped teaching invitation reserves its full height above teacher text", async ({
  page,
}) => {
  let providerCalls = 0;
  await page.route("**/api/v2/live", (route) => {
    providerCalls++;
    return route.abort();
  });
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  const invitation =
    "Compare how the partial pressures of two components change when their mole fractions stay fixed but total pressure doubles. Discuss with a partner.";
  await page.evaluate(async (invitation) => {
    const { admit, establish } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    const s = window.v2.session;
    s.pause();
    const text = `Pressure is 200 kPa. ${invitation}`;
    await admit(s, text);
    const task = s.capture("Live"),
      decision = establish(task, text);
    const put = decision.groups[0].operations.find(
      (operation) => operation.type === "put",
    )!;
    decision.groups[0].operations.push({
      type: "cue",
      value: { text: invitation, targets: [put.id] },
      basis: put.basis,
    });
    await s.accept(task, decision);
  }, invitation);
  const cue = page.getByTestId("teaching-cue");
  await expect(cue).toContainText(invitation);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const cue = document
            .querySelector(".teaching-cue")!
            .getBoundingClientRect();
          const region = document
            .querySelector(".cue-region")!
            .getBoundingClientRect();
          const composer = document
            .querySelector(".text-entry")!
            .getBoundingClientRect();
          return (
            cue.bottom <= region.bottom + 1 &&
            region.bottom <= composer.top + 1 &&
            cue.bottom <= composer.top + 1
          );
        }),
      )
      .toBe(true);
    await expect(cue).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("textbox", { name: "Teacher text" }),
    ).toBeInViewport();
  }
  expect(providerCalls).toBe(0);
});

test("Cue displays independently of attention, survives raw source, and never revives after correction or refresh", async ({
  page,
}) => {
  await page.goto(`/?session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  await page.evaluate(async () => {
    const { admit, establish } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    const s = window.v2.session;
    s.pause();
    const text = "Pressure is 200 kPa. Compare the pressure.";
    await admit(s, text);
    const t = s.capture("Live"),
      d = establish(t, text);
    d.attentionCandidate = null;
    const p = d.groups[0].operations.find((o) => o.type === "put")!;
    d.groups[0].operations.push({
      type: "cue",
      value: { text: "Compare the pressure.", targets: [p.id] },
      basis: p.basis,
    });
    await s.accept(t, d);
  });
  const cue = page.getByText("Compare the pressure.", { exact: true });
  await expect(cue).toBeVisible();
  await page.evaluate(async () => {
    const { admit } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    await admit(window.v2.session, "Please continue.");
  });
  await expect(cue).toBeVisible();
  await page.evaluate(async () => {
    const { fullGroup, admit, establish } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    const s = window.v2.session;
    let t = s.capture("Live");
    await s.accept(t, fullGroup(t));
    const text = "Correction: pressure is 250 kPa.";
    await admit(s, text);
    t = s.capture("Live");
    await s.accept(t, establish(t, text));
  });
  await expect(cue).toHaveCount(0);
  await page.evaluate(async () => {
    const { admit, waitDecision, fixtureBasis } = (await import(
      "/tests/frontier-fixtures.ts" as string
    )) as typeof import("../frontier-fixtures");
    const s = window.v2.session,
      text = "Compare the corrected pressure.";
    await admit(s, text);
    const t = s.capture("Live");
    await s.accept(t, {
      ...waitDecision(t),
      suffixStatus: "NONE",
      groups: [
        {
          outcome: "APPLY",
          throughBoundary: t.capture!.request.source.end,
          resolutions: [],
          operations: [
            {
              type: "cue",
              value: { text, targets: [t.capture!.request.units[0].id] },
              basis: fixtureBasis(t, text),
            },
          ],
        },
      ],
    });
  });
  await expect(
    page.getByText("Compare the corrected pressure.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  await expect(
    page.getByText("Compare the corrected pressure.", { exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.v2.session.state.cue?.text)).toBe(
    "Compare the corrected pressure.",
  );
});
