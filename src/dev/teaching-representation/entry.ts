import type { Plugin } from 'vite';
/** Dev-only HTML entry selection before Vite module discovery. */
export function representationReviewEntry(): Plugin {
  return { name: 'representation-review-entry', apply: 'serve', transformIndexHtml: { order: 'pre', handler(html, context) {
    const path = (context.originalUrl ?? context.path).split('?')[0];
    if (path === '/dev/core-projector') return html.replace('src="/src/main.tsx"', 'src="/src/dev/core-projector/main.tsx"');
    return path === '/dev/teaching-representation' ? html.replace('src="/src/main.tsx"', 'src="/src/dev/teaching-representation/main.tsx"') : html;
  } } };
}
