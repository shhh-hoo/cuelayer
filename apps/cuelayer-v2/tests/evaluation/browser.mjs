import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exclusive, sha256, calibrateClock } from "./evidence.mjs";
import { drive } from "./driver.mjs";
import { Socket } from "node:net";
import { surfaceFidelity } from "./assessment.mjs";
import { predicate } from "./score.mjs";
import { loadScenarios } from "./assets.mjs";
import { wait, still, establish, area } from "./canary.mjs";

export const now = () => performance.timeOrigin + performance.now();
export function localOnly(url) {
  const u = new URL(url);
  return (
    ["http:", "https:", "ws:", "wss:"].includes(u.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
  );
}
// Installed before loading the application. No .env or credential discovery is performed.
export function prohibitProviderEgress() {
  const original = globalThis.fetch,
    connect = Socket.prototype.connect;
  // Credentials are neither discovered nor forwarded to child processes.
  for (const key of Object.keys(process.env))
    if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|OPENAI|SPEECHMATICS/.test(key))
      delete process.env[key];
  Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host =
      typeof first === "object"
        ? first.host
        : typeof args[1] === "string"
          ? args[1]
          : "localhost";
    if (host && !["127.0.0.1", "localhost", "::1"].includes(host))
      throw Error("preflight-nonlocal-socket-blocked");
    return connect.apply(this, args);
  };
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    if (!localOnly(url)) throw Error("preflight-nonlocal-egress-blocked");
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
    Socket.prototype.connect = connect;
  };
}
export async function startBrowserHarness(
  provenance,
  product,
  out,
  { responder } = {},
) {
  const requests = [],
    errors = [],
    loadedURLs = new Set(),
    journal = [],
    assets = [];
  let page;
  const cache = resolve(out, "compile-cache");
  await mkdir(cache, { recursive: false });
  provenance.cache = cache;
  const endpoint = {
    name: "gate3b-local-only-stub",
    configureServer(server) {
      server.middlewares.use("/api/v2", async (req, res) => {
        const json = (status, data) => {
          res.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify(data));
        };
        if (req.url === "/config")
          return json(200, {
            ...product.provider.modelProfile,
            modelConfigured: true,
            speechConfigured: false,
            observationOnly: false,
            dependencyMode: "STUB",
          });
        if (req.url !== "/live" || req.method !== "POST")
          return json(403, { error: "preflight-egress-disabled" });
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk.toString();
            if (body.length > 32000) throw Error("request-too-large");
          }
          const request = JSON.parse(body),
            payload = await product.provider.liveRequest(request);
          const captured = await page.evaluate(
            (scope) =>
              window.__gate.requests.findLast(
                (r) => (r.task.capture ?? r.task.review).namespace === scope,
              ),
            request.scope,
          );
          if (!captured) throw Error("request-capture-missing");
          if (
            JSON.stringify(request) !==
            JSON.stringify(
              captured.task.review?.request ?? captured.task.capture.request,
            )
          )
            throw Error("request-capture-drift");
          const response = responder
            ? await responder(captured, request)
            : captured.task.lane === "Stage"
              ? still(captured.task)
              : captured.prestate.evidence.some((e) =>
                    e.text.includes("square metres"),
                  )
                ? establish(
                    product,
                    captured.task,
                    captured.prestate.evidence.map((e) => e.text).join(" "),
                    area,
                  )
                : wait(captured.task);
          const row = {
            dependency_mode: "STUB",
            request,
            payload,
            raw_response: JSON.stringify(response),
            response,
            captured,
            provider_invocations: 0,
            actual_model: "LOCAL_STUB",
            usage: null,
            cache_state: "not-applicable",
            at: now(),
          };
          requests.push(row);
          res.writeHead(200, {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
            "X-V2-Provider-Request-Bytes": String(
              Buffer.byteLength(JSON.stringify(payload)),
            ),
          });
          res.end(
            JSON.stringify({
              type: "response.output_text.delta",
              delta: JSON.stringify(response),
            }) +
              "\n" +
              JSON.stringify({
                type: "response.completed",
                response: {
                  id: "stub-" + requests.length,
                  status: "completed",
                  model: "LOCAL_STUB",
                  usage: null,
                },
              }) +
              "\n",
          );
        } catch (error) {
          errors.push({ boundary: "evaluator-stub", message: error.message });
          json(500, { error: "preflight-stub-failed" });
        }
      });
    },
  };
  const server = await createServer({
    root: resolve(provenance.product, "apps/cuelayer-v2"),
    configFile: false,
    envFile: false,
    cacheDir: cache,
    plugins: [react(), provenance.vitePlugin(), endpoint],
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: true,
      fs: { allow: [provenance.product, cache] },
    },
    optimizeDeps: {
      rolldownOptions: {
        plugins: [
          {
            name: "gate3b-dependency-inputs",
            load(id) {
              if (id.startsWith("/") && !id.includes("\0"))
                provenance.inspect(id, "dependency-build");
              return null;
            },
          },
        ],
      },
    },
    clearScreen: false,
    logLevel: "error",
  });
  await server.listen();
  const address = server.httpServer.address(),
    url = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (localOnly(u) || u.startsWith("data:")) return route.continue();
    // Public, versioned renderer assets are not model egress. Their bytes are recorded.
    if (
      route.request().method() === "GET" &&
      /^https:\/\/cdn\.tldraw\.com\/5\.4\.2\/(fonts|icons|translations|embed-icons)\//.test(
        u,
      )
    )
      return route.continue();
    errors.push({ boundary: "egress-denied", url: u });
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (localOnly(socket.url())) socket.connectToServer();
    else socket.close();
  });
  page = await context.newPage();
  page.on("pageerror", (e) =>
    errors.push({ boundary: "page", message: e.message }),
  );
  page.on("response", async (r) => {
    if (r.url().startsWith("https://cdn.tldraw.com/5.4.2/")) {
      try {
        assets.push({
          url: r.url(),
          sha256: sha256(await r.body()),
          status: r.status(),
        });
      } catch {
        errors.push({ boundary: "renderer-asset", url: r.url() });
      }
    }
  });
  page.on("response", (r) => {
    if (r.request().resourceType() === "script") loadedURLs.add(r.url());
  });
  await page.exposeBinding("__gateExport", (_source, rows) => {
    journal.push(...rows);
  });
  const close = async () => {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close();
  };
  return {
    server,
    browser,
    context,
    page,
    url,
    requests,
    errors,
    journal,
    loadedURLs,
    close,
    cache,
    assets,
  };
}

export async function instrument(page) {
  await page.waitForFunction(() => Boolean(window.v2?.handle.editor));
  await page.evaluate(() => {
    const s = window.v2.session,
      g = (window.__gate = { requests: [], records: [], stopped: false });
    const copy = (x) => structuredClone(x),
      clock = () => performance.now(),
      mark = s.trace.mark.bind(s.trace);
    s.trace.mark = function (...args) {
      const id = mark(...args),
        span = s.trace.spans.at(-1),
        row = { type: "trace", wall_at: Date.now(), span: copy(span) };
      const taskId = span.attributes.taskId;
      if (span.name === "model-request") {
        const task = s.captures.get(taskId);
        if (!task) throw Error("observed-task-missing");
        const record = {
          task: copy(task),
          prestate: s.replay,
          product_at: clock(),
        };
        g.requests.push(record);
        row.request = record;
      }
      if (
        [
          "semantic-validation-start",
          "persistence",
          "semantic-accepted",
          "proposal-rejected",
        ].includes(span.name)
      )
        row.replay = s.replay;
      if (span.name === "semantic-accepted")
        row.presentation_context = {
          attention: copy(s.attention),
          cuePresentation: copy(s.cuePresentation),
          frame: copy(window.v2.handle.frame),
        };
      g.records.push(row);
      return id;
    };
    const sample = () => {
      if (g.stopped) return;
      const units = [
        ...document.querySelectorAll("[data-unit],[data-testid=teaching-cue]"),
      ].map((el) => {
        const box = el.getBoundingClientRect(),
          style = getComputedStyle(el),
          x = box.left + box.width / 2,
          y = box.top + box.height / 2,
          hit = document.elementFromPoint(x, y);
        const hs = hit && getComputedStyle(hit),
          transparentHit =
            hs &&
            ["rgba(0, 0, 0, 0)", "transparent"].includes(hs.backgroundColor) &&
            hs.backgroundImage === "none" &&
            hs.filter === "none" &&
            hs.backdropFilter === "none" &&
            !hit.textContent.trim();
        const shapeLayer = el.closest(".tl-shapes"),
          backgroundLayer = hit?.closest(".tl-background__wrapper");
        const behindContent = Boolean(
          hit?.matches(".tl-background") &&
          shapeLayer &&
          backgroundLayer &&
          shapeLayer.closest(".tl-canvas") ===
            backgroundLayer.closest(".tl-canvas") &&
          Number(getComputedStyle(shapeLayer).zIndex) >
            Number(getComputedStyle(backgroundLayer).zIndex),
        );
        return {
          unit_id: el.getAttribute("data-unit"),
          version:
            el.getAttribute("data-version") ??
            el.getAttribute("data-cue-version"),
          text: el.innerText,
          rendered_math:
            el.querySelector('annotation[encoding="application/x-tex"]')
              ?.textContent ?? null,
          paragraphs: [...el.querySelectorAll("p")].map((p) => p.textContent),
          visible:
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity) > 0 &&
            document.visibilityState === "visible",
          readable:
            el.scrollWidth <= el.clientWidth + 2 &&
            el.scrollHeight <= el.clientHeight + 2 &&
            !el.querySelector('[role="alert"]'),
          unoccluded: Boolean(
            hit &&
            (el.contains(hit) ||
              hit.contains(el) ||
              transparentHit ||
              behindContent),
          ),
          hit_target: hit
            ? {
                tag: hit.tagName,
                className: String(hit.className),
                background: hs.backgroundColor,
                transparent_empty_overlay: Boolean(transparentHit),
                behind_content: behindContent,
              }
            : null,
          in_safe_area:
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
          revision: s.state.revision,
        };
      });
      const r = s.replay,
        pos = (c) =>
          !c.sequence
            ? 0
            : r.evidence
                .slice(0, c.sequence - 1)
                .reduce((n, e) => n + e.text.length, 0) + c.offset;
      g.records.push({
        type: "frame",
        product_at: clock(),
        units,
        frontier: { A: pos(r.accounted), R: pos(r.recorded) },
        carry: copy(r.unresolved),
        window: copy(s.window),
      });
    };
    g.sample = setInterval(sample, 50);
    g.exporter = setInterval(() => {
      const rows = g.records.splice(0);
      if (rows.length) void window.__gateExport(rows);
    }, 100);
    sample();
  });
}
export async function clockMapping(page) {
  const probes = [];
  for (let i = 0; i < 7; i++) {
    const driver_before = now(),
      product_at = await page.evaluate(() => performance.now()),
      driver_after = now();
    probes.push({ driver_before, product_at, driver_after });
  }
  return { probes, ...calibrateClock(probes) };
}
export async function finishCapture(h, out) {
  const tail = await h.page.evaluate(() => {
    const g = window.__gate;
    g.stopped = true;
    clearInterval(g.sample);
    clearInterval(g.exporter);
    return g.records.splice(0);
  });
  h.journal.push(...tail);
  const snapshot = await h.page.evaluate(async () => ({
    ...window.v2.snapshot(),
    events: await window.v2.session.store.read(window.v2.session.id),
    dom: document.body.innerText,
    error: window.v2.session.error,
  }));
  const clock = await clockMapping(h.page);
  await h.page.screenshot({ path: resolve(out, "surface.png") });
  const graph = h.provenance?.verifyBrowserGraph(h.server, h.loadedURLs);
  return { snapshot, clock_end: clock, browser_graph: graph };
}
export async function jointSmoke(provenance, product, scenario, out) {
  await mkdir(out, { recursive: false });
  const h = await startBrowserHarness(provenance, product, out);
  h.provenance = provenance;
  try {
    await h.page.goto(
      `${h.url}/?services=real&session=gate3b-stub-${crypto.randomUUID()}`,
    );
    await instrument(h.page);
    const clock_start = await clockMapping(h.page);
    const timeline = await drive(
      scenario.transcript_events,
      scenario.duration_ms,
      (row) =>
        h.page.evaluate(async (event) => {
          const page_received_at = performance.now(),
            s = window.v2.session,
            i = s.replay.evidence.length;
          await s.commitEvidence({
            id: event.event_id,
            run: s.id,
            source: String(i),
            text: event.text,
            start: event.at_ms / 1000,
            end: event.at_ms / 1000 + 0.1,
            receivedAt: page_received_at,
            audioObservedAt: null,
            stability: "COMMITTED",
          });
          return { page_received_at, admitted_at: performance.now() };
        }, row),
    );
    await h.page.waitForTimeout(1800);
    const ending = await finishCapture(h, out);
    const result = {
      identity: "gate3b-joint-evidence-1",
      dependency_mode: "STUB",
      provider_invocations: 0,
      scenario_id: scenario.scenario_id,
      clock_start,
      timeline,
      ...ending,
      requests: h.requests,
      journal: h.journal,
      errors: h.errors,
      renderer_assets: h.assets,
      provenance: provenance.snapshot(),
    };
    await exclusive(resolve(out, "joint.json"), result);
    return result;
  } catch (error) {
    await exclusive(resolve(out, "incomplete.json"), {
      error: error.message,
      requests: h.requests,
      errors: h.errors,
      journal: h.journal,
    });
    throw error;
  } finally {
    await h.close();
  }
}

export async function replayDisplay(provenance, product, recorded, out) {
  await mkdir(out, { recursive: false });
  const h = await startBrowserHarness(provenance, product, out, {
    responder: () => {
      throw Error("display-replay-request-forbidden");
    },
  });
  h.provenance = provenance;
  try {
    await h.page.goto(
      `${h.url}/?services=real&session=display-bootstrap-${crypto.randomUUID()}`,
    );
    await h.page.waitForFunction(() => Boolean(window.v2?.session));
    const events = recorded.snapshot.events,
      sessionId = events[0]?.sessionId;
    if (!sessionId) throw Error("display-replay-events-missing");
    await h.page.evaluate(
      async ({ events, sessionId }) => {
        const s = window.v2.session;
        s.pause();
        const existing = await s.store.read(sessionId);
        if (existing.length) throw Error("display-replay-session-exists");
        for (const event of events)
          await s.store.append(event, event.sequence - 1);
      },
      { events, sessionId },
    );
    await h.page.goto(
      `${h.url}/?services=real&session=${encodeURIComponent(sessionId)}`,
    );
    await instrument(h.page);
    await h.page.evaluate(() => window.v2.session.pause());
    await h.page.waitForTimeout(1200);
    const ending = await finishCapture(h, out);
    const expected = product.display.decide(recorded.snapshot.state, null);
    const scenario = (await loadScenarios()).find(
      (s) => s.scenario_id === recorded.scenario_id,
    );
    const surfaceRule = scenario?.surface_expectations.find(
      (p) => p.expectation_id === "accepted-surface-fidelity",
    );
    if (!surfaceRule) throw Error("display-replay-scenario-context-missing");
    const surfaceChecks = expected.selected.map((candidate) => {
      const frames = h.journal
        .filter((r) => r.type === "frame")
        .flatMap((r) => r.units.map((u) => ({ ...u, at: r.product_at })))
        .filter(
          (f) =>
            f.unit_id === candidate.unitId &&
            Number(f.version) === candidate.version &&
            f.visible &&
            f.readable &&
            f.unoccluded &&
            f.in_safe_area &&
            surfaceFidelity(
              f,
              recorded.snapshot.state.units[candidate.unitId].meaning,
            ),
        );
      const verdict = predicate(surfaceRule, {
        observations: {
          [surfaceRule.expectation_id]: {
            accepted: { version: candidate.version, causal_id: candidate.id },
            frames: frames.map((f) => ({
              ...f,
              version: Number(f.version),
              causal_id: candidate.id,
              content_matches: true,
            })),
          },
        },
      });
      return {
        unit_id: candidate.unitId,
        version: candidate.version,
        ...verdict,
      };
    });
    const stateMatches =
      JSON.stringify(ending.snapshot.state) ===
      JSON.stringify(recorded.snapshot.state);
    // A free negative control changes only the ephemeral test page after positive capture.
    const removed = await h.page.evaluate(() => {
      const nodes = [...document.querySelectorAll("[data-unit]")];
      nodes.forEach((n) => n.remove());
      return {
        removed: nodes.length,
        remaining: document.querySelectorAll("[data-unit]").length,
        state: window.v2.session.state,
      };
    });
    const negative_control = {
      expected: "FAIL",
      actual:
        removed.remaining === 0 && expected.selected.length
          ? predicate(surfaceRule, {
              observations: {
                [surfaceRule.expectation_id]: {
                  accepted: {
                    version: expected.selected[0].version,
                    causal_id: expected.selected[0].id,
                  },
                  frames: [],
                },
              },
            }).status
          : "NOT_EXERCISED",
      removed: removed.removed,
      state_unchanged:
        JSON.stringify(removed.state) ===
        JSON.stringify(recorded.snapshot.state),
    };
    await h.page.screenshot({
      path: resolve(out, "display-negative-control.png"),
    });
    const result = {
      identity: "gate3b-display-isolation-1",
      dependency_mode: "RECORDED",
      replay_kind: "accepted-events-to-production-display",
      status:
        stateMatches &&
        surfaceChecks.length &&
        surfaceChecks.every((r) => r.status === "PASS") &&
        negative_control.actual === "FAIL" &&
        negative_control.state_unchanged
          ? "PASS"
          : "FAIL",
      state_matches: stateMatches,
      surface_checks: surfaceChecks,
      negative_control,
      provider_invocations: 0,
      request_count: h.requests.length,
      source_events_sha256: sha256(events),
      limitation:
        "Reload lifecycle only: ephemeral attention/Cue context is not restored or fabricated. Historical timing is not re-scored.",
      ...ending,
      journal: h.journal,
      errors: h.errors,
      provenance: provenance.snapshot(),
    };
    if (h.requests.length) throw Error("replay-model-call-attempt");
    await exclusive(resolve(out, "display.json"), result);
    return result;
  } finally {
    await h.close();
  }
}
