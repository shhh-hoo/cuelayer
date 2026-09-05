import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4 } from "../src/lesson-stream/semantic-profile.ts";
import { persistedAuditDigest } from "../src/trace/audit.ts";
import { teachingProviderContract } from "../server/teaching/provider-contract.ts";
import type { SemanticCorpusCaseV3 } from "../server/teaching/semantic-evaluation-v3.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v3Path = resolve(root, "resources/semantics/v3/alpha-sequences.jsonl");
const v3 = readFileSync(v3Path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as SemanticCorpusCaseV3);
const formulaAliases: Record<string, string[]> = {
  "augment-aluminium-dimer": ["al2cl6"],
  "augment-ammonium-charge": ["nh4+"],
  "augment-carbonate-charge": ["co32-"],
  "augment-activation-energy-symbol": ["ea"],
  "augment-enthalpy-symbol": ["dh", "delta h", "δh"],
};

const cases = v3.map((source) => {
  const item = JSON.parse(JSON.stringify(source).replaceAll("SEM3-", "SEM4-")) as SemanticCorpusCaseV3;
  for (const gold of Object.values(item.goldByProfile)) {
    if (item.scenario === "note-with-active") {
      gold.finalState.boardActive = { entities: [["dynamic equilibrium"]] };
      gold.finalState.support = [{ entities: [["forward", "both reaction"], ["reverse", "both reaction"], ["rate", "rates"], ["equal", "equals", "match", "matches"]] }];
    }
    const formula = formulaAliases[item.scenario];
    if (formula && gold.finalState.support !== "INITIAL" && Array.isArray(gold.finalState.support) && gold.finalState.support.length) {
      gold.finalState.support = [{ requiredLexical: [formula] }];
    }
    if (item.scenario === "hint-with-support") {
      for (const predicate of [gold.semantic, gold.finalState.cue === "INITIAL" || gold.finalState.cue === null ? undefined : gold.finalState.cue.content]) {
        for (const group of predicate?.entities ?? []) if (group.includes("compare") && !group.includes("comparing")) group.push("comparing");
      }
    }
  }
  return item;
});

const jsonl = `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`;
const outputDir = resolve(root, "resources/semantics/v4");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "alpha-sequences.jsonl"), jsonl);
const profileManifest = (profile: typeof ALPHA_CORE_P4 | typeof ALPHA_AUGMENT_CANDIDATE_P4) => {
  const contract = teachingProviderContract(profile);
  return { profileVersion: profile.id, policyVersion: profile.policyVersion, policyDigest: persistedAuditDigest(contract.systemPolicy), schemaDigest: persistedAuditDigest(contract.text.format) };
};
const scenarioPairs = Object.fromEntries([...new Set(cases.map((item) => item.scenario))].map((scenario) => [scenario, {
  development: cases.filter((item) => item.scenario === scenario && item.split === "development").map((item) => item.id),
  holdout: cases.filter((item) => item.scenario === scenario && item.split === "holdout").map((item) => item.id),
}]));
const categoryCounts = Object.fromEntries([...new Set(cases.flatMap((item) => item.tags))].sort().map((tag) => [tag, cases.filter((item) => item.tags.includes(tag)).length]));
const manifest = {
  corpusVersion: "alpha-semantics-corpus-v4", evaluatorVersion: "alpha-semantics-evaluator-v4", caseCount: cases.length,
  splitMembership: { development: cases.filter((item) => item.split === "development").map((item) => item.id), holdout: cases.filter((item) => item.split === "holdout").map((item) => item.id) },
  scenarioPairs, categoryCounts, fileSha256: createHash("sha256").update(jsonl).digest("hex"),
  core: profileManifest(ALPHA_CORE_P4), augment: profileManifest(ALPHA_AUGMENT_CANDIDATE_P4), creationTimestamp: "2026-09-05T00:30:00.000Z",
};
writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${cases.length} v4 cases (40 development / 20 holdout) sha256=${manifest.fileSha256}`);
