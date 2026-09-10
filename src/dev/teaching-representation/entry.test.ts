import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { build, createServer } from 'vite';
import { representationReviewEntry } from './entry.ts';

it('selects the isolated review entry before module discovery, leaving /session unchanged', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [representationReviewEntry()] });
  try {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
    expect(await server.transformIndexHtml('/index.html', html, '/dev/teaching-representation?lesson=math')).toContain('/src/dev/teaching-representation/main.tsx');
    for (const route of ['/session', '/', '/dev/teaching-representation-extra']) {
      const normal = await server.transformIndexHtml('/index.html', html, route);
      expect(normal).toContain('/src/main.tsx'); expect(normal).not.toContain('/src/dev/teaching-representation/main.tsx');
    }
  } finally { await server.close(); }
});
it('keeps representation, capabilities and development code outside the actual production bundle', async () => {
  const modules: string[] = [];
  await build({ logLevel: 'silent', build: { write: false }, plugins: [{ name: 'assert-production-isolation',
    generateBundle(_options, bundle) { for (const item of Object.values(bundle)) if (item.type === 'chunk') modules.push(...Object.keys(item.modules)); },
  }] });
  expect(modules.some(id => id.endsWith('/src/main.tsx'))).toBe(true);
  expect(modules.filter(id => /src\/(?:dev|teaching-representation|representation-capabilities|canvas-spatial)\/|@xyflow|@dagrejs|webcola|elkjs/.test(id))).toEqual([]);
}, 30_000);
