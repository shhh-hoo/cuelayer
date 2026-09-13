import { sha256 } from "../evidence.mjs";
const same = (a, b) => sha256(a) === sha256(b);
// The reviewed screening cohort uses dated snapshots. Aliases and arbitrary
// configuration supplied in a proposal cannot expand this provider boundary.
export const ELIGIBLE_MODEL_CONFIGURATIONS = Object.freeze({
  "gpt-5.4-2026-03-05": "medium",
  "gpt-5.4-mini-2026-03-17": "medium",
  "gpt-5.4-nano-2026-03-17": "medium",
  "gpt-5.2-2025-12-11": "medium",
  "gpt-5.1-2025-11-13": "medium",
  "gpt-5-2025-08-07": "medium",
  "gpt-5-mini-2025-08-07": "medium",
  "gpt-5-nano-2025-08-07": "medium",
  "o1-2024-12-17": "medium",
  "o3-2025-04-16": "medium",
  "o3-mini-2025-01-31": "medium",
  "o4-mini-2025-04-16": "medium",
  "gpt-4.1-2025-04-14": null,
  "gpt-4o-2024-08-06": null,
  "gpt-4.1-mini-2025-04-14": null,
  "gpt-4.1-nano-2025-04-14": null,
  "gpt-4o-mini-2024-07-18": null,
});
export function validateEligibleCandidate(candidate) {
  if (!Object.hasOwn(ELIGIBLE_MODEL_CONFIGURATIONS, candidate.model))
    throw Error("unsupported-qualification-screening-model");
  const effort = ELIGIBLE_MODEL_CONFIGURATIONS[candidate.model];
  if (
    candidate.provider !== "openai" ||
    !same(
      candidate.configuration,
      effort === null ? {} : { reasoning: { effort } },
    )
  )
    throw Error("unsupported-qualification-configuration");
}
export function buildCandidatePayload(productPayload, candidate) {
  const screening = Object.hasOwn(
    ELIGIBLE_MODEL_CONFIGURATIONS,
    candidate.model,
  );
  if (screening) validateEligibleCandidate(candidate);
  else {
    if (
      candidate.provider !== "openai" ||
      Object.keys(candidate.configuration).join(",") !== "reasoning" ||
      Object.keys(candidate.configuration.reasoning).join(",") !== "effort" ||
      !["none", "low", "medium", "high", "xhigh", "max"].includes(
        candidate.configuration.reasoning.effort,
      )
    )
      throw Error("unsupported-qualification-configuration");
    if (
      !["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-luna"].includes(
        candidate.model,
      ) ||
      (candidate.model === "gpt-6-astra" &&
        candidate.configuration.reasoning.effort === "none")
    )
      throw Error("unsupported-qualification-model-effort");
  }
  if (
    candidate.service_tier !== "standard" ||
    candidate.max_output_tokens !== 8192
  )
    throw Error("unsupported-qualification-service-policy");
  const payload = {
    ...structuredClone(productPayload),
    model: candidate.model,
    max_output_tokens: candidate.max_output_tokens,
    service_tier: "default",
  };
  if (candidate.configuration.reasoning)
    payload.reasoning = structuredClone(candidate.configuration.reasoning);
  else delete payload.reasoning;
  return payload;
}
export async function providerResponseForCandidate(
  payload,
  candidate,
  { product, capture, fetch: transport, ...options },
) {
  const baseline = await product.provider.liveRequest(capture.request);
  if (!same(payload, buildCandidatePayload(baseline, candidate)))
    throw Error("qualification-semantic-payload-drift");
  const response = await product.providerExecution.providerResponse(
    capture.request,
    {
      ...options,
      model: candidate.model,
      fetch: (url, init) => {
        if (typeof init?.body !== "string")
          throw Error("qualification-sdk-body-missing");
        const generated = JSON.parse(init.body);
        if (!same(payload, buildCandidatePayload(generated, candidate)))
          throw Error("qualification-sdk-payload-drift");
        return transport(url, { ...init, body: JSON.stringify(payload) });
      },
    },
  );
  const headers = new Headers(response.headers);
  headers.set(
    "X-V2-Provider-Request-Bytes",
    String(Buffer.byteLength(JSON.stringify(payload))),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function settleCandidateAttempt(attempt, raw, scope) {
  const started = performance.now();
  try {
    const lines = raw.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith("data:")) continue;
      try {
        const event = JSON.parse(lines[i].slice(5));
        if (
          [
            "response.completed",
            "response.incomplete",
            "response.failed",
          ].includes(event.type)
        ) {
          attempt.service_tier =
            typeof event.response?.service_tier === "string"
              ? event.response.service_tier
              : null;
          break;
        }
      } catch {
        /* Truncated raw evidence cannot establish the returned tier. */
      }
    }
    attempt.service_tier ??= null;
    scope.discipline.budget.settle(
      attempt.reservation,
      attempt.service_tier === "default" ? attempt.usage : null,
      attempt.actual_model,
    );
    if (attempt.service_tier !== null && attempt.service_tier !== "default")
      throw Error("qualification-unexpected-service-tier");
  } finally {
    attempt.metadata_inspection_ms = performance.now() - started;
  }
}
