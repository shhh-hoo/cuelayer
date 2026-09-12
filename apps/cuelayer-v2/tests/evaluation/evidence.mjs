import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
export const sha256 = (x) =>
  createHash("sha256")
    .update(typeof x === "string" || Buffer.isBuffer(x) ? x : JSON.stringify(x))
    .digest("hex");
export async function exclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
export async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
export class EvidenceWriter {
  constructor(root) {
    this.root = resolve(root);
    this.sequence = 0;
    this.previous = null;
    this.pending = Promise.resolve();
  }
  append(kind, data) {
    const sequence = ++this.sequence;
    this.pending = this.pending.then(async () => {
      const record = { sequence, kind, previous: this.previous, data };
      const hash = sha256(record);
      await exclusive(
        resolve(this.root, String(sequence).padStart(6, "0") + ".json"),
        { ...record, hash },
      );
      this.previous = hash;
      return hash;
    });
    return this.pending;
  }
}
export function assertInside(root, path) {
  const r = relative(root, path);
  if (!r || r.startsWith("..") || r.startsWith("/"))
    throw Error("provenance-path-outside-product:" + path);
}
export function readiness(checkpoint, timeline) {
  const rows = new Map(timeline.map((e) => [e.event_id, e]));
  const candidates = (checkpoint.sufficient_evidence_sets ?? [])
    .flatMap((set, index) => {
      const selected = set.event_ids.map((id) => rows.get(id));
      if (selected.some((r) => !Number.isFinite(r?.evaluator_dispatch_at)))
        return [];
      const ready = Math.max(...selected.map((r) => r.evaluator_dispatch_at));
      if (
        set.invalidated_by.some(
          (id) =>
            Number.isFinite(rows.get(id)?.evaluator_dispatch_at) &&
            rows.get(id).evaluator_dispatch_at <= ready,
        )
      )
        return [];
      return [
        {
          set_id: set.set_id,
          index,
          ready_at_driver: ready,
          ready_at_product: selected.every((r) =>
            Number.isFinite(r.admitted_at),
          )
            ? Math.max(...selected.map((r) => r.admitted_at))
            : null,
          evidence_refs: set.event_ids,
        },
      ];
    })
    .sort((a, b) => a.ready_at_driver - b.ready_at_driver || a.index - b.index);
  return candidates[0] ?? null;
}
export function calibrateClock(probes) {
  const best = probes
    .map((p) => ({
      offset: p.product_at - (p.driver_before + p.driver_after) / 2,
      uncertainty: (p.driver_after - p.driver_before) / 2,
    }))
    .sort((a, b) => a.uncertainty - b.uncertainty)[0];
  if (!best || best.uncertainty > 100)
    throw Error("clock-calibration-unreliable");
  return best;
}
export function toDriver(at, clock) {
  return { at: at - clock.offset, uncertainty_ms: clock.uncertainty };
}
export function causalLatencies(checkpoint, timeline, acceptance, frame) {
  const ready = readiness(checkpoint, timeline);
  if (!ready) return null;
  if (
    frame &&
    (!acceptance ||
      frame.causal_id !== acceptance.causal_id ||
      frame.version !== acceptance.version)
  )
    throw Error("unrelated-surface-chain");
  return {
    ...ready,
    source_to_accepted: acceptance
      ? acceptance.at - ready.ready_at_driver
      : null,
    accepted_to_visible: frame ? frame.at - acceptance.at : null,
    source_to_visible: frame ? frame.at - ready.ready_at_driver : null,
    uncertainty_ms:
      (acceptance?.uncertainty_ms ?? 0) + (frame?.uncertainty_ms ?? 0),
  };
}
export class Budget {
  constructor(profile) {
    this.profile = profile;
    this.calls = [];
  }
  reserve(metadata = {}) {
    const reserve = this.profile.reservation_per_request_usd;
    if (
      this.calls.length >= this.profile.max_requests ||
      this.cost() + reserve > this.profile.max_cost_usd + 1e-9
    )
      throw Error("budget-exhausted");
    const row = {
      ...metadata,
      id: this.calls.length + 1,
      reserved: reserve,
      cost: null,
    };
    this.calls.push(row);
    return row.id;
  }
  settle(id, usage, actualModel) {
    const row = this.calls.find((r) => r.id === id);
    if (!row) throw Error("unknown-budget-reservation");
    if (row.settled) throw Error("usage-already-settled");
    row.actual_model = actualModel ?? null;
    row.usage = usage ?? null;
    row.settled = true;
    row.cached_input_tokens =
      usage?.input_tokens_details?.cached_tokens ?? null;
    row.cache_state =
      row.cached_input_tokens === null
        ? "unknown"
        : row.cached_input_tokens > 0
          ? "cached"
          : "uncached";
    if (
      usage &&
      Number.isInteger(usage.input_tokens) &&
      usage.input_tokens >= 0 &&
      Number.isInteger(usage.output_tokens) &&
      usage.output_tokens >= 0
    ) {
      // Conservative: cache writes and long-context premiums covered, cache savings not assumed.
      row.cost =
        (usage.input_tokens * 0.5) / 1e6 + (usage.output_tokens * 1.8) / 1e6;
      const cached =
        Number.isInteger(row.cached_input_tokens) &&
        row.cached_input_tokens >= 0 &&
        row.cached_input_tokens <= usage.input_tokens
          ? row.cached_input_tokens
          : 0;
      row.published_rate_estimate_usd =
        ((usage.input_tokens - cached) * this.profile.prices_per_million.input +
          cached * this.profile.prices_per_million.cached_input +
          usage.output_tokens * this.profile.prices_per_million.output) /
        1e6;
      row.cost_basis =
        "conservative upper bound; published rate estimate recorded separately";
      if (row.cost > row.reserved) throw Error("reservation-underestimated");
    }
  }
  cost() {
    return this.calls.reduce((n, r) => n + (r.cost ?? r.reserved), 0);
  }
}
export function nextPhase(phases, results) {
  for (const p of phases) {
    const r = results[p.id];
    if (!r) return p.id;
    if (r.status !== "PASS") return null;
  }
  return null;
}
// Future provider ports must acquire a reservation through this gate before every attempt.
// The class has no network capability and does not constitute paid authorization.
export class ExecutionDiscipline {
  constructor(cohort, profile) {
    this.runs = structuredClone(cohort);
    this.budget = new Budget(profile);
    this.stopped = false;
    this.phase0 = "NOT_RUN";
  }
  preflight(status) {
    if (this.phase0 !== "NOT_RUN")
      throw Error("preflight-result-already-recorded");
    this.phase0 = status;
  }
  begin(id) {
    if (this.stopped || this.phase0 !== "PASS")
      throw Error("phase-progression-blocked");
    const index = this.runs.findIndex((r) => r.run_id === id),
      run = this.runs[index];
    if (!run || run.started || run.status !== "NOT_RUN")
      throw Error("replacement-run-forbidden");
    if (
      this.runs
        .slice(0, index)
        .some(
          (r) =>
            !r.result_recorded ||
            (r.phase !== run.phase && r.status !== "PASS"),
        )
    )
      throw Error("preregistered-order-blocked");
    run.started = true;
    run.status = null;
    return run;
  }
  reserve(id, metadata = {}) {
    const run = this.runs.find((r) => r.run_id === id);
    if (this.stopped || !run?.started || run.result_recorded)
      throw Error("paid-attempt-blocked");
    return this.budget.reserve({ ...metadata, run_id: id });
  }
  observe(id, result) {
    const run = this.runs.find((r) => r.run_id === id);
    if (!run?.started) throw Error("unstarted-result");
    if (
      result.hard_fail ||
      result.status === "INVALID" ||
      result.adjudication_status === "ADJUDICATION_REQUIRED"
    )
      this.stopped = true;
  }
  finish(id, result) {
    const run = this.runs.find((r) => r.run_id === id);
    if (!run?.started || run.result_recorded)
      throw Error("run-overwrite-forbidden");
    this.observe(id, result);
    run.status = result.status;
    run.result_recorded = true;
  }
}
export function classifyFault(f) {
  if (f.product_induced === true) return { status: "FAIL", reason: f.kind };
  if (f.independent_external === true)
    return { status: "INVALID", reason: f.kind };
  return {
    status: null,
    adjudication_status: "ADJUDICATION_REQUIRED",
    reason: "attribution-required:" + f.kind,
  };
}
