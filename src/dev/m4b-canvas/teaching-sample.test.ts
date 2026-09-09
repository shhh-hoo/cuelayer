import { describe, expect, it } from "vitest";
import { attentionFrame, projectCanvas } from "../../canvas-spatial/canvas-projection.ts";
import { overlaps, type Size } from "../../canvas-spatial/geometry.ts";
import { emptyProjector, followTeaching, inspectViewport, reframe, updateProjector } from "../../canvas-spatial/projector.ts";
import { objectRef, rectOf, rendererId, semanticKey } from "../../canvas-spatial/spatial.ts";
import { SCENARIOS } from "./scenarios.ts";
import { sampleFrame, sampleSpatial } from "./teaching-sample.ts";

const story = SCENARIOS.find(scenario => scenario.id === "shared-inspection")!.steps;
const compositions: { name: string; compact: boolean; surface: Size }[] = [
  { name: "projector", compact: false, surface: { width: 1280, height: 720 } },
  { name: "compact", compact: true, surface: { width: 390, height: 844 } },
];

describe.each(compositions)("selected teaching sample · $name", ({ compact, surface }) => {
  it("keeps established world rectangles through growth, a topic shift and refocus without changing accepted inputs", () => {
    const inputs = JSON.stringify(story);
    const established = new Map<string, ReturnType<typeof rectOf>>();
    for (const step of story) {
      const spatial = sampleSpatial(step, compact);
      for (const [key, rect] of established) expect(rectOf(spatial.elements[key]!), key).toEqual(rect);
      const rectangles = Object.values(spatial.elements).map(element => {
        const rect = rectOf(element);
        established.set(element.key, rect);
        return rect;
      });
      rectangles.forEach((rect, index) => rectangles.slice(index + 1).forEach(other => {
        expect(overlaps(rect, other, 0)).toBe(false);
      }));
    }
    expect(JSON.stringify(story)).toBe(inputs);
  });

  it("reveals the complete accepted propositions and only their accepted directed relationship", () => {
    const expected = [
      ["catalyst", "A catalyst increases reaction rate and is regenerated overall."],
      ["alternative-path", "A catalyst provides an alternative reaction pathway."],
      ["lower-ea", "The alternative pathway has a lower activation energy."],
    ];
    story.slice(0, 3).forEach((step, index) => {
      const rendered = projectCanvas(step.state, step.projection, sampleSpatial(step, compact));
      const objects = rendered.nodes.filter(node => node.data.kind === "OBJECT");
      expect(objects).toHaveLength(index + 1);
      for (const [id, text] of expected.slice(0, index + 1)) {
        const key = semanticKey(step.state.sessionId, objectRef("catalysts", id!));
        expect(objects.find(node => node.id === rendererId(key))?.data.text).toBe(text);
      }
      expect(rendered.edges).toHaveLength(index === 2 ? 1 : 0);
      if (index === 2) {
        const id = (objectId: string) => rendererId(semanticKey(step.state.sessionId, objectRef("catalysts", objectId)));
        expect(rendered.edges[0]).toMatchObject({
          source: id("alternative-path"), target: id("lower-ea"),
          ariaLabel: "The alternative pathway lowers the activation-energy barrier.",
        });
      }
    });
  });

  it("holds one composition during growth while primary attention advances", () => {
    let controller = emptyProjector();
    let firstViewport: typeof controller.viewport | undefined;
    story.slice(0, 3).forEach((step, index) => {
      const spatial = sampleSpatial(step, compact);
      const frame = sampleFrame(step, spatial, surface, compact);
      expect(frame.primary).toEqual(attentionFrame(step.state, step.projection, spatial).primary);
      const result = updateProjector(controller, frame, "REFRAME_ATTENTION", surface);
      if (index === 0) {
        expect(result.command).toBeDefined();
        firstViewport = result.state.viewport;
      } else {
        expect(result.command).toBeUndefined();
        expect(result.state.viewport).toEqual(firstViewport);
      }
      controller = result.state;
    });
  });

  it("holds inspection while teaching advances and follows the newest accepted neighborhood", () => {
    const manualViewport = { x: 120, y: -70, zoom: 1.2 };
    let controller = inspectViewport(emptyProjector(), manualViewport);
    for (const step of story.slice(3, 5)) {
      const frame = sampleFrame(step, sampleSpatial(step, compact), surface, compact);
      const result = updateProjector(controller, frame, "REFRAME_ATTENTION", surface);
      expect(result.command).toBeUndefined();
      expect(result.state.mode).toBe("TEACHER_INSPECTION");
      expect(result.state.viewport).toEqual(manualViewport);
      expect(result.state.latest).toEqual(frame);
      controller = result.state;
    }
    const resumed = followTeaching(controller, surface);
    expect(resumed.state.mode).toBe("AUTO_FOLLOW");
    expect(resumed.command?.target).toEqual(reframe(controller.latest!, surface));
    const refocused = story[5]!;
    const frame = sampleFrame(refocused, sampleSpatial(refocused, compact), surface, compact);
    const pending = updateProjector(controller, frame, "REFRAME_ATTENTION", surface);
    expect(pending.command).toBeUndefined();
    expect(pending.state.viewport).toEqual(manualViewport);
    expect(followTeaching(pending.state, surface).command?.target).toEqual(reframe(frame, surface));
    expect(reframe(frame, surface)).not.toEqual(resumed.command?.target);
  });
});
