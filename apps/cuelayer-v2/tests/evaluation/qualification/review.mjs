import { resolve } from "node:path";
import { readJSON, exclusive, sha256 } from "../evidence.mjs";
import { verifyQualification } from "./manifest.mjs";
import { exportReviewPacket, importAdjudication } from "./adjudication.mjs";
import { summarizeQualification } from "./report.mjs";

export async function reviewQualification({
  manifestPath,
  inputPath,
  out,
  adjudicationPath = null,
  development = false,
}) {
  const verified = await verifyQualification(manifestPath, {
    allowExpired: true,
    allowDevelopment: development,
  });
  const input = await readJSON(inputPath),
    seal = await readJSON(
      resolve(inputPath, "../qualification-results-seal.json"),
    );
  if (
    input.identity !== "cuelayer-v2-semantic-qualification-results-1" ||
    input.manifest_sha256 !== verified.manifest_sha256 ||
    sha256(input) !== seal.object_sha256 ||
    !Array.isArray(input.rows) ||
    input.rows.length !== verified.manifest.trials.length
  )
    throw Error("qualification-result-binding-drift");
  summarizeQualification(verified.manifest, input.rows); // Validate unique result identities against the whole frozen grid.
  let result;
  if (adjudicationPath) {
    const submission = await readJSON(adjudicationPath),
      rows = importAdjudication(verified, input.rows, submission);
    result = {
      identity: "cuelayer-v2-semantic-reviewed-results-1",
      manifest_sha256: verified.manifest_sha256,
      source_results_sha256: sha256(input),
      adjudication_sha256: sha256(submission),
      rows,
      summary: summarizeQualification(verified.manifest, rows),
    };
  } else result = exportReviewPacket(verified, input.rows);
  await exclusive(out, result);
  return result;
}
