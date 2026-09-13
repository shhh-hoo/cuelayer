import { test, expect } from "./fixtures";
import type { LiveRequest } from "../../src/projection";
import type { ProviderRequest } from "../../server/live";

const original = "The ratio we will use next is...";
const clarification = "The ratio is pressure divided by temperature.";
function response(raw: unknown) {
  return [
    { type: "response.output_text.delta", delta: JSON.stringify(raw) },
    {
      type: "response.completed",
      response: {
        status: "completed",
        model: "offline-source-review",
        id: "mock",
        usage: null,
      },
    },
  ]
    .map((event) => JSON.stringify(event) + "\n")
    .join("");
}
function recovered(request: LiveRequest) {
  const subject = request.obligations.find((item) => item.phrase === original)!;
  const sources = [
    request.source,
    ...request.context.filter(
      (item) =>
        item.source === subject.source || item.role === "FOLLOWING_CONTEXT",
    ),
  ];
  const basis = sources.map((source) => {
    const cuts = [...source.text.matchAll(/<(b\d+)>/g)];
    return { source: source.source, start: cuts[0][1], end: cuts.at(-1)![1] };
  });
  return {
    scope: request.scope,
    groups: [
      {
        outcome: "APPLY",
        throughBoundary: request.source.end,
        operations: [
          { type: "core", id: request.newCores[0], label: "Ratios", basis },
          { type: "mainline", coreId: request.newCores[0], basis },
          {
            type: "put",
            id: request.newUnits[0],
            coreId: request.newCores[0],
            meaning: { kind: "statement", text: clarification },
            dependencies: [],
            basis,
          },
        ],
        resolutions: [
          { obligation: subject.id, targets: [request.newUnits[0]], basis },
        ],
      },
    ],
    continuation: "NONE",
    reviewRequests: [],
    attentionCandidate: null,
  };
}

for (const initialFailure of [false, true])
  test(
    initialFailure
      ? "a persisted recovery failure stays visible after reload and Retry pending work completes it"
      : "a delayed source classification recovers already-accounted teacher text through Live and survives reload",
    async ({ page }) => {
      let releaseStage!: () => void;
      let failRecovery = initialFailure;
      const classification = new Promise<void>((resolve) => {
        releaseStage = resolve;
      });
      const requests: ProviderRequest[] = [];
      await page.route("**/api/v2/speech-token", (route) => route.abort());
      await page.route("**/api/v2/live", async (route) => {
        const request = route.request().postDataJSON() as ProviderRequest;
        requests.push(request);
        let raw: unknown;
        if (request.version === "v2-stage-request-6") {
          await classification;
          raw = {
            scope: request.scope,
            results: request.items.map((item) => ({
              item: item.id,
              outcome: "READY_FOR_LIVE",
            })),
          };
        } else if (request.source.role === "REVIEW")
          raw = failRecovery ? {} : recovered(request);
        else
          raw = {
            scope: request.scope,
            groups: [
              { outcome: "NO_CHANGE", throughBoundary: request.source.end },
            ],
            continuation: "NONE",
            reviewRequests: [],
            attentionCandidate: null,
          };
        await route.fulfill({
          contentType: "application/x-ndjson",
          body: response(raw),
        });
      });
      await page.goto(`/?services=real&session=${crypto.randomUUID()}`);
      const input = page.getByRole("textbox", { name: "Teacher text" });
      const submit = page.getByRole("button", { name: "Add to lesson" });
      let before!: { accounted: unknown; consumed: unknown };
      try {
        await input.fill(original);
        await submit.click();
        await expect
          .poll(
            () =>
              requests.filter(
                (request) => request.version === "v2-stage-request-6",
              ).length,
          )
          .toBe(1);
        await input.fill(clarification);
        await submit.click();
        await expect
          .poll(() =>
            page.evaluate(() => window.v2.session.replay.evidence.length),
          )
          .toBe(2);
        await expect
          .poll(() =>
            page.evaluate(() => window.v2.session.window.unaccountedChars),
          )
          .toBe(0);
        before = await page.evaluate(() => ({
          accounted: window.v2.session.replay.accounted,
          consumed: window.v2.session.replay.consumed,
        }));
        expect(
          await page.evaluate(() => Object.keys(window.v2.session.state.cores)),
        ).toEqual([]);
      } finally {
        releaseStage();
      }
      if (initialFailure) {
        await expect(page.getByRole("alert")).toContainText(
          "model-schema-invalid",
        );
        const calls = requests.length;
        await page.reload();
        await expect(page.getByRole("alert")).toContainText(
          "model-schema-invalid",
        );
        await expect(
          page.getByRole("button", { name: "Retry pending work" }),
        ).toBeVisible();
        expect(requests).toHaveLength(calls);
        failRecovery = false;
        await page.getByRole("button", { name: "Retry pending work" }).click();
      }
      const card = page
        .locator("[data-unit]")
        .filter({ hasText: clarification })
        .first();
      await expect(card).toBeVisible();
      const result = await page.evaluate(async () => {
        const session = window.v2.session;
        const events = await session.store.read(session.id);
        return {
          accounted: session.replay.accounted,
          consumed: session.replay.consumed,
          pending: Object.keys(session.replay.reviewConcerns),
          unresolved: Object.keys(session.replay.unresolved),
          processing: events.filter(
            (event) => event.type === "accepted" && event.accepted.processing,
          ).length,
          recoveries: events.filter(
            (event) => event.type === "accepted" && event.accepted.recovery,
          ).length,
          stageOperations: events.flatMap((event) =>
            event.type === "accepted" && event.accepted.lane === "Stage"
              ? event.accepted.operations
              : [],
          ),
        };
      });
      expect({
        accounted: result.accounted,
        consumed: result.consumed,
      }).toEqual(before);
      expect(result.pending).toEqual([]);
      expect(result.unresolved).toEqual([]);
      expect(result.processing).toBe(2);
      expect(result.recoveries).toBe(1);
      expect(result.stageOperations).toEqual([]);
      expect(
        requests.filter((request) => request.version === "v2-stage-request-6"),
      ).toHaveLength(1);
      expect(
        requests.filter(
          (request) =>
            request.version === "v2-live-request-5" &&
            request.source.role === "REVIEW",
        ),
      ).toHaveLength(initialFailure ? 2 : 1);
      await page.screenshot({
        path: `../../.cuelayer/v2/source-review-${initialFailure ? "retried" : "recovered"}.png`,
      });
      const calls = requests.length;
      await page.reload();
      await expect(card).toBeVisible();
      await page.waitForTimeout(100);
      expect(requests).toHaveLength(calls);
      expect(
        await page.evaluate(() => window.v2.session.replay.accounted),
      ).toEqual(before.accounted);
    },
  );
