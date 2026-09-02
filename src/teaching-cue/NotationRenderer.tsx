import { useEffect, useMemo, useRef, useState } from "react";
import "./notation.css";

export type NotationSpec = {
  kind: "equation" | "reaction";
  source: string;
  ariaLabel: string;
};

type KatexApi = {
  render(source: string, element: HTMLElement, options: { displayMode: boolean; throwOnError: boolean; trust: boolean; strict: "ignore" }): void;
};

declare global {
  interface Window { katex?: KatexApi; }
}

const KATEX_VERSION = "0.18.5";
const KATEX_CSS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
const KATEX_JS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`;
const MHCHEM_JS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/contrib/mhchem.min.js`;
const FORBIDDEN = /\\(?:html|href|url|includegraphics|class|style|cssId|htmlId|htmlClass|htmlStyle)\b/i;
let katexReady: Promise<KatexApi> | undefined;

export function notationExpression(spec: NotationSpec) {
  const source = spec.source.replace(/\s+/g, " ").trim();
  if (!source || source.length > 240) throw new Error("invalid-notation-source");
  if (FORBIDDEN.test(source)) throw new Error("unsafe-notation-source");
  return spec.kind === "reaction" ? `\\ce{${source}}` : source;
}

function stylesheet(href: string) {
  if (document.querySelector(`link[data-cuelayer-katex=\"${KATEX_VERSION}\"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.crossOrigin = "anonymous";
  link.dataset.cuelayerKatex = KATEX_VERSION;
  document.head.append(link);
}

function script(src: string, key: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-cuelayer-notation=\"${key}\"]`);
    if (existing?.dataset.loaded === "true") { resolve(); return; }
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("notation-script-load-failed")), { once: true });
      return;
    }
    const element = document.createElement("script");
    element.src = src;
    element.defer = true;
    element.crossOrigin = "anonymous";
    element.dataset.cuelayerNotation = key;
    element.addEventListener("load", () => { element.dataset.loaded = "true"; resolve(); }, { once: true });
    element.addEventListener("error", () => reject(new Error("notation-script-load-failed")), { once: true });
    document.head.append(element);
  });
}

function ensureKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (!katexReady) {
    katexReady = (async () => {
      stylesheet(KATEX_CSS);
      await script(KATEX_JS, "katex");
      await script(MHCHEM_JS, "mhchem");
      if (!window.katex) throw new Error("notation-renderer-unavailable");
      return window.katex;
    })();
  }
  return katexReady;
}

export function NotationRenderer({ spec, displayMode = true, className = "" }: { spec: NotationSpec; displayMode?: boolean; className?: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const expression = useMemo(() => {
    try { return notationExpression(spec); } catch { return undefined; }
  }, [spec]);

  useEffect(() => {
    let cancelled = false;
    if (!expression || !container.current) { setStatus("fallback"); return; }
    void ensureKatex().then((katex) => {
      if (cancelled || !container.current) return;
      katex.render(expression, container.current, { displayMode, throwOnError: false, trust: false, strict: "ignore" });
      setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("fallback"); });
    return () => { cancelled = true; };
  }, [displayMode, expression]);

  return <span className={`notation-renderer ${className}`.trim()} data-notation-kind={spec.kind} data-notation-status={status} aria-label={spec.ariaLabel}>
    <span ref={container} aria-hidden="true">{status === "ready" ? null : spec.source}</span>
  </span>;
}
