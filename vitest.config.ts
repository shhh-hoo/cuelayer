import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig(environment => mergeConfig(viteConfig(environment), {
  test: {
    // Evidence archives can contain copied test source without its dependencies.
    // Only the canonical source tree should participate in regression discovery.
    exclude: [...configDefaults.exclude, ".cuelayer/**", "artifacts/**"],
  },
}));
