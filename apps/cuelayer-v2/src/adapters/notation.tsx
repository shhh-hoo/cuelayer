import { useEffect, useState } from "react";
import katex from "katex";
import "katex/dist/contrib/mhchem.mjs";
import "katex/dist/katex.min.css";
import type { Meaning } from "../contract";
/** Serialization only. No parse, simplify, solve, evaluate or manufactured operands. */
export function Notation({
  meaning,
}: {
  meaning: Extract<Meaning, { kind: "quantity" | "reaction" }>;
}) {
  const [html, setHtml] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setHtml(null);
    setFailed(false);
    void (async () => {
      const latex =
        meaning.kind === "reaction"
          ? `\\ce{${meaning.notation}}`
          : (await import("@cortex-js/compute-engine/latex-syntax")).serialize(
              meaning.expression,
            );
      const next = katex.renderToString(latex, {
        throwOnError: true,
        trust: false,
        displayMode: true,
        strict: "error",
      });
      if (active) setHtml(next);
    })().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [meaning]);
  if (failed)
    return (
      <p role="alert">Notation unavailable. Accepted meaning is retained.</p>
    );
  return (
    <div
      className="notation"
      data-ready={html !== null}
      dangerouslySetInnerHTML={{ __html: html ?? "" }}
    />
  );
}
