import type { ReactNode } from "react";
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

export type EquationAnnotation = {
  pieceIndex: number;
  label: string;
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

const SYMBOL = /^(?:[A-Za-z][A-Za-z0-9]*|\[[A-Za-z][A-Za-z0-9]*\])$/;
const SUBSCRIPT = /^[A-Za-z0-9]{1,8}$/;
const FORMULA = /^[A-Za-z0-9()[\].=+\-^]+$/;
const MAX_EQUATION_PIECES = 14;
const MAX_REACTION_SPECIES = 6;

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

function NativeEquationSymbol({ piece }: { piece: EquationSymbol }) {
  const scripted = piece.subscript !== undefined || piece.power !== undefined;
  return <span className="notation-native-symbol" data-roman={piece.roman ? "true" : "false"} data-scripted={scripted ? "true" : "false"}>
    <span className="notation-native-base">{piece.value}</span>
    {scripted ? <span className="notation-native-scripts" aria-hidden="true">
      {piece.power !== undefined ? <sup>{piece.power}</sup> : null}
      {piece.subscript !== undefined ? <sub>{piece.subscript}</sub> : null}
    </span> : null}
  </span>;
}

function NativeSimplePiece({ piece }: { piece: EquationSimplePiece }) {
  return piece.kind === "symbol"
    ? <NativeEquationSymbol piece={piece} />
    : <span className="notation-native-operator">{piece.value}</span>;
}

function NativeEquationPiece({ piece }: { piece: EquationPiece }) {
  if (piece.kind !== "fraction") return <NativeSimplePiece piece={piece} />;
  return <span className="notation-native-fraction">
    <span>{piece.numerator.map((item, index) => <NativeSimplePiece key={index} piece={item} />)}</span>
    <span>{piece.denominator.map((item, index) => <NativeSimplePiece key={index} piece={item} />)}</span>
  </span>;
}

function formulaNodes(formula: string) {
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;
  while (index < formula.length) {
    const char = formula[index]!;
    if (char === "^") {
      let end = index + 1;
      while (end < formula.length && /[0-9+\-]/.test(formula[end]!)) end += 1;
      const charge = formula.slice(index + 1, end);
      if (charge) nodes.push(<sup key={key++}>{charge}</sup>);
      index = end;
      continue;
    }
    if (/\d/.test(char)) {
      let end = index + 1;
      while (end < formula.length && /\d/.test(formula[end]!)) end += 1;
      nodes.push(<sub key={key++}>{formula.slice(index, end)}</sub>);
      index = end;
      continue;
    }
    let end = index + 1;
    while (end < formula.length && !/[\d^]/.test(formula[end]!)) end += 1;
    nodes.push(<span key={key++}>{formula.slice(index, end)}</span>);
    index = end;
  }
  return nodes;
}

function NativeReactionSpecies({ species }: { species: ReactionSpecies }) {
  return <span className="notation-native-species">
    {species.coefficient && species.coefficient !== 1 ? <span className="notation-native-coefficient">{species.coefficient}</span> : null}
    <span className="notation-native-formula">{formulaNodes(species.formula)}</span>
    {species.state ? <span className="notation-native-state">({species.state})</span> : null}
  </span>;
}

function NativeReactionSide({ species }: { species: ReactionSpecies[] }) {
  return <span className="notation-native-reaction-side">
    {species.map((item, index) => <span className="notation-native-reaction-item" key={`${item.formula}-${index}`}>
      {index ? <span className="notation-native-reaction-plus">+</span> : null}
      <NativeReactionSpecies species={item} />
    </span>)}
  </span>;
}

function annotationFor(index: number, annotations: EquationAnnotation[]) {
  const candidate = annotations.find((annotation) => annotation.pieceIndex === index)?.label.replace(/\s+/g, " ").trim();
  return candidate && candidate.length <= 120 ? candidate : undefined;
}

function NativeNotation({ spec, annotations }: { spec: NotationSpec; annotations: EquationAnnotation[] }) {
  if (spec.kind === "equation") {
    return <span className="notation-native notation-native-equation">
      {spec.pieces.map((piece, index) => {
        const annotation = annotationFor(index, annotations);
        return <span className={annotation ? "notation-native-annotated-piece" : "notation-native-equation-piece"} key={index}>
          <span className="notation-native-equation-piece"><NativeEquationPiece piece={piece} /></span>
          {annotation ? <span className="notation-native-annotation">{annotation}</span> : null}
        </span>;
      })}
    </span>;
  }
  return <span className="notation-native notation-native-reaction">
    <NativeReactionSide species={spec.reactants} />
    <span className="notation-native-reaction-arrow">{spec.arrow === "equilibrium" ? "⇌" : "→"}</span>
    <NativeReactionSide species={spec.products} />
  </span>;
}

export function NotationRenderer({ spec, annotations = [], displayMode = true, className = "" }: {
  spec: NotationSpec;
  annotations?: EquationAnnotation[];
  displayMode?: boolean;
  className?: string;
}) {
  let compiled: CompiledNotation | undefined;
  try { compiled = compileNotation(spec); } catch { compiled = undefined; }

  return <span
    className={`notation-renderer ${className}`.trim()}
    data-display={displayMode ? "block" : "inline"}
    data-notation-kind={spec.kind}
    data-notation-status={compiled ? "native" : "fallback"}
    aria-label={compiled?.ariaLabel ?? spec.ariaLabel}
  >
    {compiled ? <NativeNotation spec={spec} annotations={annotations} /> : <span className="notation-invalid">{spec.ariaLabel}</span>}
  </span>;
}
