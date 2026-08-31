import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

const root = resolve(import.meta.dirname, '..');
const skillRoot = resolve(root, 'skills/9701-cuecaption');
const caseFile = resolve(skillRoot, 'eval/cases-round-1.jsonl');
const defaultOutput = resolve(root, 'artifacts/9701-eval/round-1-prompt.md');

const requiredFields: Array<keyof EvalCase> = [
  'caseId', 'contentFamily', 'inputForm', 'transcript', 'factsToPreserve',
  'preferredConventions', 'allowedTransformations', 'forbiddenInferences', 'ambiguityPolicy',
];

const referencesByFamily: Record<string, string[]> = {
  'organic nomenclature': ['nomenclature.md', 'ambiguity-policy.md'],
  'formula and ions': ['formula-notation.md', 'ambiguity-policy.md'],
  'equations and reactions': ['reaction-conventions.md', 'formula-notation.md', 'ambiguity-policy.md'],
  'physical chemistry notation': ['formula-notation.md', 'ambiguity-policy.md'],
  'organic transformations': ['reaction-conventions.md', 'nomenclature.md', 'ambiguity-policy.md'],
  'mechanism language': ['mechanism-conventions.md', 'ambiguity-policy.md'],
  'isomerism / stereochemistry': ['nomenclature.md', 'ambiguity-policy.md'],
  'analysis / practical': ['reaction-conventions.md', 'formula-notation.md', 'ambiguity-policy.md'],
  'ambiguity / conflict': ['ambiguity-policy.md'],
};

function usage(): string {
  return [
    'Usage: node --experimental-strip-types scripts/build-9701-eval-prompt.ts [options]',
    '',
    'Options:',
    '  --case C001,C002   Select explicit case ids.',
    '  --limit 15         Select the first N cases when --case is absent.',
    '  --output path      Write the assembled prompt (default: artifacts/9701-eval/round-1-prompt.md).',
    '  --help             Show this message.',
  ].join('\n');
}

function parseArgs(args: string[]): { caseIds: string[]; limit?: number; output: string } {
  let caseIds: string[] = [];
  let limit: number | undefined;
  let output = defaultOutput;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help') {
      console.log(usage());
      process.exit(0);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--case') caseIds = value.split(',').map((id) => id.trim()).filter(Boolean);
    else if (flag === '--limit') {
      limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
    } else if (flag === '--output') output = resolve(root, value);
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  return { caseIds, limit, output };
}

function parseCases(source: string): EvalCase[] {
  const cases = source.trim().split('\n').filter(Boolean).map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`Invalid JSONL at line ${index + 1}`); }
    if (!value || typeof value !== 'object') throw new Error(`Case ${index + 1} is not an object`);
    for (const field of requiredFields) if (!(field in value)) throw new Error(`Case ${index + 1} is missing ${field}`);
    return value as EvalCase;
  });
  if (!cases.length) throw new Error('No evaluation cases found');
  return cases;
}

function selectCases(allCases: EvalCase[], options: { caseIds: string[]; limit?: number }): EvalCase[] {
  if (options.caseIds.length) {
    const byId = new Map(allCases.map((item) => [item.caseId, item]));
    const selected = options.caseIds.map((id) => byId.get(id));
    const missing = options.caseIds.filter((_, index) => !selected[index]);
    if (missing.length) throw new Error(`Unknown case id(s): ${missing.join(', ')}`);
    return selected as EvalCase[];
  }
  return options.limit ? allCases.slice(0, options.limit) : allCases;
}

async function section(path: string, title: string): Promise<string> {
  return `## ${title}\n\n${await readFile(path, 'utf8').then((content) => content.trim())}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const allCases = parseCases(await readFile(caseFile, 'utf8'));
  const selected = selectCases(allCases, options);
  const references = new Set<string>(['syllabus-boundary.md']);
  for (const item of selected) for (const reference of referencesByFamily[item.contentFamily] ?? ['ambiguity-policy.md']) references.add(reference);

  const parts = [
    '# 9701 CueCaption semantic evaluation batch',
    'This prompt was assembled locally. It does not contain model results and does not call an external API.',
    await section(resolve(skillRoot, 'SKILL.md'), 'Skill'),
    await section(resolve(skillRoot, 'eval/PERFORMER_PROMPT.md'), 'Performer instructions'),
    '## Relevant references\n\n' + (await Promise.all([...references].sort().map(async (name) => section(resolve(skillRoot, 'references', name), name)))).join('\n\n'),
    '## Selected semantic review contracts\n\n```json\n' + JSON.stringify(selected, null, 2) + '\n```',
    '## Response requirement\n\nReturn one JSON record per selected `caseId` following the performer schema. Do not use exact-string targets; honour the supplied semantic contracts.',
  ];

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${parts.join('\n\n')}\n`, 'utf8');
  console.log(`Wrote ${selected.length} cases and ${references.size} relevant references to ${options.output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
