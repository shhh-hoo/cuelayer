import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { build, createServer } from 'vite';
import { m4bDevEntry } from '../m4b-canvas/entry.ts';
import { teachingAIEntry } from './ai-server.ts';

it('serves the teaching entry only at its isolated development route', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [m4bDevEntry()] });
  try {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
    expect(await server.transformIndexHtml('/index.html', html, '/dev/teaching-representation?review=1')).toContain('/src/dev/teaching-representation/main.tsx');
    for (const route of ['/session', '/', '/dev/teaching-representation-extra']) {
      const normal = await server.transformIndexHtml('/index.html', html, route);
      expect(normal).toContain('/src/main.tsx'); expect(normal).not.toContain('/src/dev/teaching-representation/main.tsx');
    }
  } finally { await server.close(); }
});
it('keeps the AI endpoint out of production and the ordinary server configuration', () => {
  expect(teachingAIEntry({}).apply).toBe('serve');
  expect(readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8')).not.toContain('teachingAIEntry');
});
it('excludes both Teaching Representation stories and spatial dependencies from the actual production bundle', async () => {
  const modules: string[] = [];
  await build({ logLevel: 'silent', build: { write: false }, plugins: [{ name: 'assert-production-isolation',
    generateBundle(_options, bundle) { for (const item of Object.values(bundle)) if (item.type === 'chunk') modules.push(...Object.keys(item.modules)); },
  }] });
  expect(modules.some(id => id.endsWith('/src/main.tsx'))).toBe(true);
  expect(modules.filter(id => /src\/dev\/|@xyflow|@dagrejs|webcola|elkjs/.test(id))).toEqual([]);
});
