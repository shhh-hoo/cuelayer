import { defineConfig, loadEnv, mergeConfig } from 'vite';
import base from './vite.config.ts';
import { teachingAIEntry } from './src/dev/teaching-representation/ai-server.ts';

// Explicit development host. The ordinary Vite/API graph cannot activate Core.
export default defineConfig(async context => mergeConfig(
  typeof base === 'function' ? await base(context) : base,
  { plugins: context.command === 'serve' ? [teachingAIEntry(loadEnv(context.mode, process.cwd(), ''))] : [] },
));
