import { resolve, relative } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { build } from 'vite';

const rootIndex = process.argv.indexOf('--root');
const root = resolve(rootIndex < 0 ? process.cwd() : process.argv[rootIndex + 1]);
const moduleName = (id: string) => id.startsWith('\0') ? id.slice(1) : relative(root, id);
await build({ root, logLevel: 'silent', build: { write: false }, plugins: [{ name: 'production-budget-report',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
    const modules = [...new Set(chunks.flatMap(chunk => Object.keys(chunk.modules)))].map(moduleName).sort();
    const eager = new Set<string>();
    const visit = (name: string) => { if (eager.has(name)) return; eager.add(name); chunks.find(chunk => chunk.fileName === name)?.imports.forEach(visit); };
    chunks.filter(chunk => chunk.isEntry).forEach(chunk => visit(chunk.fileName));
    const sizes = chunks.map(chunk => ({ file: chunk.fileName, eager: eager.has(chunk.fileName),
      raw: Buffer.byteLength(chunk.code), gzip: gzipSync(chunk.code).byteLength, brotli: brotliCompressSync(chunk.code).byteLength,
      modules: Object.keys(chunk.modules).map(moduleName).sort() }));
    const jsAssets = Object.values(bundle).flatMap(item => {
      if (item.type !== 'asset' || !item.fileName.endsWith('.js')) return [];
      const bytes = Buffer.from(item.source);
      return [{ file: item.fileName, raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength, brotli: brotliCompressSync(bytes).byteLength }];
    });
    process.stdout.write(JSON.stringify({ moduleCount: modules.length, jsAssets,
      raw: sizes.reduce((n, c) => n + c.raw, 0), gzip: sizes.reduce((n, c) => n + c.gzip, 0), brotli: sizes.reduce((n, c) => n + c.brotli, 0),
      eagerRaw: sizes.filter(c => c.eager).reduce((n, c) => n + c.raw, 0), chunks: sizes, modules }, null, 2) + '\n');
  },
}] });
