import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NotationRenderer,
  compileEquation,
  compileReaction,
  notationDensity,
  type EquationNotationSpec,
  type ReactionAnnotation,
  type ReactionNotationSpec,
} from "./NotationRenderer";

const equation: EquationNotationSpec = {
  kind: "equation",
  ariaLabel: "rate equals k times concentration of A squared",
  pieces: [
    { kind: "symbol", value: "rate", roman: true },
    { kind: "operator", value: "=" },
    { kind: "symbol", value: "k" },
    { kind: "symbol", value: "[A]", power: 2 },
  ],
};

const reaction: ReactionNotationSpec = {
  kind: "reaction",
  ariaLabel: "hydrogen reacts with oxygen to form water",
  reactants: [{ formula: "H2", coefficient: 2 }, { formula: "O2" }],
  products: [{ formula: "H2O", coefficient: 2 }],
};

const bromination: ReactionNotationSpec = {
  kind: "reaction",
  ariaLabel: "ethene plus bromine forms 1,2-dibromoethane",
  reactants: [{ formula: "CH2=CH2" }, { formula: "Br2" }],
  products: [{ formula: "CH2Br-CH2Br" }],
};

const bondAnnotation: ReactionAnnotation = {
  side: "reactant",
  speciesIndex: 0,
  bondIndex: 0,
  label: "the C=C bond is the changing part",
};

describe("NotationRenderer", () => {
  it("compiles bounded equation pieces rather than accepting free TeX", () => {
    expect(compileEquation(equation)).toMatchObject({
      expression: "\\mathrm{rate} = k [A]^{2}",
      plainText: "rate = k [A]^2",
    });
  });

  it("compiles annotations into the original equation term", () => {
    const compiled = compileEquation(equation, [{ pieceIndex: 3, label: "second order in A" }]);
    expect(compiled.expression).toContain("\\underbrace{[A]^{2}}");
    expect(compiled.expression).toContain("second order in A");
    expect(compiled.plainText).toBe("rate = k [A]^2");
  });

  it("compiles reaction species and prevents escaping the mhchem wrapper", () => {
    expect(compileReaction(reaction)).toMatchObject({ expression: "\\ce{2H2 + O2 -> 2H2O}" });
    expect(() => compileReaction({ ...reaction, reactants: [{ formula: "H2}\\href" }, { formula: "O2" }] })).toThrow("invalid-reaction-formula");
  });

  it("binds reaction support to the addressed bond", () => {
    const compiled = compileReaction(bromination, [bondAnnotation]);
    expect(compiled.expression).toContain("\\ce{CH2}\\underbrace{\\mathord{=}}");
    expect(compiled.expression).toContain("the C=C bond is the changing part");
    expect(compiled.expression).toContain("\\longrightarrow");
    expect(() => compileReaction(bromination, [{ ...bondAnnotation, bondIndex: 4 }])).toThrow("invalid-reaction-annotation-target");
  });

  it("rejects unbounded equation structures", () => {
    expect(() => compileEquation({ ...equation, pieces: Array.from({ length: 15 }, () => ({ kind: "symbol" as const, value: "x" })) })).toThrow("invalid-equation-pieces");
    expect(() => compileEquation({ ...equation, pieces: [{ kind: "symbol", value: "x", power: 99 }] })).toThrow("invalid-equation-power");
  });

  it("renders packaged KaTeX synchronously without native script boxes", () => {
    const html = renderToStaticMarkup(<NotationRenderer
      spec={equation}
      annotations={[{ pieceIndex: 3, label: "second order in A" }]}
    />);
    expect(html).toContain("data-notation-status=\"katex\"");
    expect(html).toContain("class=\"katex-display\"");
    expect(html).toContain("second order in A");
    expect(html).not.toContain("notation-native");
  });

  it("renders the complete chemical equation as one KaTeX notation unit", () => {
    const html = renderToStaticMarkup(<NotationRenderer spec={bromination} annotations={[bondAnnotation]} />);
    expect(html).toContain("data-notation-kind=\"reaction\"");
    expect(html).toContain("data-notation-status=\"katex\"");
    expect(html).toContain("class=\"katex-display\"");
    expect(html).toContain("the C=C bond is the changing part");
    expect(html).not.toContain("notation-native-reaction-side");
  });

  it("derives fitting density from stable content rather than geometry", () => {
    expect(notationDensity(compileEquation(equation))).toBe("regular");
    expect(notationDensity(compileReaction(bromination))).toBe("regular");
    expect(notationDensity(compileReaction({
      ...bromination,
      reactants: [{ formula: "CH3CH2OH", state: "l" }, { formula: "CH3COOH", state: "aq" }, { formula: "H+", state: "aq" }],
      products: [{ formula: "CH3COOCH2CH3", state: "l" }, { formula: "H2O", state: "l" }],
      arrow: "equilibrium",
    }))).toBe("dense");
  });
});
