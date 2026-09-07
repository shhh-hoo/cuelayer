import { describe, expect, it } from "vitest";
import { acceptCoreStep } from "./accepted-steps.ts";
import { coreEntityId } from "./events.ts";
import { reduceCoreStep } from "./teaching-state.ts";
import { evidence, fact, foundation, provenance, speechRef, stepFor } from "./test-fixtures.ts";

describe("persistent Core knowledge", () => {
  it("accepts ordered creation, intra-Core topology, Support and Cue as one step", () => {
    const f = foundation();
    expect(f.replay.state.knowledge).toMatchObject({ revision: 1, currentCoreId: f.coreId });
    expect(f.replay.state.cue).toMatchObject({ revision: 1, active: { id: f.cueId, target: { id: f.relationId } } });
    const core = f.replay.state.knowledge.cores[f.coreId]!;
    expect(Object.keys(core.objects)).toEqual([f.a, f.b]);
    expect(core.relations[f.relationId]!.value).toMatchObject({ fromObjectId: f.a, toObjectId: f.b });
    expect(core.supports[f.supportId]!.value.target).toEqual({ kind: "OBJECT", coreId: f.coreId, id: f.a });
    expect(f.replay.events.filter(e => e.type === "core.step_accepted")).toHaveLength(1);
    expect(f.base.state.knowledge.cores).toEqual({});
  });

  it("revises identified objects, relations and Support without rebuilding unrelated structure", () => {
    const f = foundation(), base = evidence(f.replay), step = stepFor(base), cp = step.consumesCheckpointIds[0]!;
    const before = base.state.knowledge.cores[f.coreId]!;
    step.knowledgeOps = [
      { action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: fact(cp, "Corrected definition"), correctionEvidence: speechRef(cp) },
      { action: "REVISE_RELATION", coreId: f.coreId, id: f.relationId, value: { ...fact(cp, "B relates to A"), fromObjectId: f.b, toObjectId: f.a } },
      { action: "REVISE_SUPPORT", coreId: f.coreId, id: f.supportId, value: { ...fact(cp, "Revised example"), target: { kind: "RELATION", coreId: f.coreId, id: f.relationId } } },
    ];
    const after = acceptCoreStep(base, step).replay.state;
    const core = after.knowledge.cores[f.coreId]!;
    expect(core.objects[f.a]!.id).toBe(f.a);
    expect(core.relations[f.relationId]!.id).toBe(f.relationId);
    expect(core.supports[f.supportId]!.id).toBe(f.supportId);
    expect(core.objects[f.b]).toBe(before.objects[f.b]);
    expect(after.cue).toBe(base.state.cue);
    expect(after.knowledge.revision).toBe(2);
    expect(before.objects[f.a]!.value.text).toBe("A definition");
  });

  it("refocuses the original Core after an unbounded history of topics and Support", () => {
    const f = foundation(); let replay = f.replay;
    for (let i = 0; i < 12; i++) {
      replay = evidence(replay); const step = stepFor(replay), cp = step.consumesCheckpointIds[0]!;
      const id = coreEntityId(replay.state.sessionId, step, "CORE", 0);
      const supportId = coreEntityId(replay.state.sessionId, step, "SUPPORT", 2);
      step.knowledgeOps = [
        { action: "CREATE_CORE", id, provenance: provenance(cp) }, { action: "SET_CURRENT_CORE", coreId: id },
        { action: "ADD_SUPPORT", coreId: f.coreId, id: supportId, value: { ...fact(cp), target: { kind: "CORE", id: f.coreId } } },
      ];
      replay = acceptCoreStep(replay, step).replay;
    }
    const parked = replay.state.knowledge.cores; replay = evidence(replay);
    replay = acceptCoreStep(replay, stepFor(replay, { knowledgeOps: [{ action: "SET_CURRENT_CORE", coreId: f.coreId }] })).replay;
    expect(Object.keys(replay.state.knowledge.cores)).toHaveLength(13);
    expect(Object.keys(replay.state.knowledge.cores[f.coreId]!.supports)).toHaveLength(13);
    expect(replay.state.knowledge.cores).toBe(parked);
    expect(replay.state.knowledge.currentCoreId).toBe(f.coreId);
    expect(replay.state.knowledge.cores[f.coreId]!.objects[f.a]!.value.text).toBe("A definition");
    expect(replay.state.cue).toBe(f.replay.state.cue);
  });

  it.each(["OBJECT", "RELATION", "SUPPORT"] as const)("locally invalidates %s and preserves surrounding knowledge", kind => {
    const f = foundation(), base = evidence(f.replay), step = stepFor(base), cp = step.consumesCheckpointIds[0]!;
    const id = kind === "OBJECT" ? f.a : kind === "RELATION" ? f.relationId : f.supportId;
    step.knowledgeOps = [{ action: "INVALIDATE", target: { kind, coreId: f.coreId, id }, correctionEvidence: speechRef(cp) }];
    const after = acceptCoreStep(base, step).replay.state;
    const old = base.state.knowledge.cores[f.coreId]!, core = after.knowledge.cores[f.coreId]!;
    const key = kind === "OBJECT" ? "objects" : kind === "RELATION" ? "relations" : "supports";
    expect(core[key][id]).toMatchObject({ id, status: "invalidated" });
    expect(core.objects[f.b]).toBe(old.objects[f.b]);
    for (const other of ["objects", "relations", "supports"] as const) if (other !== key) expect(core[other]).toBe(old[other]);
    expect(after.cue).toBe(base.state.cue);
  });

  it("supersedes explicitly without retargeting existing relations or erasing old content", () => {
    const f = foundation(), base = evidence(f.replay), step = stepFor(base), cp = step.consumesCheckpointIds[0]!;
    const replacement = coreEntityId(base.state.sessionId, step, "OBJECT", 0);
    step.knowledgeOps = [
      { action: "ADD_OBJECT", coreId: f.coreId, id: replacement, value: fact(cp, "Replacement proposition") },
      { action: "SUPERSEDE", target: { kind: "OBJECT", coreId: f.coreId, id: f.a }, replacement: { kind: "OBJECT", coreId: f.coreId, id: replacement }, correctionEvidence: speechRef(cp) },
    ];
    const core = acceptCoreStep(base, step).replay.state.knowledge.cores[f.coreId]!;
    expect(core.objects[f.a]).toMatchObject({ status: "superseded", value: { text: "A definition" }, supersededBy: { id: replacement } });
    expect(core.objects[replacement]!.status).toBe("valid");
    expect(core.relations).toBe(base.state.knowledge.cores[f.coreId]!.relations);
    expect(core.supports).toBe(base.state.knowledge.cores[f.coreId]!.supports);
  });

  it("anchors state provenance to the accepted channel revision, surviving subsequent revision", () => {
    const f = foundation(), base = evidence(f.replay), step = stepFor(base), cp = step.consumesCheckpointIds[0]!;
    const source = { target: { kind: "OBJECT" as const, coreId: f.coreId, id: f.a }, revision: 1 };
    step.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.b, value: { text: "Derived representation", provenance: { speechRefs: [speechRef(cp)], stateRefs: [source] } } }];
    let replay = acceptCoreStep(base, step).replay;
    replay = evidence(replay);
    const correction = stepFor(replay);
    correction.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: fact(correction.consumesCheckpointIds[0]!, "Later correction") }];
    replay = acceptCoreStep(replay, correction).replay;
    expect(replay.state.knowledge.cores[f.coreId]!.objects[f.b]!.value.provenance.stateRefs).toEqual([source]);
    expect(f.replay.state.knowledge.cores[f.coreId]!.objects[f.a]!.value.text).toBe("A definition");
  });

  it("keeps identical revision/refocus operations as semantic no-ops", () => {
    const f = foundation(), base = evidence(f.replay), step = stepFor(base);
    step.knowledgeOps = [{ action: "SET_CURRENT_CORE", coreId: f.coreId }, { action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: f.replay.state.knowledge.cores[f.coreId]!.objects[f.a]!.value }];
    const next = reduceCoreStep(base.state, step, base.checkpoints);
    expect(next.knowledge).toBe(base.state.knowledge);
    expect(next.cue).toBe(base.state.cue);
    expect(next.processedThroughSequence).toBe(2);
  });
});
