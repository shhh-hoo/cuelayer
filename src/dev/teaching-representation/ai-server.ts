import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { zodTextFormat } from 'openai/helpers/zod';
import OpenAI from 'openai';
import { LESSON } from './lesson.ts';
import { planSchema, IDS } from './producer.ts';
import { compareAI, currentAttention, type AIRow } from './ai.ts';

const fingerprint = createHash('sha256').update(JSON.stringify(LESSON)).digest('hex');
const policy = `You are a development Teaching Representation Producer. Accepted Core state is the only factual authority. Choose useful presentation forms for the supplied M4A semantic attention. You cannot change attention or Core. Output only the strict candidate plan. No factual text, HTML, SVG, CSS, coordinates, numbers or explanation. Reference exact supplied accepted object and relation IDs. Return only currently useful candidates; prior accepted artifacts remain available. Tangents should normally return no new candidates.
Forms: PROPOSITION = one short accepted object. RELATION_CHAIN = at least two ordered objects connected by accepted relations in exactly their accepted from/to direction. Never invent an edge. EQUATION = the accepted Arrhenius equation only. PLOT = qualitative energy profile only, requiring the accepted catalysed-vs-uncatalysed barrier relation AND all nine objects naming reactants, products, uncatalysed pathway, catalysed pathway, reaction progress, potential energy, activation energy, shared endpoint energies, and the stated exothermic example. Supply those nine object refs and that one comparison relation ref; the renderer supplies the qualitative grammar. Do not plot before these exist. COMPARE = two already established co-primary objects, only under COMPARE attention; supply no invented relation.
Stable suggested artifact IDs: ${JSON.stringify(IDS)}. Preserve a growing artifact's ID across checkpoints. References must be valid now; withdraw invalidated/superseded links immediately. A brief mention or single proposition does not justify a diagram. In WIDEN use separate grounded candidates for the two attention targets. A simple proposition is better than an ungrounded structure.`;

export async function runAI(apiKey: string, model: string, outputDir: string) {
  // Same SDK Responses + zodTextFormat path as the Core provider. Its exported
  // transport is typed to Core semantic output, so this dev host calls the SDK
  // directly instead of widening that production contract or adding an abstraction.
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  const rows: AIRow[] = [];
  await mkdir(outputDir, { recursive: true });
  const runId = new Date().toISOString().replaceAll(':', '-');
  const runFile = `${outputDir}/ai-${runId}.json`;
  for (const step of LESSON) {
    const started = performance.now();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
    const { semanticAttention, ...attention } = currentAttention(step);
    const request = { model, reasoning: { effort: 'low' as const }, max_output_tokens: 4096,
      input: [{ role: 'system' as const, content: policy }, { role: 'user' as const, content: JSON.stringify({
        checkpoint: step.id, acceptedState: step.state, attention,
        previousRawProposal: rows.at(-1)?.raw ?? null,
        semanticAttention: { anchor: semanticAttention.anchor, emphasis: semanticAttention.emphasis, context: semanticAttention.context },
      }) }], text: { format: zodTextFormat(planSchema, 'teaching_representation_plan_v1') } };
    try {
      const response = await client.responses.create(request, { signal: controller.signal });
      let raw: unknown; try { raw = JSON.parse(response.output_text); } catch { raw = null; }
      rows.push({ checkpoint: step.id, raw, outputText: response.output_text, elapsedMs: performance.now() - started,
        model: response.model, responseId: response.id, usage: response.usage,
        ...(response.status !== 'completed' ? { error: `provider-${response.status ?? 'unknown'}` } : {}) });
    } catch (e) { rows.push({ checkpoint: step.id, raw: null, elapsedMs: performance.now() - started, error: e instanceof Error ? e.message : String(e) }); }
    finally { clearTimeout(timer); }
    // Retain the original parsed proposal and raw output text before any renderer
    // validation/fallback; rejected output is evidence too. No manual repair.
    await writeFile(runFile, JSON.stringify({ fingerprint, model, rows }, null, 2));
  }
  const result = { fingerprint, model, rows, metrics: compareAI(rows, LESSON).map(r => ({ checkpoint: r.step.id, ...r.metrics, errors: r.errors })) };
  await writeFile(runFile, JSON.stringify(result, null, 2));
  await writeFile(`${outputDir}/ai-latest.json`, JSON.stringify(result, null, 2));
  return result;
}

/** Dev-server only. The browser never receives a key or supplies accepted state.
 * One explicit local review run evaluates the same fixed 14 accepted checkpoints.
 */
export function teachingAIEntry(env: Record<string, string>): Plugin {
  let running: ReturnType<typeof runAI> | undefined;
  const outputDir = `${process.cwd()}/.cuelayer/reviews/teaching-representation`;
  return { name: 'teaching-representation-ai-dev-only', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/dev/teaching-representation', async (request, response) => {
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
      try {
        if (request.method === 'GET') {
          try { const result = JSON.parse(await readFile(`${outputDir}/ai-latest.json`, 'utf8'));
            response.end(JSON.stringify(result.fingerprint === fingerprint ? result : { rows: [] })); }
          catch { response.end(JSON.stringify({ rows: [] })); }
          return;
        }
        if (request.method !== 'POST') { response.statusCode = 405; response.end('{}'); return; }
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.statusCode = 403; response.end('{}'); return; }
        if (!env.OPENAI_API_KEY) { response.statusCode = 503; response.end(JSON.stringify({ error: 'AI provider is not configured', rows: [] })); return; }
        if (!running) running = runAI(env.OPENAI_API_KEY, env.OPENAI_MODEL || 'gpt-5.6-luna', outputDir).finally(() => { running = undefined; });
        response.end(JSON.stringify(await running));
      } catch { response.statusCode = 502; response.end(JSON.stringify({ error: 'AI comparison failed; GOLD remains available', rows: [] })); }
    });
  } };
}
