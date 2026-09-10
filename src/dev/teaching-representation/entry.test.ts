import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { build, createServer } from 'vite';
import { representationReviewEntry } from './entry.ts';

it('selects the isolated review entry before module discovery, leaving /session unchanged', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [representationReviewEntry()] });
  try {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
    expect(await server.transformIndexHtml('/index.html', html, '/dev/teaching-representation?lesson=math')).toContain('/src/dev/teaching-representation/main.tsx');
    expect(await server.transformIndexHtml('/index.html', html, '/dev/core-projector')).toContain('/src/dev/core-projector/main.tsx');
    for (const route of ['/session', '/', '/dev/teaching-representation-extra']) {
      const normal = await server.transformIndexHtml('/index.html', html, route);
      expect(normal).toContain('/src/main.tsx'); expect(normal).not.toContain('/src/dev/teaching-representation/main.tsx');
    }
  } finally { await server.close(); }
});
it('ships only the reviewed production representation modules and excludes development/domain capabilities', async () => {
  const modules: string[] = [];
  const chunks: Array<{ name: string; imports: string[]; modules: string[] }> = [];
  await build({ logLevel: 'silent', build: { write: false }, plugins: [{ name: 'assert-production-isolation',
    generateBundle(_options, bundle) { for (const item of Object.values(bundle)) if (item.type === 'chunk') { modules.push(...Object.keys(item.modules)); chunks.push({ name: item.fileName, imports: item.imports, modules: Object.keys(item.modules) }); } },
  }] });
  const branchModules = (entry: string) => {
    const found = chunks.find(chunk => chunk.modules.some(id => id.endsWith(entry)));
    expect(found).toBeDefined();
    const names = new Set<string>();
    const visit = (name: string) => { if (names.has(name)) return; names.add(name); chunks.find(chunk => chunk.name === name)?.imports.forEach(visit); };
    visit(found!.name);
    return chunks.filter(chunk => names.has(chunk.name)).flatMap(chunk => chunk.modules);
  };
  const core = branchModules('/src/session/CoreSession.tsx');
  expect(core.some(id => id.endsWith('/src/lesson-stream/core/runtime.ts'))).toBe(true);
  expect(core.some(id => id.endsWith('/src/session/CoreTeachingSurface.tsx'))).toBe(true);
  expect(core.filter(id => /\/lesson-stream\/(runtime|teaching-state|accepted-interpretations)\.ts$|\/use-live-teaching\.ts$/.test(id))).toEqual([]);
  const legacy = branchModules('/src/session/LegacySession.tsx');
  expect(legacy.some(id => id.endsWith('/src/lesson-stream/runtime.ts'))).toBe(true);
  expect(legacy.filter(id => /\/lesson-stream\/core\/(runtime|live-session|teaching-state)\.ts$/.test(id))).toEqual([]);
  expect(modules.some(id => id.endsWith('/src/main.tsx'))).toBe(true);
  expect(modules.filter(id => /src\/dev\/|@xyflow|@dagrejs|webcola|elkjs/.test(id))).toEqual([]);
  expect(modules.filter(id => id.includes('/src/representation-capabilities/')).map(id => id.split('/src/')[1])).toEqual(['representation-capabilities/accepted-text.tsx']);
  expect(modules.filter(id => /src\/(?:teaching-representation|canvas-spatial)\//.test(id)).map(id => id.split('/src/')[1]).sort()).toEqual([
    'canvas-spatial/Canvas.tsx', 'canvas-spatial/canvas.css', 'canvas-spatial/geometry.ts', 'canvas-spatial/motion.ts', 'canvas-spatial/presentation.ts', 'canvas-spatial/semantic-space.ts',
    'teaching-representation/artifact-runtime.ts', 'teaching-representation/capability.ts', 'teaching-representation/contracts.ts', 'teaching-representation/grounding.ts', 'teaching-representation/identity.ts', 'teaching-representation/producer.ts', 'teaching-representation/registry.ts',
  ].sort());
}, 30_000);
