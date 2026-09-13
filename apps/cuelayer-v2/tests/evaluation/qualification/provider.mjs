import { sha256 } from "../evidence.mjs";
const same = (a, b) => sha256(a) === sha256(b);
export function buildCandidatePayload(productPayload, candidate) {
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
    !["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-luna"].includes(candidate.model) ||
    (candidate.model === "gpt-6-astra" &&
      candidate.configuration.reasoning.effort === "none")
  )
    throw Error("unsupported-qualification-model-effort");
  if (
    candidate.service_tier !== "standard" ||
    candidate.max_output_tokens !== 8192
  )
    throw Error("unsupported-qualification-service-policy");
  return {
    ...structuredClone(productPayload),
    model: candidate.model,
    reasoning: structuredClone(candidate.configuration.reasoning),
    max_output_tokens: candidate.max_output_tokens,
    service_tier: "default",
  };
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
