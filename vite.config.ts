import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** Frontend-only development. Use `npm run dev:full` for the Vercel Functions. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    define: {
      "import.meta.env.VITE_CUELAYER_BUILD_VERSION": JSON.stringify(
        env.VERCEL_GIT_COMMIT_SHA || env.CUELAYER_BUILD_VERSION || process.env.npm_package_version || "development",
      ),
    },
    plugins: [react()],
  };
});
