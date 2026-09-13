import type { validate } from "./acceptance";
import type { Accepted, InspectionContext, Task } from "./contract";
import type { validateStage } from "./stage";

export type DecisionEventPayload =
  | { type: "accepted"; accepted: Accepted }
  | {
      type: "inspected";
      taskId: string;
      context?: InspectionContext;
      inspectionKey: string;
      outcome: "WAIT_MORE_INPUT" | "OUTPUT_CAPACITY";
    };

/** The durable disposition of one validated capture; scheduling and the event
 * envelope remain with the owner of the serialized writer.
 */
export function decisionEventPayload(
  task: Task,
  result: ReturnType<typeof validate> | ReturnType<typeof validateStage>,
): DecisionEventPayload {
  const decision = "decision" in result ? result.decision : null;
  if (!decision || decision.groups.length)
    return { type: "accepted", accepted: result.accepted };
  return {
    type: "inspected",
    taskId: task.id,
    context: task.capture
      ? {
          ...task.capture.inspectionContext!,
          ...(decision.contextRequest
            ? {
                query: {
                  ...decision.contextRequest,
                  after: decision.contextRequest.after
                    ? task.capture.units[decision.contextRequest.after]
                    : null,
                },
              }
            : {}),
        }
      : undefined,
    inspectionKey: task.inspectionKey!,
    outcome: decision.suffixStatus as "WAIT_MORE_INPUT" | "OUTPUT_CAPACITY",
  };
}
