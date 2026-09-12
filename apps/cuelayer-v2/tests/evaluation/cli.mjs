import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { prepare, verify, evaluatorRoot } from "./manifest.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";
import { drive } from "./driver.mjs";
import { exclusive, sha256, readJSON } from "./evidence.mjs";
import {
  jointSmoke,
  replayDisplay,
  prohibitProviderEgress,
} from "./browser.mjs";
import { assessJoint, assessCanary } from "./assessment.mjs";
import { replayResponse, replayEvents } from "./replay.mjs";
import { driverFaultProof } from "./faults.mjs";

const execute = promisify(execFile);
const option = (name, fallback) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const required = (name) => {
  const value = option(name);
  if (!value) throw Error(`--${name}=... is required`);
  return resolve(value);
};
export async function run() {
  const restore = prohibitProviderEgress();
  try {
    const command = process.argv[2];
    if (command === "prepare") {
      const out = required("out"),
        result = await prepare({
          productRoot: required("product"),
          out,
          development: process.argv.includes("--development"),
        });
      console.log(
        JSON.stringify({
          manifest: resolve(out, "manifest.json"),
          manifest_sha256: result.manifest_sha256,
          paid_enabled: false,
        }),
      );
      return;
    }
    if (command === "self-test") {
      const result = await execute(
        process.execPath,
        [
          "--test",
          resolve(
            evaluatorRoot,
            "apps/cuelayer-v2/tests/evaluation/self-test.mjs",
          ),
        ],
        { cwd: evaluatorRoot, maxBuffer: 8e6 },
      );
      console.log(result.stdout);
      return;
    }
    const path = required("manifest"),
      verified = await verify(path),
      root = resolve(path, ".."),
      { provenance, product, manifest } = verified;
    if (command === "verify") {
      console.log(
        JSON.stringify({
          status: "PASS",
          manifest_sha256: verified.manifest_sha256,
          paid_enabled: false,
        }),
      );
      return;
    }
    if (command === "assess") {
      const input = await readJSON(required("input")),
        scenarios = await loadScenarios();
      const result =
        input.identity === "gate3b-joint-evidence-1"
          ? assessJoint(
              product,
              scenarios.find((s) => s.scenario_id === input.scenario_id),
              input,
            )
          : input.oracle_reference
            ? assessCanary(
                product,
                [...scenarios, ...(await loadCanaryContracts())].find(
                  (s) => s.scenario_id === input.oracle_reference.scenario_id,
                ),
                input,
              )
            : replayResponse(product, input);
      if (input.provenance) provenance.verifyRecorded(input.provenance);
      await exclusive(required("out"), {
        manifest_sha256: verified.manifest_sha256,
        ...result,
      });
      console.log(
        JSON.stringify({
          status: result.status ?? "see-layer-results",
          provider_invocations: 0,
        }),
      );
      return;
    }
    if (command === "replay-display") {
      const input = await readJSON(required("input"));
      if (input.provenance) provenance.verifyRecorded(input.provenance);
      const r = await replayDisplay(
        provenance,
        product,
        input,
        required("out"),
      );
      console.log(
        JSON.stringify({
          request_count: r.request_count,
          provider_invocations: 0,
          limitation: r.limitation,
        }),
      );
      return;
    }
    if (command === "replay-events") {
      const input = await readJSON(required("input"));
      const result = await replayEvents(
        product,
        input.snapshot?.events ?? input.events,
        { timed: true },
      );
      await exclusive(required("out"), result);
      console.log(
        JSON.stringify({ status: result.status, provider_invocations: 0 }),
      );
      return;
    }
    if (command !== "preflight")
      throw Error(
        "paid execution is disabled; this evaluator implements unpaid preparation, assessment and replay only",
      );
    await exclusive(resolve(root, "preflight-start.json"), {
      manifest_sha256: verified.manifest_sha256,
      started_at: new Date().toISOString(),
      provider_invocations: 0,
    });
    console.log(
      "Unpaid preflight started. Full 600-second empty-receiver baseline and browser evidence are required.",
    );
    const baselineTask = drive(
      Array.from({ length: 600 }, (_, i) => ({
        event_id: `tick-${i}`,
        at_ms: i * 1000,
        text: "empty-receiver timing probe",
      })),
      600000,
      (row) => ({ received_at: performance.timeOrigin + performance.now() }),
    );
    const selfTestTask = execute(
      process.execPath,
      [
        "--test",
        resolve(
          evaluatorRoot,
          "apps/cuelayer-v2/tests/evaluation/self-test.mjs",
        ),
      ],
      { cwd: evaluatorRoot, maxBuffer: 8e6 },
    );
    const browserTask = (async () => {
      const scenario = (await loadScenarios()).find(
        (s) => s.scenario_id === "mathematics",
      );
      const joint = await jointSmoke(
        provenance,
        product,
        scenario,
        resolve(root, "joint-stub"),
      );
      const assessment = assessJoint(product, scenario, joint);
      await exclusive(resolve(root, "joint-assessment.json"), assessment);
      const display = await replayDisplay(
        provenance,
        product,
        joint,
        resolve(root, "display-isolation"),
      );
      const recovery = await replayEvents(product, joint.snapshot.events, {
        timed: true,
      });
      await exclusive(resolve(root, "event-replay.json"), recovery);
      const faults = await driverFaultProof(
        provenance,
        product,
        resolve(root, "fault-proof"),
      );
      return { assessment, display, recovery, faults };
    })();
    const settled = await Promise.allSettled([
      baselineTask,
      selfTestTask,
      browserTask,
    ]);
    const [baseline, selfTest, browser] = settled;
    if (baseline.status === "fulfilled")
      await exclusive(resolve(root, "driver-baseline.json"), {
        identity: "600s-empty-receiver-1",
        dependency_mode: "STUB",
        driver_sha256:
          manifest.evaluator_files[
            "apps/cuelayer-v2/tests/evaluation/driver.mjs"
          ],
        ...baseline.value,
      });
    await exclusive(
      resolve(root, "self-tests.json"),
      selfTest.status === "fulfilled"
        ? { status: "PASS", ...selfTest.value }
        : {
            status: "FAIL",
            error: selfTest.reason.message,
            stdout: selfTest.reason.stdout ?? null,
          },
    );
    const checks = {
      self_tests: selfTest.status === "fulfilled" ? "PASS" : "FAIL",
      driver:
        baseline.status === "fulfilled"
          ? baseline.value.fidelity.status
          : "INVALID",
      joint_capture:
        browser.status === "fulfilled"
          ? browser.value.assessment.status
          : "FAIL",
      display_isolation:
        browser.status === "fulfilled"
          ? browser.value.display.status
          : "NOT_EXERCISED",
      event_replay:
        browser.status === "fulfilled"
          ? browser.value.recovery.status
          : "NOT_EXERCISED",
      fault_attribution:
        browser.status === "fulfilled"
          ? browser.value.faults.status
          : "NOT_EXERCISED",
    };
    const report = {
      gate: "3b-0",
      status: Object.values(checks).every((s) => s === "PASS")
        ? "PASS"
        : Object.values(checks).includes("FAIL")
          ? "FAIL"
          : "INVALID",
      checks,
      manifest_sha256: verified.manifest_sha256,
      provider_invocations: 0,
      cost_usd: 0,
      paid_phases: manifest.cohort,
      rejected_tasks: settled.flatMap((s, i) =>
        s.status === "rejected" ? [{ check: i, error: s.reason.message }] : [],
      ),
      finished_at: new Date().toISOString(),
      interpretation:
        "Preflight tests the evaluator with STUB/RECORDED evidence. It does not establish real-provider product acceptance. Gate 3a remains FAILED.",
    };
    await verify(path);
    await exclusive(resolve(root, "preflight-result.json"), report);
    console.log(JSON.stringify(report));
    if (report.status !== "PASS") process.exitCode = 1;
  } finally {
    restore();
  }
}
