import type { ReactNode } from 'react';
import type { z } from 'zod';
import type { RepresentationKind } from '../learner-projection/contracts.ts';
import type { SemanticReference } from '../lesson-stream/core/contracts.ts';
import type { AcceptedTeachingState } from './contracts.ts';

export type ValidationPhase = 'proposal' | 'reuse';
export type ValidatedContent = { data: unknown; references: SemanticReference[] };
export type RenderContext = { state: AcceptedTeachingState; comparing: boolean };
/** Trusted implementation code only. Data is schema parsed, never executable
 * markup. A capability can prune stale parts on reuse, but cannot accept truth. */
export type RepresentationCapability = {
  capabilityId: string;
  representationKind: RepresentationKind;
  preferredWidth: number;
  validate(data: unknown, state: AcceptedTeachingState, phase: ValidationPhase): ValidatedContent;
  render(data: unknown, context: RenderContext): ReactNode;
};
export function defineCapability<T>(config: Omit<RepresentationCapability, 'validate' | 'render'> & {
  schema: z.ZodType<T>;
  validate(data: T, state: AcceptedTeachingState, phase: ValidationPhase): { data: T; references: SemanticReference[] };
  render(data: T, context: RenderContext): ReactNode;
}): RepresentationCapability {
  return Object.freeze({
    capabilityId: config.capabilityId, representationKind: config.representationKind, preferredWidth: config.preferredWidth,
    validate: (data: unknown, state: AcceptedTeachingState, phase: ValidationPhase) => config.validate(config.schema.parse(data), state, phase),
    render: (data: unknown, context: RenderContext) => config.render(config.schema.parse(data), context),
  });
}
