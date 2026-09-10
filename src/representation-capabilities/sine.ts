import { z } from 'zod';

// A finite renderer capability: only the three authored functions. No expression
// strings, executable code, frequency parameter, parser, or general-purpose DSL.
export const sineSchema = z.union([
  z.object({ family: z.literal('SINE'), amplitude: z.literal(1), verticalShift: z.literal(0) }).strict(),
  z.object({ family: z.literal('SINE'), amplitude: z.literal(2), verticalShift: z.literal(0) }).strict(),
  z.object({ family: z.literal('SINE'), amplitude: z.literal(1), verticalShift: z.literal(1) }).strict(),
]);
export type SineExpression = z.infer<typeof sineSchema>;
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
