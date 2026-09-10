import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { realServices } from "./server/plugin";
export default defineConfig({
  plugins: [react(), realServices()],
  build: { sourcemap: true },
});
