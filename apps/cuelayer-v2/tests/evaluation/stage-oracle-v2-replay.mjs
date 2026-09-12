import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Provenance } from "./provenance.mjs";
import { evaluatorRoot } from "./manifest.mjs";
import { loadExecutionProduct } from "./execution-manifest.mjs";
import { REPAIR_PRODUCT_SHA, REPAIR_PROFILE } from "./repair-manifest.mjs";
import { assessCanary } from "./assessment.mjs";
import { loadCanaryContracts } from "./assets.mjs";
import { readJSON, Budget } from "./evidence.mjs";
import { prohibitProviderEgress } from "./browser.mjs";

const restore = prohibitProviderEgress();
const product = await loadExecutionProduct(
  new Provenance(
    process.env.GATE3B_REPAIR_PRODUCT_ROOT ??
      resolve(evaluatorRoot, "../cuelayer-v2-model-repair"),
    evaluatorRoot,
    { productSha: REPAIR_PRODUCT_SHA, allowDirtyEvaluator: true },
  ),
);
const saved = resolve(
  process.env.GATE3B_SAVED_RUN ??
    resolve(
      evaluatorRoot,
      "../cuelayer-v2-evaluation/.cuelayer/v2/gate3b/canary-e84540e-prepared-20260913",
    ),
);
const parent = await readJSON(resolve(saved, "execution-manifest.json"));
const snapshot = await readJSON(
  parent.canaries.find((c) => c.snapshot_id === "stage-clarified").path,
);
const recorded = await readJSON(resolve(saved, "stage-clarified/result.json"));
const v2 = (await loadCanaryContracts()).find(
  (s) => s.scenario_id === "stage-clarified",
);
const v1 = JSON.parse(
  await readFile(
    new URL("./canaries/history/stage-clarified.v1.json", import.meta.url),
  ),
);
function replay(response, scenario = v2) {
  const prestate = structuredClone(snapshot.prestate);
  let poststate = prestate,
    events = [];
  try {
    const accepted = product.stage.validateStage(
      prestate,
      snapshot.task,
      response,
    ).accepted;
    const envelope = recorded.events.find(
      (e) => e.type === "accepted" && e.accepted.taskId === snapshot.task.id,
    );
    const event = { ...envelope, accepted };
    poststate = product.contract.fold(prestate, event);
    events = [event];
  } catch {
    /* actual fail-closed rejection is assessed separately from semantic correctness */
  }
  return assessCanary(product, scenario, {
    ...snapshot,
    prestate,
    response,
    events,
    poststate,
    dependency_mode: "RECORDED",
  });
}
const response = recorded.parser.value;
test("saved real clarification preserves v1 FAIL and passes the v2 proposition oracle", () => {
  assert.equal(replay(response, v1).phase_status, "FAIL");
  assert.equal(recorded.status, "FAIL");
  assert.equal(replay(response).phase_status, "PASS");
});
test("both legal proposition representations preserve the same roles and resolution", () => {
  const r = structuredClone(response);
  r.results[0].operations[0].meaning = {
    kind: "annotation",
    target: "u0",
    text: r.results[0].operations[0].meaning.text,
  };
  assert.equal(replay(r).phase_status, "PASS");
});
for (const [name, mutate] of [
  [
    "reversed endpoints",
    (r) => {
      r.results[0].operations[0].meaning.text =
        "Total pressure determines the mole fraction.";
    },
  ],
  [
    "unsupported assertion",
    (r) => {
      r.results[0].operations[0].meaning.text +=
        " It also doubles temperature.";
    },
  ],
  [
    "lost provenance",
    (r) => {
      r.results[0].operations[0].basis =
        r.results[0].operations[0].basis.filter((b) => b.source === "s0");
    },
  ],
  [
    "unresolved obligation",
    (r) => {
      r.results = [{ item: "r0", outcome: "STILL_OPEN" }];
    },
  ],
  [
    "lost identity binding",
    (r) => {
      r.results[0].operations[0].dependencies = [];
    },
  ],
])
  test("saved-response counterexample fails: " + name, () => {
    const r = structuredClone(response);
    mutate(r);
    const result = replay(r);
    assert.equal(result.phase_status, "FAIL");
    assert.equal(
      result.results.find((x) => x.expectation_id === "stage-meaning").status,
      "FAIL",
    );
  });
test("repair authorization lowers caps to US$1 and 12 attempts without releasing missing usage", () => {
  const b = new Budget(REPAIR_PROFILE);
  const id = b.reserve();
  b.settle(id, null, "gpt-5.6-luna");
  assert.equal(b.cost(), 0.54);
  assert.throws(() => b.reserve(), /budget-exhausted/);
  const c = new Budget(REPAIR_PROFILE);
  for (let i = 0; i < 12; i++)
    c.settle(
      c.reserve(),
      { input_tokens: 1, output_tokens: 1 },
      "gpt-5.6-luna",
    );
  assert.throws(() => c.reserve(), /budget-exhausted/);
});
test.after(() => restore());
