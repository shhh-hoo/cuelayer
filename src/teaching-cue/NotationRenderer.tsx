import { useEffect, useMemo, useRef, useState } from "react";
import "./notation.css";

export type EquationSymbol = {
  kind: "symbol";
  value: string;
  roman?: boolean;
  subscript?: string | number;
  power?: number;
};

export type EquationOperator = {
  kind: "operator";
  value: "=" | "+" | "-" | "×" | "·";
};

export type EquationSimplePiece = EquationSymbol | EquationOperator;

export type EquationFraction = {
  kind: "fraction";
  numerator: EquationSimplePiece[];
  denominator: EquationSimplePiece[];
};

export type EquationPiece = EquationSimplePiece | EquationFraction;

export type EquationNotationSpec = {
  kind: "equation";
  pieces: EquationPiece[];
  ariaLabel: string;
};

export type ReactionSpecies = {
  formula: string;
  coefficient?: number;
  state?: "s" | "l" | "g" | "aq";
};

export type ReactionNotationSpec = {
  kind: "reaction";
  reactants: ReactionSpecies[];
  products: ReactionSpecies[];
  arrow?: "forward" | "equilibrium";
  ariaLabel: string;
};

export type NotationSpec = EquationNotationSpec | ReactionNotationSpec;

export type CompiledNotation = {
  kind: NotationSpec["kind"];
  expression: string;
  plainText: string;
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
const SYMBOL = /^(?:[A-Za-z][A-Za-z0-9]*|\[[A-Za-z][A-Za-z0-9]*\])$/;
const SUBSCRIPT = /^[A-Za-z0-9]{1,8}$/;
const FORMULA = /^[A-Za-z0-9()[\].=+\-^]+$/;
const MAX_EQUATION_PIECES = 14;
const MAX_REACTION_SPECIES = 6;
export const MIN_NOTATION_SCALE = 0.62;
let katexReady: Promise<KatexApi> | undefined;

function checkedLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 240) throw new Error("invalid-notation-label");
  return normalized;
}

function symbolExpression(piece: EquationSymbol) {
  if (!SYMBOL.test(piece.value) || piece.value.length > 24) throw new Error("invalid-equation-symbol");
  if (piece.subscript !== undefined && !SUBSCRIPT.test(String(piece.subscript))) throw new Error("invalid-equation-subscript");
  if (piece.power !== undefined && (!Number.isInteger(piece.power) || piece.power < -9 || piece.power > 9)) throw new Error("invalid-equation-power");
  let expression = piece.roman ? `\\mathrm{${piece.value}}` : piece.value;
  if (piece.subscript !== undefined) expression += `_{${piece.subscript}}`;
  if (piece.power !== undefined) expression += `^{${piece.power}}`;
  return expression;
}

function symbolPlain(piece: EquationSymbol) {
  let value = piece.value;
  if (piece.subscript !== undefined) value += `_${piece.subscript}`;
  if (piece.power !== undefined) value += `^${piece.power}`;
  return value;
}

const OPERATOR_EXPRESSION: Record<EquationOperator["value"], string> = {
  "=": "=",
  "+": "+",
  "-": "-",
  "×": "\\times",
  "·": "\\cdot",
};

function compileSimplePieces(pieces: EquationSimplePiece[]) {
  if (!pieces.length || pieces.length > 6) throw new Error("invalid-equation-group");
  return {
    expression: pieces.map((piece) => piece.kind === "symbol" ? symbolExpression(piece) : OPERATOR_EXPRESSION[piece.value]).join(" "),
    plainText: pieces.map((piece) => piece.kind === "symbol" ? symbolPlain(piece) : piece.value).join(" "),
  };
}

export function compileEquation(spec: EquationNotationSpec): CompiledNotation {
  if (!spec.pieces.length || spec.pieces.length > MAX_EQUATION_PIECES) throw new Error("invalid-equation-pieces");
  const compiled = spec.pieces.map((piece) => {
    if (piece.kind === "symbol") return { expression: symbolExpression(piece), plainText: symbolPlain(piece) };
    if (piece.kind === "operator") return { expression: OPERATOR_EXPRESSION[piece.value], plainText: piece.value };
    const numerator = compileSimplePieces(piece.numerator);
    const denominator = compileSimplePieces(piece.denominator);
    return {
      expression: `\\frac{${numerator.expression}}{${denominator.expression}}`,
      plainText: `(${numerator.plainText}) / (${denominator.plainText})`,
    };
  });
  return {
    kind: "equation",
    expression: compiled.map((piece) => piece.expression).join(" "),
    plainText: compiled.map((piece) => piece.plainText).join(" "),
    ariaLabel: checkedLabel(spec.ariaLabel),
  };
}

function compileSpecies(species: ReactionSpecies) {
  if (!FORMULA.test(species.formula) || species.formula.length > 40 || /[{}\\]/.test(species.formula)) throw new Error("invalid-reaction-formula");
  if (species.coefficient !== undefined && (!Number.isInteger(species.coefficient) || species.coefficient < 1 || species.coefficient > 99)) throw new Error("invalid-reaction-coefficient");
  const coefficient = species.coefficient && species.coefficient !== 1 ? `${species.coefficient}` : "";
  const state = species.state ? `(${species.state})` : "";
  return `${coefficient}${species.formula}${state}`;
}

export function compileReaction(spec: ReactionNotationSpec): CompiledNotation {
  const totalSpecies = spec.reactants.length + spec.products.length;
  if (!spec.reactants.length || !spec.products.length || totalSpecies > MAX_REACTION_SPECIES) throw new Error("invalid-reaction-species");
  const reactants = spec.reactants.map(compileSpecies);
  const products = spec.products.map(compileSpecies);
  const arrow = spec.arrow === "equilibrium" ? "<=>" : "->";
  const source = `${reactants.join(" + ")} ${arrow} ${products.join(" + ")}`;
  return {
    kind: "reaction",
    expression: `\\ce{${source}}`,
    plainText: source.replace("<=>", "⇌").replace("->", "→"),
    ariaLabel: checkedLabel(spec.ariaLabel),
  };
}

export function compileNotation(spec: NotationSpec) {
  return spec.kind === "equation" ? compileEquation(spec) : compileReaction(spec);
}

export function notationFitForWidths(availableWidth: number, naturalWidth: number) {
  if (!Number.isFinite(availableWidth) || !Number.isFinite(naturalWidth) || availableWidth <= 0 || naturalWidth <= 0) {
    return { mode: "fallback" as const, scale: 1 };
  }
  const scale = Math.min(1, availableWidth / naturalWidth);
  return scale < MIN_NOTATION_SCALE ? { mode: "fallback" as const, scale: 1 } : { mode: "fit" as const, scale };
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
  if (!katexReady) {
    katexReady = (async () => {
      stylesheet(KATEX_CSS);
      if (!window.katex) await script(KATEX_JS, `katex-${KATEX_VERSION}`);
      await script(MHCHEM_JS, `mhchem-${KATEX_VERSION}`);
      if (!window.katex) throw new Error("notation-renderer-unavailable");
      return window.katex;
    })();
  }
  return katexReady;
}

export function NotationRenderer({ spec, displayMode = true, className = "" }: { spec: NotationSpec; displayMode?: boolean; className?: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const compiled = useMemo(() => {
    try { return compileNotation(spec); } catch { return undefined; }
  }, [spec]);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const host = hostRef.current;
    const target = targetRef.current;
    setStatus("loading");
    setScale(1);
    setHeight(undefined);
    if (!compiled || !host || !target) { setStatus("fallback"); return; }

    void ensureKatex().then((katex) => {
      if (cancelled || !hostRef.current || !targetRef.current) return;
      const liveHost = hostRef.current;
      const liveTarget = targetRef.current;
      liveTarget.replaceChildren();
      katex.render(compiled.expression, liveTarget, { displayMode, throwOnError: true, trust: false, strict: "ignore" });

      const applyFit = () => {
        if (cancelled) return;
        liveTarget.style.transform = "translateX(-50%) scale(1)";
        const naturalWidth = liveTarget.scrollWidth || liveTarget.getBoundingClientRect().width;
        const naturalHeight = liveTarget.scrollHeight || liveTarget.getBoundingClientRect().height;
        const fit = displayMode ? notationFitForWidths(liveHost.clientWidth, naturalWidth) : { mode: "fit" as const, scale: 1 };
        if (fit.mode === "fallback") {
          setStatus("fallback");
          setScale(1);
          setHeight(undefined);
          return;
        }
        setScale(fit.scale);
        setHeight(displayMode ? Math.ceil(naturalHeight * fit.scale) : undefined);
        setStatus("ready");
      };

      applyFit();
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(applyFit);
        observer.observe(liveHost);
      }
    }).catch(() => { if (!cancelled) setStatus("fallback"); });

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [compiled, displayMode]);

  const plainText = compiled?.plainText ?? spec.ariaLabel;
  return <span
    ref={hostRef}
    className={`notation-renderer ${className}`.trim()}
    data-display={displayMode ? "block" : "inline"}
    data-notation-kind={spec.kind}
    data-notation-status={status}
    aria-label={compiled?.ariaLabel ?? spec.ariaLabel}
    style={displayMode && height !== undefined ? { height } : undefined}
  >
    <span
      ref={targetRef}
      className="notation-katex-target"
      aria-hidden="true"
      style={displayMode ? { transform: `translateX(-50%) scale(${scale})` } : undefined}
    />
    {status === "ready" ? null : <span className="notation-fallback" aria-hidden="true">{plainText}</span>}
  </span>;
}
