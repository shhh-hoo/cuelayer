import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotationRenderer, compileEquation, compileReaction, type EquationNotationSpec, type ReactionNotationSpec } from "./NotationRenderer";

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

  it("renders equation scripts in a dedicated script box and keeps annotations on the target piece", () => {
    const html = renderToStaticMarkup(<NotationRenderer
      spec={equation}
      annotations={[{ pieceIndex: 3, label: "second order in A" }]}
    />);
    expect(html).toContain("data-notation-status=\"native\"");
    expect(html).toContain("notation-native-equation");
    expect(html).toContain("notation-native-scripts");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("notation-native-annotated-piece");
    expect(html).toContain("second order in A");
  });

  it("renders chemical equations synchronously with wrapping boundaries and real subscripts", () => {
    const html = renderToStaticMarkup(<NotationRenderer spec={reaction} />);
    expect(html).toContain("data-notation-kind=\"reaction\"");
    expect(html).toContain("data-notation-status=\"native\"");
    expect(html).toContain("notation-native-reaction");
    expect(html).toContain("<span>H</span><sub>2</sub>");
    expect(html).toContain("→");
  });
});
