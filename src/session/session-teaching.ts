import type { useLiveTeaching } from './use-live-teaching';
import type { CoreProjectorSource } from './core-projector';
export type SessionTeachingInput = Parameters<typeof useLiveTeaching>[0];
type LegacyTeaching = ReturnType<typeof useLiveTeaching> & { domain: 'legacy'; ended: boolean };
type CoreTeaching = Pick<LegacyTeaching, 'status' | 'pendingCount' | 'error' | 'health' | 'resumeInterpretation' | 'allocateSpeechRunId' | 'endLesson'> & {
  domain: 'core'; source?: CoreProjectorSource; ended: boolean;
};
export type SessionTeachingHook = (input: SessionTeachingInput) => LegacyTeaching | CoreTeaching;
