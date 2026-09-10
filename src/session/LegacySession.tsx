import { useLiveTeaching } from "./use-live-teaching";
import { SessionWorkspace } from "./SessionWorkspace";
import type { SessionTraceController } from "../trace/use-session-trace";
import type { SessionTeachingInput } from "./session-teaching";
function useLegacyTeaching(input: SessionTeachingInput) {
  return { ...useLiveTeaching(input), domain: "legacy" as const, ended: false };
}
export default function LegacySession({ trace }: { trace: SessionTraceController }) {
  return <SessionWorkspace trace={trace} useTeaching={useLegacyTeaching} />;
}
