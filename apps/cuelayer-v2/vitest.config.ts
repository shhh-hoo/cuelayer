import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.v2.ts"],
    setupFiles: ["fake-indexeddb/auto"],
  },
});
