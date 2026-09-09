import type { Plugin } from "vite";

/** Separate HTML entry in the dev server only. No harness imports can enter the
 * production browser graph or the normal /session entry, even before tree shaking.
 */
export function m4bDevEntry(): Plugin {
  return {
    name: "m4b-dev-entry",
    apply: "serve",
    transformIndexHtml(html, context) {
      return context.path === "/dev/m4b-canvas"
        ? html.replace('src="/src/main.tsx"', 'src="/src/dev/m4b-canvas/main.tsx"') : html;
    },
  };
}
