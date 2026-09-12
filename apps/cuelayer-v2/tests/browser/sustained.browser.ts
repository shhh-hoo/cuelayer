import { test, expect } from "./fixtures";
import { workload, workloadProfile as profile } from "../workload-fixture";
import { mkdir, writeFile } from "node:fs/promises";

test("600 virtual seconds: fixed artificial service latency, semantic versions and visible Cue deadlines in the actual browser", async ({
  page,
}) => {
  test.setTimeout(300000);
  const wall = performance.now();
  // This route uses the real adapter but every semantic response below is an in-browser offline mock.
  await page.route(/api\.openai\.com|speechmatics\.com|\/api\/v2\/live$/, (r) =>
    r.abort(),
  );
  await page.addInitScript(() => {
    const native = window.fetch.bind(window);
    window.fetch = (input, init) =>
      String(input).endsWith("/api/v2/live")
        ? (window as any).__offlineLive(input, init)
        : native(input, init);
  });
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  await page.evaluate(async () => {
    const path = "/tests/workload-interpreter.ts",
      { interpretWorkload } = await import(path);
    const start = performance.now();
    let live = 0,
      stage = 0;
    const accepted = new Map<string, { at: number; version: number }>(),
      visible = new Map<
        string,
        { at: number; version: number; text: string; equation?: string }
      >();
    const sample = () => {
      const cue = document.querySelector<HTMLElement>(
          '[data-testid="teaching-cue"]',
        ),
        text = cue?.querySelector("p")?.textContent;
      if (cue && text) {
        const rect = cue.getBoundingClientRect();
        const style = getComputedStyle(cue);
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          !visible.has(text)
        )
          visible.set(text, {
            at: performance.now() - start,
            version: Number(cue.dataset.cueVersion),
            text: cue.innerText,
          });
      }
      const unit = Object.values(window.v2.session.state.units).find(
        (u) => u.meaning.kind === "quantity" && u.meaning.symbols.p000,
      );
      const card = unit
        ? document.querySelector<HTMLElement>(`[data-unit="${unit.id}"]`)
        : null;
      if (card && !visible.has("p000")) {
        const box = card.getBoundingClientRect();
        const math = card.querySelector<HTMLElement>(".katex-html");
        const equation = math?.textContent ?? "";
        if (
          box.width > 0 &&
          box.height > 0 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight &&
          math &&
          math.getBoundingClientRect().width > 0 &&
          equation.includes("200") &&
          equation.includes("=")
        )
          visible.set("p000", {
            at: performance.now() - start,
            version: Number(card.dataset.version),
            text: card.innerText,
            equation,
          });
      }
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const timer = setInterval(sample, 50);
    const unsubscribe = window.v2.session.subscribe(() => {
      const state = window.v2.session.state;
      if (state.cue && !accepted.has(state.cue.text))
        accepted.set(state.cue.text, {
          at: performance.now() - start,
          version: state.cueVersion,
        });
      const unit = Object.values(state.units).find(
        (u) => u.meaning.kind === "quantity" && u.meaning.symbols.p000,
      );
      if (unit && !accepted.has("p000"))
        accepted.set("p000", {
          at: performance.now() - start,
          version: unit.version,
        });
    });
    (window as any).__offlineLive = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body)),
        answer = interpretWorkload(request);
      const latency =
        request.version === "v2-live-request-2"
          ? [500, 2000, 6000][live++ % 3]
          : (stage++, 6000);
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        const cancel = () => {
          clearTimeout(id);
          reject(signal?.reason);
        };
        const id = setTimeout(() => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        }, latency);
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });
      });
      return new Response(
        [
          { type: "response.output_text.delta", delta: JSON.stringify(answer) },
          {
            type: "response.completed",
            response: {
              status: "completed",
              model: "offline-fixed",
              id: "mock",
              usage: null,
            },
          },
        ]
          .map((e) => JSON.stringify(e) + "\n")
          .join(""),
        { headers: { "content-type": "application/x-ndjson" } },
      );
    };
    (window as any).__workload = {
      read: () => ({
        accepted: [...accepted],
        visible: [...visible],
        live,
        stage,
        at: performance.now() - start,
        unaccounted: window.v2.session.window.unaccountedChars,
        units: Object.keys(window.v2.session.state.units).length,
        unresolved: window.v2.session.replay.unresolved,
        rejections: window.v2.session.trace.spans.filter(
          (s) => s.name === "proposal-rejected",
        ),
      }),
      close: () => {
        clearInterval(timer);
        observer.disconnect();
        unsubscribe();
      },
    };
  });
  for (let time = 0; time < profile.duration; time += 100) {
    if (time % profile.fragmentInterval === 0)
      await page.evaluate(
        (text) => window.v2.inject(text),
        workload[time / profile.fragmentInterval].text,
      );
    await page.clock.runFor(100);
  }
  const input = await page.evaluate(() => (window as any).__workload.read());
  for (let i = 0; i < 200; i++) await page.clock.runFor(100);
  const output = await page.evaluate(() => (window as any).__workload.read());
  const accepted = new Map<string, { at: number; version: number }>(
      output.accepted,
    ),
    visible = new Map<
      string,
      { at: number; version: number; text: string; equation?: string }
    >(output.visible);
  const expected = workload
    .filter((r) => r.mustDisplay)
    .map((r) => ({
      index: r.index,
      key:
        r.index === 0
          ? "p000"
          : `Compare samples ${String(r.subject).padStart(3, "0")} and ${String(r.other).padStart(3, "0")} at fixed temperature.`,
      ready: r.evidenceReadyAt,
      deadline: r.acceptBy,
    }));
  const timeline = expected.map((e) => ({
    ...e,
    accepted: accepted.get(e.key),
    visible: visible.get(e.key),
  }));
  await mkdir("../../.cuelayer/v2/repair", { recursive: true });
  await writeFile(
    "../../.cuelayer/v2/repair/sustained-browser.json",
    JSON.stringify(
      { profile, wallMs: performance.now() - wall, input, output, timeline },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "../../.cuelayer/v2/repair/sustained-browser.png",
  });
  for (const row of timeline) {
    expect(row.accepted, row.key).toBeDefined();
    expect(row.visible, row.key).toBeDefined();
    expect(row.accepted!.at, row.key).toBeLessThanOrEqual(row.deadline);
    expect(row.visible!.at, row.key).toBeGreaterThanOrEqual(row.accepted!.at);
    expect(row.visible!.at - row.accepted!.at, row.key).toBeLessThanOrEqual(
      profile.displayBudget,
    );
    expect(row.visible!.version, row.key).toBe(row.accepted!.version);
    expect(row.visible!.text, row.key).toContain("fixed temperature");
    if (row.index === 0) {
      expect(row.visible!.equation).toContain("200");
      expect(row.visible!.text).toContain("kPa");
    }
  }
  expect(output.units).toBeGreaterThanOrEqual(200);
  expect(output.unaccounted).toBe(0);
  expect(output.unresolved).toEqual({});
  expect(output.stage).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__workload.close());
});
