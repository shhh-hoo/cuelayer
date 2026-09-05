import { canonicalJson } from "../../src/trace/audit.ts";
import { sanitizeAuditValue } from "../../src/trace/contracts.ts";
import type { TimelineRow, ReplayResult } from "./runner.ts";

/** Reuse production's complete audit DTO sanitization and deterministic serialization. */
export const serializeEvidence = (value: unknown) => canonicalJson(sanitizeAuditValue(value));
const cell = (value: unknown) => JSON.stringify(value ?? null).replace(/\|/g, "\\|").replace(/\n/g, " ");
function stateText(value: unknown) {
  const state = value as ReplayResult["state"] | undefined;
  if (!state) return "";
  const content = (item: typeof state.board.active) => {
    const c = item?.contribution.content;
    return !c ? "—" : c.kind === "TEXT" ? c.text : c.kind === "FOCUS" ? c.target : c.kind === "RELATION" ? `${c.relation}: ${c.targets.join("; ")}` : `${c.from} → ${c.to}`;
  };
  return `Board r${state.board.revision}: ${content(state.board.active)}; retained: ${state.board.retained.map(content).join("; ") || "—"}; Cue r${state.cue.revision}: ${state.cue.active ? `${state.cue.active.kind}: ${state.cue.active.contribution.content}` : "—"}`;
}
function sourceText(row: TimelineRow) {
  const entries = row.segment ? [{ segment: row.segment }] : row.evidence ?? [];
  return (entries as Array<{ segment?: { segmentId: string; startMs: number; endMs: number; availableAtMs: number; originalSegmentIds: string[] } }>).map(({ segment: s }) => s ? `${s.segmentId} (${s.originalSegmentIds.join(",")}) ${s.startMs}–${s.endMs}; available ${s.availableAtMs}` : "").join("; ");
}
export function buildReport(result: ReplayResult, timeline: TimelineRow[], provider: string, mode: string) {
  const failures = timeline.filter(row => row.type === "request.failed" || row.type === "request.blocked");
  const transitions = timeline.filter(row => row.type === "step.accepted");
  const consumed = transitions.flatMap(row => row.consumedEvidenceIds as string[]);
  return `# Lesson transcript replay\n\nProvider: **${provider}** · Mode: **${mode}** · Run status: **${result.status}**\n\n` +
    (provider === "mock" ? "Mock uses a mechanical evidence echo, not an LLM or a teaching-quality oracle.\n\n" : "Configured provider run; no human teaching-quality score is inferred.\n\n") +
    `Attempts: ${result.attempts}; accepted steps: ${transitions.length}; failed/blocked attempts: ${failures.length}.\n\n` +
    `Input delivered: ${result.delivered}; builder-skipped: ${result.skipped}; not delivered: ${result.remainingInput.length}. Consumed: ${consumed.length}; duplicate consumption: ${consumed.length - new Set(consumed).size}; pending: ${result.pendingEvidenceIds.length}. Event replay matches state: **${result.replayMatches}**.\n\n` +
    "## State and failure timeline\n\nSource timestamps and evidence availability are media-relative; run timestamps are elapsed wall-clock time. Accepted state is a CLI state update, not a DOM render.\n\n" +
    "| Run ms | Event | Request / attempt | Source evidence | Delta or failure | State before → after | Pending / oldest ms |\n|---:|---|---|---|---|---|---|\n" +
    timeline.filter(row => ["evidence.arrived", "step.accepted", "request.failed", "request.blocked", "run.stopped", "input.skipped"].includes(row.type)).map(row =>
      `| ${Math.round(row.runTimeMs)} | ${row.type} | ${cell([row.requestId, row.attempt])} | ${cell(sourceText(row))} | ${cell(row.reason ?? { board: (row.boardDelta as { action?: string })?.action, cue: (row.cueDelta as { action?: string })?.action })} | ${cell(row.after ? `${stateText(row.before)} → ${stateText(row.after)}` : "")} | ${row.pendingCount} / ${Math.round(row.oldestPendingAgeMs)} |`).join("\n") +
    `\n\n## Remaining evidence\n\nPending IDs: ${cell(result.pendingEvidenceIds)}\n\nUndelivered segment IDs: ${cell(result.remainingInput.map(s => s.segmentId))}\n\n` +
    "## Not verified\n\n- Microphone, ASR, production canonical span segmentation, browser/session lifecycle and DOM rendering are bypassed. The real closed-span checkpoint builder is used.\n- CLI acceptance does not measure learner-visible or microphone-to-display latency. Sequential results cannot establish realtime throughput.\n- No visuals, future transcript, expected Board timeline or reference answers are supplied to the interpreter. No teaching accuracy/quality score is produced.\n- NOTE expiration is currently triggered by the browser Cue component; that DOM-owned timer is not simulated here.\n- Mock validates engineering behavior only. This report is not LIVE_SEMANTICS_PASS.\n";
}
