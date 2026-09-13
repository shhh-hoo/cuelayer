import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluatorRoot } from "../manifest.mjs";
import { git } from "../provenance.mjs";
import { sha256 } from "../evidence.mjs";
import { loadMicroCorpus } from "./contract.mjs";
import {
  loadCandidateProposal,
  prepareQualification,
  verifyQualification,
  validateQualificationGrid,
} from "./manifest.mjs";
import {
  createQualificationScope,
  QUALIFICATION_APPROVAL_IDENTITY,
} from "./guard.mjs";
import { runQualification } from "./execute.mjs";

const execute = promisify(execFile);
const productRoot =
  process.env.GATE3B_QUALIFICATION_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-terminal-review57");
const productSha = git(productRoot, "rev-parse", "HEAD");
let temporary, baseline, manifest, verified, availability;
const encode = (value) => JSON.stringify(value, null, 2) + "\n";
const readJSON = async (path) => JSON.parse(await readFile(path, "utf8"));

before(async () => {
  temporary = await mkdtemp(
    resolve(tmpdir(), "cuelayer-qualification-manifest-test-"),
  );
  const proposal = await loadCandidateProposal();
  // Fabricated metadata proves only the offline fixture path. It is never an
  // account availability claim or an authorization artifact for a paid run.
  availability = [...new Set(proposal.candidates.map((c) => c.model))].map(
    (model) => ({
      requested: model,
      status: 200,
      returned_model: model,
      test_only: true,
    }),
  );
  baseline = resolve(temporary, "baseline");
  ({ manifest } = await prepareQualification({
    productRoot,
    productSha,
    out: baseline,
    availability,
    development: true,
  }));
  verified = await verifyQualification(
    resolve(baseline, "qualification-manifest.json"),
    { allowDevelopment: true },
  );
});
after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function seal(path, value) {
  const bytes = encode(value);
  await writeFile(path, bytes);
  await writeFile(
    resolve(path, "../qualification-manifest-seal.json"),
    encode({ object_sha256: sha256(value), file_sha256: sha256(bytes) }),
  );
}
async function copyFixture(label) {
  const out = resolve(temporary, label);
  await mkdir(resolve(out, "snapshots"), { recursive: true });
  const value = structuredClone(manifest);
  value.execution_directory = out;
  for (const file of value.snapshots) {
    const bytes = await readFile(file.path);
    file.path = resolve(out, "snapshots", file.snapshot_id + ".json");
    await writeFile(file.path, bytes);
  }
  const path = resolve(out, "qualification-manifest.json");
  await seal(path, value);
  return { out, path, manifest: value };
}
async function rewriteSnapshot(fixture, index, change) {
  const file = fixture.manifest.snapshots[index],
    snapshot = await readJSON(file.path);
  await change(snapshot);
  const bytes = encode(snapshot);
  await writeFile(file.path, bytes);
  file.file_sha256 = sha256(bytes);
  file.object_sha256 = sha256(snapshot);
  await seal(fixture.path, fixture.manifest);
}
const verifyDevelopment = (path) =>
  verifyQualification(path, { allowDevelopment: true });

test("actual product capture prepares and verifies all 26 cases and the exact 312-trial grid", async () => {
  const corpus = await loadMicroCorpus(),
    cases = corpus.pairs.flatMap((pair) => pair.cases);
  assert.equal(manifest.product_sha, productSha);
  assert.equal(manifest.freeze_status, "DEVELOPMENT");
  assert.equal(manifest.paid_enabled, false);
  assert.equal(verified.snapshots.length, 26);
  assert.equal(
    validateQualificationGrid(manifest, verified.snapshots).length,
    312,
  );
  assert.equal(
    new Set(
      manifest.trials.map((t) =>
        [t.snapshot_id, t.candidate_id, t.repetition].join("|"),
      ),
    ).size,
    312,
  );
  for (const snapshot of verified.snapshots) {
    const specification = cases.find((c) => c.case_id === snapshot.snapshot_id);
    assert.deepEqual(
      snapshot.prestate.evidence.map((e) => ({ event_id: e.id, text: e.text })),
      specification.evidence,
    );
    assert.equal(snapshot.generation.production_capture, true);
    assert.equal(snapshot.generation.production_builder, true);
    assert.equal(snapshot.provider_invocations, 0);
    assert.deepEqual(snapshot.oracle, specification.oracle);
    assert.equal(sha256(snapshot.payload), snapshot.payload_sha256);
  }
});

test("development manifests cannot pass paid verification or enable even a matching test-only approval", async () => {
  await assert.rejects(
    () => verifyQualification(resolve(baseline, "qualification-manifest.json")),
    /qualification-manifest-drift/,
  );
  const syntheticApproval = {
    identity: QUALIFICATION_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256(manifest),
    limits_sha256: sha256(manifest.proposed_limits),
  };
  assert.throws(
    () =>
      createQualificationScope(manifest, syntheticApproval, {
        openai: "offline-only",
      }),
    /qualification-not-frozen/,
  );
});

test("prepare requires a full product commit and metadata for every included model", async () => {
  await assert.rejects(
    () =>
      prepareQualification({
        productRoot,
        productSha: productSha.slice(0, 7),
        out: resolve(temporary, "abbreviated"),
        availability,
        development: true,
      }),
    /explicit-full-product-sha-required/,
  );
  for (const model of availability.map((a) => a.requested)) {
    await assert.rejects(
      () =>
        prepareQualification({
          productRoot,
          productSha,
          out: resolve(temporary, "missing-" + model),
          availability: availability.filter((a) => a.requested !== model),
          development: true,
        }),
      /qualification-model-metadata-required/,
    );
  }
});

test("grid rejects missing cases, duplicate logical trials, reordering and changed candidate payloads", () => {
  for (const mutate of [
    (m) => m.trials.pop(),
    (m) =>
      (m.trials[1] = {
        ...m.trials[0],
        trial_id: "different-id-same-logical-trial",
      }),
    (m) => m.trials.reverse(),
    (m) => (m.trials[0].repetition = 3),
    (m) => (m.trials[0].candidate_id = "unplanned"),
    (m) => (m.trials[0].payload_sha256 = sha256("different-schema")),
    (m) => (m.trials[0].input_tokens_upper_bound = 1),
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(
      () => validateQualificationGrid(changed, verified.snapshots),
      /qualification-trial-grid-drift/,
    );
  }
  assert.throws(
    () => validateQualificationGrid(manifest, verified.snapshots.slice(1)),
    /qualification-snapshot-grid/,
  );
  const duplicate = [...verified.snapshots];
  duplicate[1] = duplicate[0];
  assert.throws(
    () => validateQualificationGrid(manifest, duplicate),
    /qualification-snapshot-grid/,
  );
});

test("manifest bytes and snapshot bytes remain bound to their original seals", async () => {
  const changedManifest = await copyFixture("changed-manifest-bytes");
  changedManifest.manifest.product_sha = "f".repeat(40);
  await writeFile(changedManifest.path, encode(changedManifest.manifest));
  await assert.rejects(
    () => verifyDevelopment(changedManifest.path),
    /qualification-manifest-drift/,
  );
  const changedSnapshot = await copyFixture("changed-snapshot-bytes");
  await writeFile(changedSnapshot.manifest.snapshots[0].path, "{}\n");
  await assert.rejects(
    () => verifyDevelopment(changedSnapshot.path),
    /qualification-snapshot-drift/,
  );
});

test("resealing a test artifact cannot substitute another corpus, product or evaluator identity", async () => {
  const mutations = [
    [
      "corpus",
      (m) => (m.corpus.corpus_sha256 = sha256("another-corpus")),
      /qualification-corpus-or-proposal-drift/,
    ],
    [
      "proposal",
      (m) => (m.proposal_sha256 = sha256("another-proposal")),
      /qualification-corpus-or-proposal-drift/,
    ],
    [
      "product",
      (m) => (m.product_sha = "f".repeat(40)),
      /product-sha-mismatch/,
    ],
    [
      "evaluator",
      (m) => (m.evaluator_sha = "f".repeat(40)),
      /qualification-manifest-drift/,
    ],
    [
      "expired",
      (m) => (m.expires_at = "2000-01-01T00:00:00.000Z"),
      /qualification-manifest-expired/,
    ],
  ];
  for (const [label, mutate, expected] of mutations) {
    const changed = await copyFixture("identity-" + label);
    mutate(changed.manifest);
    await seal(changed.path, changed.manifest);
    await assert.rejects(
      () => verifyDevelopment(changed.path),
      expected,
      label,
    );
  }
});

test("recomputed file hashes cannot hide a changed source payload or accepted prestate", async () => {
  const cases = [
    [
      "source",
      (s) => {
        s.request.source.text += " Unapproved added source.";
      },
    ],
    [
      "payload",
      (s) => {
        s.payload.input[0].content += " Altered policy.";
      },
    ],
    [
      "prestate",
      (s) => {
        s.prestate.accounted = { sequence: 1, offset: 1 };
      },
    ],
  ];
  for (const [label, change] of cases) {
    const changed = await copyFixture("binding-" + label);
    await rewriteSnapshot(changed, 0, change);
    await assert.rejects(
      () => verifyDevelopment(changed.path),
      /qualification-product-binding-drift/,
      label,
    );
  }
});

test("oracle substitution and snapshot path escape are rejected independently of file hashes", async () => {
  const oracle = await copyFixture("changed-oracle");
  await rewriteSnapshot(oracle, 0, (s) => {
    s.oracle.required[0].claim = "Changed semantic expectation.";
  });
  await assert.rejects(
    () => verifyDevelopment(oracle.path),
    /qualification-snapshot-oracle-drift/,
  );
  const path = await copyFixture("escaped-snapshot-path");
  path.manifest.snapshots[0].path = manifest.snapshots[0].path;
  await seal(path.path, path.manifest);
  await assert.rejects(
    () => verifyDevelopment(path.path),
    /qualification-snapshot-path-drift/,
  );
});

test("missing or mismatched approval reaches no dispatch on the actual qualification execution entry", async () => {
  // This in-memory synthetic fixture is intentionally not accepted by the file
  // verifier. It isolates the execution authorization gate with real captures.
  const synthetic = {
    ...verified,
    manifest: { ...structuredClone(manifest), freeze_status: "FROZEN" },
    out: resolve(temporary, "never-started"),
  };
  const mismatched = {
    identity: QUALIFICATION_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256("wrong-manifest"),
    limits_sha256: sha256(manifest.proposed_limits),
  };
  let dispatches = 0;
  const transport = () => {
    dispatches++;
    throw Error("offline-unexpected-dispatch");
  };
  for (const approval of [
    undefined,
    mismatched,
    { ...mismatched, approved: false },
  ]) {
    await assert.rejects(
      () =>
        runQualification(
          synthetic,
          approval,
          transport,
          { openai: "offline-only" },
          { mode: "STUB" },
        ),
      /qualification-approval-mismatch/,
    );
  }
  assert.equal(dispatches, 0);
});

async function isolatedCLI(args, label) {
  const report = resolve(temporary, label + "-egress.json"),
    preload = resolve(temporary, label + "-preload.mjs");
  await writeFile(
    preload,
    `import { Socket } from 'node:net';\nimport { writeFileSync } from 'node:fs';\nlet attempts=0;\nconst deny=()=>{attempts++;throw Error('offline-egress-denied');};\nglobalThis.fetch=deny;\nSocket.prototype.connect=deny;\nprocess.on('exit',()=>writeFileSync(${JSON.stringify(report)},JSON.stringify({attempts})));\n`,
  );
  let result;
  try {
    const output = await execute(
      process.execPath,
      [
        "--import",
        pathToFileURL(preload).href,
        resolve(
          evaluatorRoot,
          "apps/cuelayer-v2/scripts/evaluate-frontier.mjs",
        ),
        ...args,
      ],
      {
        cwd: evaluatorRoot,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: tmpdir(),
        },
        maxBuffer: 2e6,
      },
    );
    result = { ...output, code: 0 };
  } catch (error) {
    result = {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
  assert.equal((await readJSON(report)).attempts, 0);
  return result;
}

test("CLI preparation produces real product snapshots with zero fetch or socket egress", async () => {
  const metadataPath = resolve(temporary, "test-only-model-metadata.json");
  await writeFile(metadataPath, encode(availability));
  const result = await isolatedCLI(
    [
      "prepare-qualification",
      "--product=" + productRoot,
      "--product-sha=" + productSha,
      "--out=" + resolve(temporary, "cli-prepared"),
      "--availability=" + metadataPath,
      "--development",
    ],
    "prepare-cli",
  );
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.paid_enabled, false);
  assert.equal(output.provider_invocations, 0);
  const prepared = await readJSON(
    resolve(temporary, "cli-prepared/qualification-manifest.json"),
  );
  assert.equal(prepared.snapshots.length, 26);
  assert.equal(prepared.trials.length, 312);
  assert.equal(prepared.freeze_status, "DEVELOPMENT");
});

test("CLI rejects missing authorization before any fetch or socket attempt", async () => {
  const result = await isolatedCLI(
    [
      "execute-qualification",
      "--manifest=" + resolve(baseline, "qualification-manifest.json"),
    ],
    "missing-authorization-cli",
  );
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /qualification-execution-options/);
});

test("expired intact evidence remains reviewable but cannot start live execution", async () => {
  const expired = await copyFixture("expired-offline-review");
  expired.manifest.expires_at = "2000-01-01T00:00:00.000Z";
  await seal(expired.path, expired.manifest);
  await assert.rejects(
    () => verifyDevelopment(expired.path),
    /qualification-manifest-expired/,
  );
  const historical = await verifyQualification(expired.path, {
    allowDevelopment: true,
    allowExpired: true,
  });
  assert.equal(historical.snapshots.length, 26);
  assert.equal(historical.manifest_sha256, sha256(expired.manifest));

  // An intentionally expired test-only frame exercises the CLI's expiry gate
  // before it can consult authorization, account credentials or the network.
  // This is not a reviewed/frozen cohort and no approval file is created.
  expired.manifest.freeze_status = "FROZEN";
  await seal(expired.path, expired.manifest);
  const result = await isolatedCLI(
    [
      "execute-qualification",
      "--manifest=" + expired.path,
      "--authorization=" + resolve(temporary, "no-paid-authorization.json"),
    ],
    "expired-execution-cli",
  );
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /qualification-manifest-expired/);
});

test("offline CLI exports and imports bound reviews without changing the expired source results", async () => {
  const historical = await copyFixture("review-cli-lifecycle");
  historical.manifest.expires_at = "2000-01-01T00:00:00.000Z";
  await seal(historical.path, historical.manifest);
  const snapshot = verified.snapshots.find(
    (s) => s.snapshot_id === "ordinary-administration",
  );
  const task = snapshot.task;
  const response = {
    scope: task.capture.namespace,
    groups: [
      { outcome: "NO_CHANGE", throughBoundary: snapshot.request.source.end },
    ],
    suffixStatus: "NONE",
    contextRequest: null,
    reviewRequests: [],
    attentionCandidate: null,
  };
  const accepted = verified.product.acceptance.validate(
    snapshot.prestate,
    task,
    response,
  );
  const sequence = snapshot.prestate.sequence + 1;
  const poststate = verified.product.contract.fold(snapshot.prestate, {
    ...verified.product.acceptanceEvent.decisionEventPayload(task, accepted),
    schema: "cuelayer-v2-event-3",
    sessionId: task.sessionId,
    id: task.sessionId + ":" + sequence,
    sequence,
    at: Date.now(),
  });
  const selected = historical.manifest.trials.find(
    (t) => t.snapshot_id === snapshot.snapshot_id,
  );
  const rows = historical.manifest.trials.map((trial) => ({
    ...trial,
    case_id: trial.snapshot_id,
    status: "NOT_RUN",
    provider_attempt_count: 0,
    real_provider_attempt_count: 0,
    ...(trial.trial_id === selected.trial_id
      ? {
          status: null,
          dependency_mode: "STUB",
          provider_attempt_count: 1,
          parser: { success: true, value: response },
          poststate,
          attempts: [{ host_accepted: true, parser_succeeded: true }],
        }
      : {}),
  }));
  const input = {
    identity: "cuelayer-v2-semantic-qualification-results-1",
    manifest_sha256: sha256(historical.manifest),
    rows,
    test_only:
      "Offline review plumbing with one authored accepted administration response.",
  };
  const inputPath = resolve(historical.out, "qualification-results.json");
  const originalBytes = encode(input);
  await writeFile(inputPath, originalBytes);
  await writeFile(
    resolve(historical.out, "qualification-results-seal.json"),
    encode({ object_sha256: sha256(input) }),
  );
  const packetPath = resolve(historical.out, "review-packet.json");
  const common = [
    "--manifest=" + historical.path,
    "--input=" + inputPath,
    "--development",
  ];
  const exported = await isolatedCLI(
    ["export-qualification-review", ...common, "--out=" + packetPath],
    "export-review-cli",
  );
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(JSON.parse(exported.stdout.trim()).provider_invocations, 0);
  const packet = await readJSON(packetPath);
  assert.equal(packet.manifest_sha256, sha256(historical.manifest));
  assert.equal(packet.trials.length, 1);
  const entry = packet.trials[0];
  assert.equal(entry.trial_id, selected.trial_id);
  assert.equal(
    entry.response_sha256,
    sha256(rows.find((r) => r.trial_id === selected.trial_id)),
  );
  const submission = {
    identity: "cuelayer-v2-semantic-adjudication-1",
    manifest_sha256: packet.manifest_sha256,
    oracle_sha256: packet.oracle_sha256,
    adjudicator: "Offline administration fixture reviewer",
    reviews: [
      {
        trial_id: entry.trial_id,
        response_sha256: entry.response_sha256,
        bindings: {},
        decisions: entry.required_decisions.map((check) => ({
          id: check.id,
          verdict: "PASS",
          reason:
            "The authored administration response accounts for page navigation without adding lesson knowledge.",
          evidence_refs: check.evidence_refs,
          output_paths: ["/parser/value", "/poststate"],
        })),
      },
    ],
  };
  const adjudicationPath = resolve(historical.out, "offline-adjudication.json");
  await writeFile(adjudicationPath, encode(submission));
  const reviewedPath = resolve(historical.out, "reviewed-results.json");
  const imported = await isolatedCLI(
    [
      "import-qualification-review",
      ...common,
      "--adjudication=" + adjudicationPath,
      "--out=" + reviewedPath,
    ],
    "import-review-cli",
  );
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout.trim()).provider_invocations, 0);
  const reviewed = await readJSON(reviewedPath);
  assert.equal(reviewed.source_results_sha256, sha256(input));
  assert.equal(reviewed.adjudication_sha256, sha256(submission));
  assert.equal(reviewed.rows.length, 312);
  assert.equal(reviewed.rows.filter((r) => r.status === "NOT_RUN").length, 311);
  assert.equal(
    reviewed.rows.find((r) => r.trial_id === selected.trial_id).semantic_scores
      .knowledge_mutation,
    "PASS",
  );
  assert.equal(await readFile(inputPath, "utf8"), originalBytes);
});
