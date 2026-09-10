import { z } from 'zod';
import { semanticReferenceSchema } from '../lesson-stream/core/contracts.ts';
import { defineCapability } from '../teaching-representation/capability.ts';
import { unit, validReference } from '../teaching-representation/grounding.ts';

/** Reviewed literal accepted-content fallback. No domain parsing or executable markup. */
export const acceptedTextCapability = defineCapability({
  capabilityId: 'accepted.content', representationKind: 'TEXT', preferredWidth: 470,
  schema: z.object({ reference: semanticReferenceSchema }).strict(),
  validate(data, state) {
    if (data.reference.kind === 'CORE' || !validReference(state, data.reference)) throw new Error('accepted-content-reference-invalid');
    return { data, references: [data.reference] };
  },
  render({ reference }, { state }) {
    const cue = reference.kind === 'CUE' ? state.cue.active : undefined;
    const text = cue?.text ?? unit(state, reference)?.value.text;
    if (!text) throw new Error('accepted-content-unavailable');
    return <div data-semantic-id={reference.id}>
      {cue && <small className="core-cue-kind">{cue.kind}</small>}
      <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{text}</p>
    </div>;
  },
});
