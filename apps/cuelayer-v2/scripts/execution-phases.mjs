// Read-only analysis of the shared execution boundary. Historical spans without
// attempt identities remain historical evidence, never inferred provider success.
const statistics = (values, attempts) => {
  const rawMs = values
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const n = rawMs.length;
  return {
    attempts,
    observed: n,
    unavailable: attempts - n,
    medianMs: n
      ? (rawMs[Math.floor((n - 1) / 2)] + rawMs[Math.ceil((n - 1) / 2)]) / 2
      : null,
    p95Ms: n >= 20 ? rawMs[Math.ceil(n * 0.95) - 1] : null,
    rawMs,
  };
};
const elapsed = (start, end) =>
  start &&
  end &&
  start.attributes.clockId &&
  start.attributes.clockId === end.attributes.clockId &&
  end.end >= start.end
    ? end.end - start.end
    : null;

export function executionPhases(spans) {
  const requests = spans.filter((s) => s.name === "model-request");
  const attempts = requests
    .filter((s) => s.attributes.attemptId)
    .map((request) => {
      const { taskId, lane, attemptId, traceSourceId } = request.attributes;
      const own = spans.filter(
        (s) =>
          s.attributes.attemptId === attemptId &&
          s.attributes.traceSourceId === traceSourceId,
      );
      const first = (name) => own.find((s) => s.name === name);
      const finish = first("model-attempt-finished");
      const terminal =
        first("model-complete") ?? first("model-provider-terminal");
      const parsed = first(
        lane === "Live"
          ? "schema-valid-live-decision"
          : "schema-valid-stage-review",
      );
      const parserFailure = first("model-parser-failed");
      const failure = first("model-failure");
      const host = parsed
        ? spans.find(
            (s) =>
              s.attributes.traceSourceId === traceSourceId &&
              s.attributes.taskId === taskId &&
              s.end >= parsed.end &&
              [
                "semantic-accepted",
                "proposal-rejected",
                "live-wait",
                "output-capacity-blocked",
              ].includes(s.name),
          )
        : undefined;
      const hostAccepted = host?.name === "semantic-accepted";
      // WAIT is a host-validated inspection, not an accepted knowledge event.
      const inspected =
        host && ["live-wait", "output-capacity-blocked"].includes(host.name);
      let proposal;
      try {
        proposal = JSON.parse(terminal?.attributes.output ?? "null");
      } catch {
        /* Missing output is not an answer. */
      }
      const array = (value) => (Array.isArray(value) ? value : []);
      const operations = hostAccepted
        ? [
            ...array(proposal?.operations),
            ...array(proposal?.groups).flatMap((g) => array(g?.operations)),
            ...array(proposal?.results).flatMap((r) => array(r?.operations)),
          ]
        : [];
      const cue = operations.some((o) => o?.type === "cue" && o.value);
      const dom = hostAccepted
        ? spans.find(
            (s) =>
              s.attributes.traceSourceId === traceSourceId &&
              s.end >= host.end &&
              s.attributes.revision === host.attributes.revision &&
              s.attributes.complete === true &&
              ((s.name === "learner-visible-dom" &&
                (host.attributes.changedUnits ?? []).some((id) =>
                  (s.attributes.targets ?? []).includes(id),
                )) ||
                (s.name === "cue-visible-dom" && cue)),
          )
        : undefined;
      // Host and DOM markers use their browser Trace clock. Remote observations
      // keep an explicit different clock ID and are never subtracted from them.
      const local = (span) =>
        span && {
          ...span,
          attributes: {
            ...span.attributes,
            clockId: span.attributes.clockId ?? request.attributes.clockId,
          },
        };
      const dispatch = first("model-provider-dispatch");
      const upstreamTerminal = first("model-upstream-terminal");
      const parserEnd = parsed ?? parserFailure;
      return {
        taskId,
        lane,
        attemptId,
        traceSourceId,
        attemptFinished: Boolean(finish),
        providerCompleted: terminal?.attributes.completed === true,
        providerTerminalType: terminal?.attributes.terminalType ?? null,
        parserAttempted: Boolean(parserEnd),
        parserSucceeded: Boolean(parsed),
        hostEvaluated: Boolean(host),
        hostAccepted,
        hostInspected: Boolean(inspected),
        visibleDomObserved: Boolean(dom),
        failure:
          failure?.attributes.reason ??
          (host?.name === "proposal-rejected" ? host.attributes.reason : null),
        outcome: hostAccepted
          ? "accepted"
          : inspected
            ? "inspected"
            : host?.name === "proposal-rejected"
              ? "host-rejected"
              : failure
                ? "execution-failed"
                : finish
                  ? "awaiting-host"
                  : "in-flight",
        clocks: {
          browser: request.attributes.clockId ?? null,
          provider: dispatch?.attributes.clockId ?? null,
        },
        timings: {
          providerHeadersMs: elapsed(dispatch, first("model-provider-headers")),
          providerFirstByteMs: elapsed(
            dispatch,
            first("model-first-upstream-byte"),
          ),
          providerFirstAnswerMs: elapsed(
            dispatch,
            first("model-first-upstream-answer-text"),
          ),
          providerTerminalMs: elapsed(dispatch, upstreamTerminal),
          providerCompleteMs:
            upstreamTerminal?.attributes.completed === true
              ? elapsed(dispatch, upstreamTerminal)
              : null,
          browserFirstAnswerMs: elapsed(request, first("model-first-output")),
          browserTerminalMs: elapsed(request, terminal),
          browserCompleteMs:
            terminal?.attributes.completed === true
              ? elapsed(request, terminal)
              : null,
          terminalToParserMs: elapsed(terminal, parserEnd),
          parserMs: elapsed(first("model-parser-start"), parserEnd),
          browserToHostMs: elapsed(request, local(host)),
          browserToAcceptedMs: hostAccepted
            ? elapsed(request, local(host))
            : null,
          acceptedToDomMs: elapsed(
            local(hostAccepted ? host : undefined),
            local(dom),
          ),
          browserToDomMs: elapsed(request, local(dom)),
          attemptElapsedMs: elapsed(request, finish),
        },
      };
    });
  const metrics = Object.fromEntries(
    ["Live", "Stage"].map((lane) => {
      const rows = attempts.filter((a) => a.lane === lane);
      const names = Object.keys(attempts[0]?.timings ?? {});
      return [
        lane,
        Object.fromEntries(
          names.map((name) => [
            name,
            statistics(
              rows.map((r) => r.timings[name]),
              rows.length,
            ),
          ]),
        ),
      ];
    }),
  );
  return {
    identity: "v2-execution-phases-1",
    attempts,
    counts: {
      requests: requests.length,
      instrumentedAttempts: attempts.length,
      legacyRequestsWithoutAttemptIdentity: requests.length - attempts.length,
      finished: attempts.filter((a) => a.attemptFinished).length,
      providerCompleted: attempts.filter((a) => a.providerCompleted).length,
      parserSucceeded: attempts.filter((a) => a.parserSucceeded).length,
      hostAccepted: attempts.filter((a) => a.hostAccepted).length,
      failed: attempts.filter((a) => a.failure).length,
      unfinished: attempts.filter((a) => !a.attemptFinished).length,
    },
    metrics,
    interpretation:
      "Latency samples describe only observed phases. Every attempt remains in the denominator; missing phases are unavailable, never zero. Completion and host acceptance do not establish semantic correctness. DOM matches are structural observations, not a semantic oracle.",
  };
}
