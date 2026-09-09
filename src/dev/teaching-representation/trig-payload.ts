import { z } from 'zod';
import type { SemanticReference } from '../../lesson-stream/core/contracts.ts';

// A finite renderer capability: only the three authored functions. No expression
// strings, executable code, frequency parameter, parser, or general-purpose DSL.
export const sineSchema = z.union([
  z.object({ family: z.literal('SINE'), amplitude: z.literal(1), verticalShift: z.literal(0) }).strict(),
  z.object({ family: z.literal('SINE'), amplitude: z.literal(2), verticalShift: z.literal(0) }).strict(),
  z.object({ family: z.literal('SINE'), amplitude: z.literal(1), verticalShift: z.literal(1) }).strict(),
]);
export type SineExpression = z.infer<typeof sineSchema>;
export type TrigEquation = { kind: 'EQUATION'; format: 'TRIG'; equation: SemanticReference; expression: SineExpression;
  label: SemanticReference; family?: SemanticReference; rule?: SemanticReference };
export type FunctionPlot = { kind: 'PLOT'; plotKind: 'FUNCTION_2D';
  domain: SemanticReference; xAxis: SemanticReference; yAxis: SemanticReference;
  functions: { expressionRef: SemanticReference; expression: SineExpression; parameterRefs: SemanticReference[]; relationshipRefs: SemanticReference[] }[];
  comparisonRefs: SemanticReference[] };

/** Fixed 257 samples over the accepted fixture domain [0, 2π]. Coordinates and
 * tick spacing are renderer grammar. Values are computed, never provider SVG.
 */
export function sampleSine(raw: unknown): { x: number; y: number }[] {
  const expression = sineSchema.parse(raw);
  return Array.from({ length: 257 }, (_, i) => {
    const x = i * Math.PI * 2 / 256;
    return { x, y: expression.amplitude * Math.sin(x) + expression.verticalShift };
  });
}
