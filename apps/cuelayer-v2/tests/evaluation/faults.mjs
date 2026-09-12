import { startBrowserHarness } from "./browser.mjs";
import { drive } from "./driver.mjs";
import { classifyFault, exclusive } from "./evidence.mjs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function driverFaultProof(provenance, product, out) {
  await mkdir(out, { recursive: false });
  const h = await startBrowserHarness(provenance, product, out);
  try {
    await h.page.goto(
      `${h.url}/?services=real&session=fault-proof-${crypto.randomUUID()}`,
    );
    await h.page.waitForFunction(() => Boolean(window.v2?.session));
    await h.page.evaluate(() => window.v2.session.pause());
    const events = Array.from({ length: 4 }, (_, i) => ({
      event_id: "fault-" + i,
      at_ms: i * 100,
      text: "Timing probe.",
    }));
    let began;
    const started = new Promise((r) => {
      began = r;
    });
    await h.page.exposeBinding("__blockStarted", () => began());
    const blocking = h.page.evaluate(() => {
      void window.__blockStarted();
      const end = performance.now() + 650;
      while (performance.now() < end) {
        /* authored page-main-thread fault */
      }
    });
    await started;
    const productDelay = await drive(events, 800, (row) =>
      h.page.evaluate(
        (event) => ({
          event_id: event.event_id,
          page_received_at: performance.timeOrigin + performance.now(),
          admitted_at: null,
        }),
        row,
      ),
    );
    await blocking;
    let first = true;
    const evaluatorDelay = await drive(events, 800, () => {
      if (first) {
        first = false;
        const end = performance.now() + 700;
        while (performance.now() < end) {
          /* authored evaluator main-thread fault */
        }
      }
      return {};
    });
    const pageDelay =
      productDelay.rows[0].page_received_at -
      productDelay.rows[0].evaluator_dispatch_at;
    const status =
      productDelay.fidelity.status === "PASS" &&
      pageDelay > 300 &&
      evaluatorDelay.fidelity.status === "INVALID"
        ? "PASS"
        : "FAIL";
    const result = {
      identity: "gate3b-driver-attribution-counterexamples-1",
      dependency_mode: "STUB",
      provider_invocations: 0,
      status,
      product_main_thread: {
        ...productDelay,
        page_delay_ms: pageDelay,
        classification: classifyFault({
          kind: "main-thread-overload",
          product_induced: true,
        }),
      },
      evaluator_main_thread: {
        ...evaluatorDelay,
        classification: classifyFault({
          kind: "driver-lateness",
          independent_external: true,
        }),
      },
    };
    await exclusive(resolve(out, "faults.json"), result);
    return result;
  } finally {
    await h.close();
  }
}
