import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type EvalCase = {
  caseId: string;
  contentFamily: string;
  inputForm: string;
  transcript: string;
  approvedContext: unknown;
  policyDecisions: string[];
  factsToPreserve: string[];
  preferredConventions: string[];
  allowedTransformations: string[];
  forbiddenInferences: string[];
  ambiguityPolicy: string;
};

type BlindCase = Pick<EvalCase, 'caseId' | 'transcript' | 'approvedContext'>;
type Batch = { name: string; cases: EvalCase[] };

const seed = '9701-round-1-v1';
const batchNames = ['a', 'b', 'c', 'd'];
const targetedRegressionCaseIds = ['C004', 'C006', 'C009', 'C010', 'C013', 'C019', 'C027', 'C031', 'C033', 'C037', 'C054', 'C059'];
const privateReviewKeys = [
  'contentFamily',
  'inputForm',
  'policyDecisions',
  'factsToPreserve',
  'preferredConventions',
  'allowedTransformations',
  'forbiddenInferences',
  'ambiguityPolicy',
] as const;
const requiredFields: Array<keyof EvalCase> = [
  'caseId', 'contentFamily', 'inputForm', 'transcript', 'approvedContext', 'policyDecisions',
  'factsToPreserve', 'preferredConventions', 'allowedTransformations', 'forbiddenInferences', 'ambiguityPolicy',
];
const root = resolve(import.meta.dirname, '..');
const skillRoot = resolve(root, 'skills/9701-cuecaption');
const caseFile = resolve(skillRoot, 'eval/cases-round-1.jsonl');
const generatedRoot = resolve(skillRoot, 'eval/generated');

function parseMode(args: string[]): 'round-one' | 'targeted-regression' {
  if (args.length === 0) return 'round-one';
  if (args.length === 1 && args[0] === '--targeted-regression') return 'targeted-regression';
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node --experimental-strip-types scripts/build-9701-eval-prompt.ts [--targeted-regression]');
    process.exit(0);
  }
  throw new Error('Use no arguments for all Round 1 batches, or --targeted-regression for the fixed blind regression batch.');
}

function seededNumber(value: string): number {
  let hash = 2166136261;
  for (const character of `${seed}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicShuffle<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => seededNumber(key(left)) - seededNumber(key(right)));
}

function distributeTargets(values: string[]): Map<string, number[]> {
  const targets = new Map<string, number[]>();
  for (const value of [...new Set(values)].sort()) {
    const count = values.filter((candidate) => candidate === value).length;
    const quotas = Array.from({ length: batchNames.length }, () => Math.floor(count / batchNames.length));
    const order = deterministicShuffle(batchNames, (name) => `${value}:${name}`);
    for (let index = 0; index < count % batchNames.length; index += 1) quotas[batchNames.indexOf(order[index])] += 1;
    targets.set(value, quotas);
  }
  return targets;
}

function isStressCase(item: EvalCase): boolean {
  return ['C055', 'C056', 'C057', 'C058', 'C059', 'C060'].includes(item.caseId);
}

function parseCases(source: string): EvalCase[] {
  const cases = source.trim().split('\n').filter(Boolean).map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`Invalid JSONL at line ${index + 1}`); }
    if (!value || typeof value !== 'object') throw new Error(`Case ${index + 1} is not an object`);
    for (const field of requiredFields) if (!(field in value)) throw new Error(`Case ${index + 1} is missing ${field}`);
    return value as EvalCase;
  });
  if (cases.length !== 60) throw new Error(`Round 1 requires exactly 60 cases; found ${cases.length}`);
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) throw new Error('Case ids must be unique');
  return cases;
}

function selectCases(cases: EvalCase[], caseIds: string[]): EvalCase[] {
  const byId = new Map(cases.map((item) => [item.caseId, item]));
  const selected = caseIds.map((caseId) => byId.get(caseId));
  const missing = caseIds.filter((_, index) => !selected[index]);
  if (missing.length) throw new Error(`Unknown regression case id(s): ${missing.join(', ')}`);
  return selected as EvalCase[];
}

function makeBatches(cases: EvalCase[]): Batch[] {
  const familyTargets = distributeTargets(cases.map((item) => item.contentFamily));
  const formTargets = distributeTargets(cases.map((item) => item.inputForm));
  const stressTargets = distributeTargets(cases.map((item) => (isStressCase(item) ? 'stress' : 'standard'))).get('stress')!;
  const batches = batchNames.map((name) => ({ name, cases: [] as EvalCase[] }));
  const familyCounts = batchNames.map(() => new Map<string, number>());
  const formCounts = batchNames.map(() => new Map<string, number>());
  const stressCounts = batchNames.map(() => 0);
  const ordered = deterministicShuffle(cases, (item) => item.caseId)
    .sort((left, right) => Number(isStressCase(right)) - Number(isStressCase(left)));

  for (const item of ordered) {
    const choices = batchNames.map((_, index) => index).filter((index) => batches[index].cases.length < 15);
    const chosen = deterministicShuffle(choices, (index) => `${item.caseId}:${batchNames[index]}`)
      .sort((left, right) => {
        const score = (index: number) => {
          const familyOverage = Math.max(0, (familyCounts[index].get(item.contentFamily) ?? 0) + 1 - familyTargets.get(item.contentFamily)![index]);
          const formOverage = Math.max(0, (formCounts[index].get(item.inputForm) ?? 0) + 1 - formTargets.get(item.inputForm)![index]);
          const stressOverage = isStressCase(item) ? Math.max(0, stressCounts[index] + 1 - stressTargets[index]) : 0;
          return stressOverage * 1000 + familyOverage * 100 + formOverage * 10 + batches[index].cases.length;
        };
        return score(left) - score(right);
      })[0];
    batches[chosen].cases.push(item);
    familyCounts[chosen].set(item.contentFamily, (familyCounts[chosen].get(item.contentFamily) ?? 0) + 1);
    formCounts[chosen].set(item.inputForm, (formCounts[chosen].get(item.inputForm) ?? 0) + 1);
    if (isStressCase(item)) stressCounts[chosen] += 1;
  }

  for (const batch of batches) if (batch.cases.length !== 15) throw new Error(`Batch ${batch.name} has ${batch.cases.length} cases; expected 15`);
  return batches;
}

function blindCase(item: EvalCase): BlindCase {
  return { caseId: item.caseId, transcript: item.transcript, approvedContext: item.approvedContext };
}

function assertNoPrivateReviewFields(payload: BlindCase[], batchName: string): void {
  for (const item of payload) {
    for (const key of privateReviewKeys) if (key in item) throw new Error(`Private review key ${key} leaked into performer batch ${batchName}`);
    const visibleKeys = Object.keys(item).sort();
    if (visibleKeys.join(',') !== 'approvedContext,caseId,transcript') throw new Error(`Unexpected performer case fields in batch ${batchName}: ${visibleKeys.join(', ')}`);
  }
}

async function section(path: string, title: string): Promise<string> {
  return `## ${title}\n\n${await readFile(path, 'utf8').then((content) => content.trim())}`;
}

async function buildPerformerPrompt(batch: Batch): Promise<string> {
  const payload = batch.cases.map(blindCase);
  assertNoPrivateReviewFields(payload, batch.name);
  const references = await Promise.all([
    section(resolve(skillRoot, 'references/nomenclature.md'), 'nomenclature.md'),
    section(resolve(skillRoot, 'references/formula-notation.md'), 'formula-notation.md'),
    section(resolve(skillRoot, 'references/reaction-conventions.md'), 'reaction-conventions.md'),
    section(resolve(skillRoot, 'references/mechanism-conventions.md'), 'mechanism-conventions.md'),
    section(resolve(skillRoot, 'references/ambiguity-policy.md'), 'ambiguity-policy.md'),
    section(resolve(skillRoot, 'references/syllabus-boundary.md'), 'syllabus-boundary.md'),
  ]);
  return [
    `# 9701 CueCaption blind performer batch ${batch.name.toUpperCase()}`,
    'This prompt was assembled locally. It does not contain model results and does not call an external API.',
    await section(resolve(skillRoot, 'SKILL.md'), 'Skill'),
    await section(resolve(skillRoot, 'eval/PERFORMER_PROMPT.md'), 'Performer instructions'),
    `## Global references\n\n${references.join('\n\n')}`,
    `## Performer cases\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
    '## Response requirement\n\nReturn one JSON record per supplied `caseId` following the performer schema. The case payload is deliberately blind; do not infer private reviewer metadata.',
  ].join('\n\n');
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const cases = parseCases(await readFile(caseFile, 'utf8'));
  await mkdir(generatedRoot, { recursive: true });

  if (mode === 'targeted-regression') {
    const batch = { name: 'targeted-regression', cases: selectCases(cases, targetedRegressionCaseIds) };
    const prompt = await buildPerformerPrompt(batch);
    await writeFile(resolve(generatedRoot, 'round-1-targeted-regression.md'), `${prompt}\n`, 'utf8');
    console.log(`Wrote one blind targeted regression batch of ${batch.cases.length} cases to ${generatedRoot}`);
    return;
  }

  const batches = makeBatches(cases);

  for (const batch of batches) {
    const prompt = await buildPerformerPrompt(batch);
    await writeFile(resolve(generatedRoot, `round-1-performer-${batch.name}.md`), `${prompt}\n`, 'utf8');
  }

  const reviewPack = { seed, cases: Object.fromEntries(cases.map((item) => [item.caseId, item])) };
  await writeFile(resolve(generatedRoot, 'round-1-review.json'), `${JSON.stringify(reviewPack, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${batches.length} blind performer batches of 15 cases and one private review pack to ${generatedRoot}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
