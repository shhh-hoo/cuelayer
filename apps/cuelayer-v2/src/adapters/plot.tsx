import { Mafs, Coordinates, Plot, labelPi } from "mafs";
import "mafs/core.css";
import type { Meaning } from "../contract";
/** Finite capability, not a generic evaluator: the exact accepted Sin relationship and domain are required. */
export default function FunctionPlot({
  meaning,
}: {
  meaning: Extract<Meaning, { kind: "quantity" }>;
}) {
  if (
    JSON.stringify(meaning.expression) !==
      JSON.stringify(["Equal", "y", ["Sin", "x"]]) ||
    meaning.independent !== "x" ||
    !meaning.domain ||
    meaning.symbols.x.unit !== "radians"
  )
    return (
      <p role="alert">
        This function needs an additional grounded plotting capability.
      </p>
    );
  return (
    <div data-plot="sine" aria-label="y equals sine x; x in radians">
      <Mafs
        width={288}
        height={210}
        pan={false}
        zoom={false}
        viewBox={{ x: meaning.domain, y: [-1.5, 1.5] }}
      >
        <Coordinates.Cartesian xAxis={{ lines: Math.PI, labels: labelPi }} />
        <Plot.OfX y={Math.sin} domain={meaning.domain} color="#087c75" />
      </Mafs>
    </div>
  );
}
