import type { Plugin } from "vite";

/** Separate HTML entry in the dev server only. No harness imports can enter the
 * production browser graph or the normal /session entry, even before tree shaking.
 */
export function m4bDevEntry(): Plugin {
  return {
    name: "m4b-dev-entry",
    apply: "serve",
    transformIndexHtml: {
      // Select the entry before Vite discovers and preloads module scripts.
      order: "pre",
      handler(html, context) {
        // SPA fallback changes path to /index.html; originalUrl retains the route.
        const path = (context.originalUrl ?? context.path).split("?")[0];
        if (path === "/dev/teaching-representation") return html.replace('src="/src/main.tsx"', 'src="/src/dev/teaching-representation/main.tsx"');
        return path === "/dev/m4b-canvas"
          ? html.replace('src="/src/main.tsx"', 'src="/src/dev/m4b-canvas/main.tsx"') : html;
      },
    },
  };
}
