import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotationRenderer, notationExpression } from "./NotationRenderer";

describe("NotationRenderer", () => {
  it("keeps equation source bounded and wraps reaction source with mhchem", () => {
    expect(notationExpression({ kind: "equation", source: "  \\mathrm{rate}=k[A]^2  ", ariaLabel: "rate equation" })).toBe("\\mathrm{rate}=k[A]^2");
    expect(notationExpression({ kind: "reaction", source: "CH2=CH2 + Br2 -> CH2Br-CH2Br", ariaLabel: "bromination" })).toBe("\\ce{CH2=CH2 + Br2 -> CH2Br-CH2Br}");
  });

  it("rejects blank, overlong, and HTML-capable notation commands", () => {
    expect(() => notationExpression({ kind: "equation", source: "   ", ariaLabel: "blank" })).toThrow("invalid-notation-source");
    expect(() => notationExpression({ kind: "equation", source: "x".repeat(241), ariaLabel: "long" })).toThrow("invalid-notation-source");
    expect(() => notationExpression({ kind: "equation", source: "\\href{https://example.com}{x}", ariaLabel: "unsafe" })).toThrow("unsafe-notation-source");
  });

  it("server-renders an accessible deterministic fallback before the browser renderer loads", () => {
    const html = renderToStaticMarkup(<NotationRenderer spec={{ kind: "reaction", source: "2H2 + O2 -> 2H2O", ariaLabel: "hydrogen reacts with oxygen to form water" }} />);
    expect(html).toContain("data-notation-kind=\"reaction\"");
    expect(html).toContain("hydrogen reacts with oxygen to form water");
    expect(html).toContain("2H2 + O2 -&gt; 2H2O");
  });
});
