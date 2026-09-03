import katex from "katex";
import "katex/contrib/mhchem";
import "katex/dist/katex.min.css";
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

export type ReactionAnnotation = {
  side: "reactant" | "product";
  speciesIndex: number;
  bondIndex: number;
  label: string;
};

export type NotationSpec = EquationNotationSpec | ReactionNotationSpec;
export type NotationAnnotation = EquationAnnotation | ReactionAnnotation;
export type NotationDensity = "regular" | "compact" | "dense";
type AnnotationAlignment = "center" | "start" | "end";

export type CompiledNotation = {
  kind: NotationSpec["kind"];
  expression: string;
  stackedExpression?: string;
  plainText: string;
  ariaLabel: string;
};

const SYMBOL = /^(?:[A-Za-z][A-Za-z0-9]*|\[[A-Za-z][A-Za-z0-9]*\])$/;
const SUBSCRIPT = /^[A-Za-z0-9]{1,8}$/;
const FORMULA = /^[A-Za-z0-9()[\].=+\-^]+$/;
const MAX_EQUATION_PIECES = 14;
const MAX_REACTION_SPECIES = 6;
const MAX_ANNOTATION_LENGTH = 120;

function checkedLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 240) throw new Error("invalid-notation-label");
  return normalized;
}

function checkedAnnotationLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_ANNOTATION_LENGTH || /[\\{}$%#&_~^]/.test(normalized)) {
    throw new Error("invalid-notation-annotation");
  }
  return normalized;
}

function wrapAnnotationLabel(label: string) {
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > 28) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 3) return lines;
  return [lines[0]!, lines[1]!, lines.slice(2).join(" ")];
}

function annotationExpression(label: string, alignment: AnnotationAlignment = "center") {
  const rows = wrapAnnotationLabel(checkedAnnotationLabel(label))
    .map((line) => `\\scriptstyle\\textsf{${line}}`)
    .join("\\\\");
  const lap = alignment === "start" ? "\\mathrlap" : alignment === "end" ? "\\mathllap" : "\\mathclap";
  return `${lap}{\\color{#9aaa9d}{\\substack{${rows}}}}`;
}

function annotatedExpression(expression: string, label: string, alignment: AnnotationAlignment = "center") {
  return `\\underbrace{${expression}}_{${annotationExpression(label, alignment)}}`;
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

function compileEquationPiece(piece: EquationPiece) {
  if (piece.kind === "symbol") return { expression: symbolExpression(piece), plainText: symbolPlain(piece) };
  if (piece.kind === "operator") return { expression: OPERATOR_EXPRESSION[piece.value], plainText: piece.value };
  const numerator = compileSimplePieces(piece.numerator);
  const denominator = compileSimplePieces(piece.denominator);
  return {
    expression: `\\frac{${numerator.expression}}{${denominator.expression}}`,
    plainText: `(${numerator.plainText}) / (${denominator.plainText})`,
  };
}

export function compileEquation(spec: EquationNotationSpec, annotations: EquationAnnotation[] = []): CompiledNotation {
  if (!spec.pieces.length || spec.pieces.length > MAX_EQUATION_PIECES) throw new Error("invalid-equation-pieces");
  const annotationByPiece = new Map<number, string>();
  for (const annotation of annotations) {
    if (!Number.isInteger(annotation.pieceIndex) || annotation.pieceIndex < 0 || annotation.pieceIndex >= spec.pieces.length || annotationByPiece.has(annotation.pieceIndex)) {
      throw new Error("invalid-equation-annotation-target");
    }
    annotationByPiece.set(annotation.pieceIndex, checkedAnnotationLabel(annotation.label));
  }

  const compiled = spec.pieces.map((piece, index) => {
    const result = compileEquationPiece(piece);
    const annotation = annotationByPiece.get(index);
    return annotation ? { ...result, expression: annotatedExpression(result.expression, annotation) } : result;
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

function reactionBondPositions(formula: string) {
  const positions: number[] = [];
  for (let index = 0; index < formula.length; index += 1) {
    if (formula[index] === "-" || formula[index] === "=") positions.push(index);
  }
  return positions;
}

function compileAnnotatedSpecies(species: ReactionSpecies, annotation: ReactionAnnotation) {
  compileSpecies(species);
  const positions = reactionBondPositions(species.formula);
  if (!Number.isInteger(annotation.bondIndex) || annotation.bondIndex < 0 || annotation.bondIndex >= positions.length) {
    throw new Error("invalid-reaction-annotation-target");
  }

  const position = positions[annotation.bondIndex]!;
  const bond = species.formula[position]!;
  const coefficient = species.coefficient && species.coefficient !== 1 ? `${species.coefficient}` : "";
  const state = species.state ? `(${species.state})` : "";
  const before = `${coefficient}${species.formula.slice(0, position)}`;
  const after = `${species.formula.slice(position + 1)}${state}`;
  const pieces = [
    before ? `\\ce{${before}}` : "",
    annotatedExpression(`\\mathord{${bond}}`, annotation.label, "start"),
    after ? `\\ce{${after}}` : "",
  ];
  return pieces.join("");
}

function compileReactionSide(species: ReactionSpecies[], sideName: ReactionAnnotation["side"], annotation?: ReactionAnnotation) {
  return species
    .map((item, index) => sideName === annotation?.side && index === annotation.speciesIndex
      ? compileAnnotatedSpecies(item, annotation)
      : `\\ce{${compileSpecies(item)}}`)
    .join(" + ");
}

function compileAnnotatedReaction(spec: ReactionNotationSpec, annotation: ReactionAnnotation) {
  const side = annotation.side === "reactant" ? spec.reactants : spec.products;
  if (!Number.isInteger(annotation.speciesIndex) || annotation.speciesIndex < 0 || annotation.speciesIndex >= side.length) {
    throw new Error("invalid-reaction-annotation-target");
  }

  const reactants = compileReactionSide(spec.reactants, "reactant", annotation);
  const products = compileReactionSide(spec.products, "product", annotation);
  const arrow = spec.arrow === "equilibrium" ? "\\rightleftharpoons" : "\\longrightarrow";
  const stackedArrow = spec.arrow === "equilibrium" ? "\\updownarrow" : "\\downarrow";
  return {
    expression: `${reactants} ${arrow} ${products}`,
    stackedExpression: `\\begin{gathered}${reactants} \\\\[0.18em] ${stackedArrow} \\\\[0.18em] ${products}\\end{gathered}`,
  };
}

export function compileReaction(spec: ReactionNotationSpec, annotations: ReactionAnnotation[] = []): CompiledNotation {
  const totalSpecies = spec.reactants.length + spec.products.length;
  if (!spec.reactants.length || !spec.products.length || totalSpecies > MAX_REACTION_SPECIES) throw new Error("invalid-reaction-species");
  if (annotations.length > 1) throw new Error("invalid-reaction-annotations");
  spec.reactants.forEach(compileSpecies);
  spec.products.forEach(compileSpecies);

  const reactants = spec.reactants.map(compileSpecies);
  const products = spec.products.map(compileSpecies);
  const arrow = spec.arrow === "equilibrium" ? "<=>" : "->";
  const source = `${reactants.join(" + ")} ${arrow} ${products.join(" + ")}`;
  const compiled = annotations[0]
    ? compileAnnotatedReaction(spec, annotations[0])
    : {
        expression: `\\ce{${source}}`,
        stackedExpression: `\\begin{gathered}\\ce{${reactants.join(" + ")}} \\\\[0.18em] ${spec.arrow === "equilibrium" ? "\\updownarrow" : "\\downarrow"} \\\\[0.18em] \\ce{${products.join(" + ")}}\\end{gathered}`,
      };
  return {
    kind: "reaction",
    expression: compiled.expression,
    stackedExpression: compiled.stackedExpression,
    plainText: source.replace("<=>", "⇌").replace("->", "→"),
    ariaLabel: checkedLabel(spec.ariaLabel),
  };
}

function isReactionAnnotation(annotation: NotationAnnotation): annotation is ReactionAnnotation {
  return "side" in annotation;
}

export function compileNotation(spec: NotationSpec, annotations: NotationAnnotation[] = []) {
  if (spec.kind === "equation") {
    if (annotations.some(isReactionAnnotation)) throw new Error("invalid-notation-annotation-kind");
    return compileEquation(spec, annotations as EquationAnnotation[]);
  }
  if (annotations.some((annotation) => !isReactionAnnotation(annotation))) throw new Error("invalid-notation-annotation-kind");
  return compileReaction(spec, annotations as ReactionAnnotation[]);
}

export function notationDensity(compiled: CompiledNotation): NotationDensity {
  const length = compiled.plainText.replace(/\s/g, "").length;
  if (compiled.kind === "equation") {
    if (length <= 20) return "regular";
    return length <= 34 ? "compact" : "dense";
  }
  if (length <= 28) return "regular";
  return length <= 46 ? "compact" : "dense";
}

function renderNotation(expression: string, displayMode: boolean) {
  return katex.renderToString(expression, {
    displayMode,
    throwOnError: true,
    strict: "error",
    trust: false,
    output: "htmlAndMathml",
    maxSize: 10,
    maxExpand: 100,
  });
}

export function NotationRenderer({ spec, annotations = [], displayMode = true, className = "" }: {
  spec: NotationSpec;
  annotations?: NotationAnnotation[];
  displayMode?: boolean;
  className?: string;
}) {
  let compiled: CompiledNotation | undefined;
  let markup: string | undefined;
  let density: NotationDensity = "regular";
  try {
    compiled = compileNotation(spec, annotations);
    density = notationDensity(compiled);
    const expression = density === "dense" && compiled.stackedExpression ? compiled.stackedExpression : compiled.expression;
    markup = renderNotation(expression, displayMode);
  } catch {
    markup = undefined;
  }

  return <span
    className={`notation-renderer ${className}`.trim()}
    data-display={displayMode ? "block" : "inline"}
    data-notation-kind={spec.kind}
    data-notation-density={density}
    data-notation-layout={density === "dense" && compiled?.stackedExpression ? "stacked" : "inline"}
    data-notation-status={markup ? "katex" : "fallback"}
    aria-label={compiled?.ariaLabel ?? spec.ariaLabel}
  >
    {markup
      ? <span className="notation-katex" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
      : <span className="notation-invalid">{compiled?.plainText ?? spec.ariaLabel}</span>}
  </span>;
}
