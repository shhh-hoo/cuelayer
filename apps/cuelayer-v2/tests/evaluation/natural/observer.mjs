// Read-only observation is installed when the real app publishes its Session,
// before any transcript admission. No scheduler or acceptance method is replaced.
export async function armNaturalObserver(page) {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, "v2", {
      configurable: true,
      get: () => api,
      set(value) {
        api = value;
        const s = value.session;
        const restoredEvidenceIds = new Set(s.replay.evidence.map((e) => e.id));
        const g = (window.__gate = {
          requests: [],
          records: [],
          stopped: false,
          pendingExports: [],
          clockId: `browser:${performance.timeOrigin}`,
          overhead: {
            samples: 0,
            sample_total_ms: 0,
            sample_max_ms: 0,
            marks: 0,
            mark_total_ms: 0,
            mark_max_ms: 0,
          },
        });
        const emit = (row) => g.records.push({ ...row, clockId: g.clockId });
        const mark = s.trace.mark.bind(s.trace);
        s.trace.mark = function (...args) {
          const id = mark(...args);
          const began = performance.now();
          try {
            const span = structuredClone(s.trace.spans.at(-1));
            const row = { type: "trace", span, product_at: performance.now() };
            if (span.name === "model-request") {
              // The existing Session's capture registry is observed, never restored
              // or modified. The provider bridge verifies it through capturedRequest.
              const task = s.captures.get(span.attributes.taskId);
              if (!task) throw Error("natural-observed-task-missing");
              const captured = {
                task: structuredClone(task),
                prestate: structuredClone(s.replay),
                request: structuredClone((task.capture ?? task.review).request),
                prestate_role:
                  "request-dispatch replay; may include concurrent facts outside captured task; not model input",
                product_at: performance.now(),
                attempt_id: span.attributes.attemptId,
                clockId: g.clockId,
              };
              g.requests.push(captured);
              row.request = captured;
            }
            if (
              [
                "semantic-accepted",
                "proposal-rejected",
                "persistence",
              ].includes(span.name)
            )
              row.replay = structuredClone(s.replay);
            emit(row);
          } catch (error) {
            emit({ type: "observer-error", message: error.message });
          } finally {
            const elapsed = performance.now() - began;
            g.overhead.marks++;
            g.overhead.mark_total_ms += elapsed;
            g.overhead.mark_max_ms = Math.max(g.overhead.mark_max_ms, elapsed);
          }
          return id;
        };
        const sample = () => {
          if (g.stopped) return;
          const began = performance.now();
          try {
            const r = s.replay;
            const pos = (c) =>
              !c.sequence
                ? 0
                : r.evidence
                    .slice(0, c.sequence - 1)
                    .reduce((n, e) => n + e.text.length, 0) + c.offset;
            const dom = [
              ...document.querySelectorAll(
                "[data-unit],[data-testid=teaching-cue]",
              ),
            ].map((el) => {
              const box = el.getBoundingClientRect(),
                style = getComputedStyle(el);
              return {
                unit_id: el.getAttribute("data-unit"),
                cue: el.getAttribute("data-testid") === "teaching-cue",
                text: el.innerText,
                version:
                  el.getAttribute("data-version") ??
                  el.getAttribute("data-cue-version"),
                visible:
                  box.width > 0 &&
                  box.height > 0 &&
                  style.visibility !== "hidden" &&
                  style.display !== "none",
                readable:
                  el.scrollHeight <= el.clientHeight + 2 &&
                  el.scrollWidth <= el.clientWidth + 2,
                in_viewport:
                  box.left >= 0 &&
                  box.top >= 0 &&
                  box.right <= innerWidth &&
                  box.bottom <= innerHeight,
                box: {
                  left: box.left,
                  top: box.top,
                  right: box.right,
                  bottom: box.bottom,
                },
              };
            });
            const pending = r.evidence.find(
              (e) =>
                e.sequence > r.accounted.sequence ||
                (e.sequence === r.accounted.sequence &&
                  r.accounted.offset < e.text.length),
            );
            emit({
              type: "frame",
              product_at: performance.now(),
              dom,
              frontier: { A: pos(r.accounted), R: pos(r.recorded) },
              oldest_pending_ms: !pending
                ? 0
                : restoredEvidenceIds.has(pending.id)
                  ? null
                  : Math.max(0, performance.now() - pending.receivedAt),
              oldest_pending_unavailable_reason:
                pending && restoredEvidenceIds.has(pending.id)
                  ? "evidence-from-earlier-browser-clock"
                  : null,
              window: structuredClone(s.window),
              unresolved: structuredClone(r.unresolved),
            });
          } catch (error) {
            emit({ type: "observer-error", message: error.message });
          } finally {
            const elapsed = performance.now() - began;
            g.overhead.samples++;
            g.overhead.sample_total_ms += elapsed;
            g.overhead.sample_max_ms = Math.max(
              g.overhead.sample_max_ms,
              elapsed,
            );
          }
        };
        g.sample = setInterval(sample, 50);
        g.exporter = setInterval(() => {
          const rows = g.records.splice(0);
          if (rows.length) {
            const pending = window.__gateExport(rows).catch((error) => {
              emit({
                type: "observer-error",
                message: "export-failed:" + error.message,
                dropped_records: rows.length,
              });
            });
            g.pendingExports.push(pending);
            void pending.finally(() => {
              g.pendingExports = g.pendingExports.filter((p) => p !== pending);
            });
          }
        }, 100);
        sample();
      },
    });
  });
}

export async function naturalCheckpoint(page, id, at_ms) {
  return page.evaluate(
    async ({ id, at_ms }) => {
      const s = window.v2.session;
      const acquired = performance.now();
      const snapshot = {
        replay: s.replay,
        dom_text: document.body.innerText,
        cue: structuredClone(s.state.cue ?? null),
        trace: structuredClone(s.trace.spans),
        window: structuredClone(s.window),
        error: s.error,
        frame: structuredClone(window.v2.handle.frame),
      };
      const events = (await s.store.read(s.id)).filter(
        (event) => event.sequence <= snapshot.replay.sequence,
      );
      if ((events.at(-1)?.sequence ?? 0) !== snapshot.replay.sequence)
        throw Error("natural-checkpoint-prefix-missing");
      return {
        id,
        at_ms,
        product_at: acquired,
        acquired_at_browser: acquired,
        storage_completed_at_browser: performance.now(),
        clockId: window.__gate.clockId,
        snapshot: { ...snapshot, events },
      };
    },
    { id, at_ms },
  );
}

export async function admitNaturalTranscript(page, event) {
  return page.evaluate(async (event) => {
    const s = window.v2.session;
    const page_received_at = performance.now();
    await s.speech.receive(
      {
        message: "AddTranscript",
        channel: "natural-text-teacher",
        metadata: {
          transcript: event.text,
          start_time: event.at_ms / 1000,
          end_time: event.at_ms / 1000 + 0.001,
        },
      },
      null,
    );
    const source = JSON.stringify([
      event.at_ms / 1000,
      event.at_ms / 1000 + 0.001,
      "natural-text-teacher",
    ]);
    const evidence = s.replay.evidence.filter(
      (e) => e.run === s.speech.run && e.source === source,
    );
    return {
      event_id: event.event_id,
      page_received_at,
      admitted_at: performance.now(),
      clockId: window.__gate.clockId,
      evidence_ids: evidence.map((e) => e.id),
      evidence,
    };
  }, event);
}

export async function flushNaturalObserver(h) {
  const rows = await h.page.evaluate(async () => {
    const g = window.__gate;
    g.stopped = true;
    clearInterval(g.sample);
    clearInterval(g.exporter);
    await Promise.all(g.pendingExports);
    g.records.push({
      type: "observer-overhead",
      clockId: g.clockId,
      ...g.overhead,
    });
    return g.records.splice(0);
  });
  h.journal.push(...rows);
}

export async function reloadNaturalObserver(h) {
  await h.page.evaluate(async () => {
    const g = window.__gate;
    g.stopped = true;
    clearInterval(g.sample);
    clearInterval(g.exporter);
    await Promise.all(g.pendingExports);
    g.records.push({
      type: "observer-overhead",
      clockId: g.clockId,
      ...g.overhead,
    });
    for (let i = 0; i < 10; i++) {
      const rows = g.records.splice(0);
      if (rows.length) await window.__gateExport(rows);
      if (!g.records.length) {
        location.reload();
        return;
      }
    }
    throw Error("natural-reload-observer-not-quiescent");
  });
  await h.page.waitForLoadState("load");
}
