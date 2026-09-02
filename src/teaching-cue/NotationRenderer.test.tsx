import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotationRenderer, compileEquation, compileReaction, notationFitForWidths, type EquationNotationSpec, type ReactionNotationSpec } from "./NotationRenderer";

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

describe("NotationRenderer", () => {
  it("compiles bounded equation pieces rather than accepting free TeX", () => {
    expect(compileEquation(equation)).toMatchObject({
      expression: "\\mathrm{rate} = k [A]^{2}",
      plainText: "rate = k [A]^2",
    });
  });

  it("compiles reaction species and prevents escaping the mhchem wrapper", () => {
    expect(compileReaction(reaction)).toMatchObject({ expression: "\\ce{2H2 + O2 -> 2H2O}" });
    expect(() => compileReaction({ ...reaction, reactants: [{ formula: "H2}\\href" }, { formula: "O2" }] })).toThrow("invalid-reaction-formula");
  });

  it("rejects unbounded equation structures", () => {
    expect(() => compileEquation({ ...equation, pieces: Array.from({ length: 15 }, () => ({ kind: "symbol" as const, value: "x" })) })).toThrow("invalid-equation-pieces");
    expect(() => compileEquation({ ...equation, pieces: [{ kind: "symbol", value: "x", power: 99 }] })).toThrow("invalid-equation-power");
  });

  it("scales notation only to a readability floor, then falls back instead of clipping", () => {
    expect(notationFitForWidths(800, 1000)).toEqual({ mode: "fit", scale: 0.8 });
    expect(notationFitForWidths(400, 1000)).toEqual({ mode: "fallback", scale: 1 });
  });

  it("server-renders an accessible deterministic fallback before the browser renderer loads", () => {
    const html = renderToStaticMarkup(<NotationRenderer spec={reaction} />);
    expect(html).toContain("data-notation-kind=\"reaction\"");
    expect(html).toContain("hydrogen reacts with oxygen to form water");
    expect(html).toContain("2H2 + O2 → 2H2O");
  });
});
