import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotationRenderer, compileReaction, type ReactionNotationSpec } from "./NotationRenderer";

const bromination: ReactionNotationSpec = {
  kind: "reaction",
  ariaLabel: "ethene plus bromine forms 1,2-dibromoethane",
  reactants: [{ formula: "CH2=CH2" }, { formula: "Br2" }],
  products: [{ formula: "CH2Br-CH2Br" }],
};

const denseReaction: ReactionNotationSpec = {
  kind: "reaction",
  ariaLabel: "crowded reversible reaction",
  reactants: [
    { formula: "CH3CH2OH", state: "l" },
    { formula: "CH3COOH", state: "aq" },
    { formula: "H+", state: "aq" },
  ],
  products: [
    { formula: "CH3COOCH2CH3", state: "l" },
    { formula: "H2O", state: "l" },
  ],
  arrow: "equilibrium",
};

describe("responsive reaction notation", () => {
  it("start-aligns a bond annotation so it does not extend beyond the left safe edge", () => {
    const compiled = compileReaction(bromination, [{
      side: "reactant",
      speciesIndex: 0,
      bondIndex: 0,
      label: "the C=C bond is the changing part",
    }]);
    expect(compiled.expression).toContain("\\underbrace{\\mathord{=}}");
    expect(compiled.expression).toContain("\\mathrlap");
  });

  it("compiles dense content into one deterministic stacked KaTeX unit", () => {
    const compiled = compileReaction(denseReaction);
    expect(compiled.stackedExpression).toContain("\\begin{gathered}");
    expect(compiled.stackedExpression).toContain("\\updownarrow");

    const html = renderToStaticMarkup(<NotationRenderer spec={denseReaction} />);
    expect(html).toContain("data-notation-density=\"dense\"");
    expect(html).toContain("data-notation-layout=\"stacked\"");
    expect(html.match(/class=\"katex-display\"/g)).toHaveLength(1);
    expect(html).toContain("updownarrow");
  });
});
