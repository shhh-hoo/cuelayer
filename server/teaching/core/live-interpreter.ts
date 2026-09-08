import type { CoreLiveInterpreter } from "../../../src/lesson-stream/core/live-session.ts";
import { coreProviderIdentity, coreProviderRequest } from "./provider-contract.ts";
import { interpretCore, type CoreProviderTransport } from "./openai-interpreter.ts";

/** Explicitly injected host bridge. No credential lookup or automatic provider activation. */
export function createCoreLiveInterpreter(model: string, transport: CoreProviderTransport): CoreLiveInterpreter {
  return async (binding, { signal, observe }) => {
    const record: typeof observe = diagnostic => { try { observe(diagnostic); } catch { /* Diagnostic only. */ } };
    record({ stage: "request", identity: coreProviderIdentity, requestedModel: model, request: { ...coreProviderRequest(binding), model } });
    const result = await interpretCore(binding, model, transport, signal, diagnostic => {
      record({ stage: "response", ...diagnostic });
    });
    return result.proposal;
  };
}
