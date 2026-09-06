# Core Canvas renderer spike

Branch: `spike/core-canvas-renderer`. Baseline: `dda8b901d2968dfb5c3dcd3ab238ee17cdfbc707`, the approved current Draft PR #15 head. The original checkout and PR are unchanged. This is a local renderer experiment, not a production Board rollout.

## Inspect locally

Run `npm ci`, then `npm run dev -- --host 127.0.0.1 --port 5178` in the spike worktree. Open <http://127.0.0.1:5178/dev/core-canvas>.

Playback begins automatically, advances growth every three seconds, pauses five seconds after each Support and the topic shift, and stops at the end. Background browser throttling can lengthen these wall-clock intervals. The **Inspect** panel provides Play/Pause, Reset, Next operation, Focus current Core, Fit all, and jumps to both Cores. Reset pauses at the beginning; Next pauses playback. Drag empty space to pan, scroll/pinch to zoom, drag a node, or drag the small Move Core grip.

The next teaching operation returns from manual inspection to current content, deferring camera movement while a drag is underway. Inspection during paused/completed playback remains until navigation or another operation. There is no independent history-expiry timer.

## What was built and its boundary

- A development-only entry path loads the spike before importing the live application. Production builds remove the spike import and its dependencies from the output. `/session` still loads the existing application; Cue is omitted here.
- Exact direct additions, checked against npm at installation: `@xyflow/react` **12.11.6** and `@dagrejs/dagre` **3.1.1**. No browser-testing or application state-management dependency was added. React Flow's transitive internal store is renderer infrastructure only.
- Plain TypeScript `Lesson`/`CoreModel` structures own knowledge nodes, relations, separately owned Supports, and `currentCoreId`. There are no max-N limits. A Core other than `currentCoreId` is parked regardless of its position or inspection state.
- Separate spatial state owns Core origins, relative node coordinates and measured dimensions. The viewport and inspection emphasis are UI state. Projection produces React Flow nodes/edges; none of those objects is semantic authority.
- React Flow grouping worked as a one-pixel, invisible origin with unrestricted children and a small grip. It has no frame, content-sized container, clipping, or child extent constraint. Whole-Core dragging changes only `coreOrigin`; child-relative positions remain unchanged. `parentId` exists only in the projection and could be removed in favor of absolute projected positions.
- Placement is one small routine: Dagre suggests a newly introduced branch relative to an established anchor; one rightward lane offset avoids a detected overlap. Existing nodes and manually positioned nodes remain fixed. Parked Cores never undergo global layout. Dagre mutates its inputs, so dimension objects are copied before layout.
- React Flow measurements must be preserved across projection. Its viewport is uncontrolled and observed as UI state; imperative focus requests use the same viewport. This avoids competing controlled updates interrupting a topic transition.
- The existing KaTeX helper is exported unchanged and reused for trusted fixture math. The production notation schema and rendering options remain unchanged.

No provider, scheduler, deadline, retry, batching, provenance, semantic policy/profile, production Board, Cue, transcript replay, trace schema or frozen benchmark behavior was changed. No provider calls were made.

## Script and attention behavior

The eleven operations begin with Catalysts, append reaction rate and alternative-pathway/lower-Ea structure, refine the existing Ea label, then add homogeneous/same-phase and heterogeneous/different-phases branches and their contrast. These remain one Core: eight nodes and eight relations.

The catalytic-converter and enzyme examples are separate Supports beside the graph. The second example moves the first upward by 152 canvas units and lowers its opacity to 0.28 over 360 ms. Core structure is unchanged. The latest Support participates in current framing; earlier Support does not. A narrow viewport keeps the latest extra and nearby Core context together.

Arrhenius starts a second Core in free space to the right. Catalyst keeps its original world coordinates and becomes subdued; the camera moves to Arrhenius. The following operation adds the exponential equation and allows testing history inspection followed by automatic return. The final state contains ten knowledge nodes, nine relations, two Supports and one parked Core. UI origin nodes are excluded from these counts.

Selecting or jumping to Catalyst restores reading contrast while it remains parked and `currentCoreId` remains Arrhenius. Focus current Core and subsequent teaching updates clear that inspection emphasis. Camera transitions last 220 ms; reduced-motion mode removes them and the Support/node animations.

**Historical Support retention is a spike assumption, not a CueLayer product invariant.** Keeping displaced extras makes this experiment reversible and supports revisiting the old Core. Whether they should remain permanently inspectable is unresolved.

## Browser evidence and product assessment

Acceptance used the existing Codex browser tooling, with no test framework installed. Inspected at **1280×720** and **390×844**.

| Question | Observation |
| --- | --- |
| Does growth feel like building a board? | Yes for this fixture: existing labels and relations persist as branches arrive. Recorded transforms for all established nodes stayed identical through each growth operation. There are no replacement Core cards. |
| Did grouping fit the unframed model? | Yes with the invisible origin approach. Node and whole-Core dragging both worked. No content-sized group bounds or semantic container fields were needed. |
| How much custom layout was necessary? | Roughly 45 lines for the placement routine, plus bounds/camera helpers. One lane fallback; no iterative collision solver or general incremental-layout engine. |
| Did established/manual positions stay stable? | Yes. Browser dragging changed only the targeted spatial positions; the whole-Core grip translated the children together. Tests also preserved a manually moved node across subsequent growth. |
| Did Catalyst leave attention? | Yes. In the settled desktop Arrhenius view, even the rightmost Catalyst nodes and its Supports were offscreen. Nothing became a competing history sidebar. |
| Did revisiting feel like canvas navigation? | Yes: three canvas drags returned to the existing Catalyst structure without navigation, reloading content, or changing current identity. Selection restored contrast. The next timed operation returned to Arrhenius and cleared inspection. |
| Did Support enrich without interruption? | On desktop, yes: examples occupy separate space, with older material fading upward. Core positions/content stayed unchanged. On narrow screens only a neighborhood fits and Support text becomes small. |
| Should displaced Support remain permanent? | This fixture favors preserving it during exploration, but does not establish a permanent-retention policy. Longer lessons could accumulate clutter; that product decision remains open. |
| Did library abstractions pressure the domain? | Grouping, measurement persistence and viewport ownership needed renderer adaptations. None required changing the knowledge model. |

Pan, scroll zoom, node drag, whole-Core drag, Fit all, Core jumps, reset/play/pause/step, automatic following, retained inspection, and automatic return were exercised. Browser console inspection found no warnings/errors. The unchanged session route reached its ready screen without starting microphone or presentation capture.

After fonts loaded, the equation's visible KaTeX bounds were approximately **148×31 px inside a 280×84 px node**, on both tested viewport widths. Document scroll width equaled viewport width; node content did not overflow. At 390 px, the latest Support and nearby Core definition stayed within the viewport together. Reduced-motion inspection showed `animation: none`, zero-second Support transitions, and immediate camera focus.

A captured sequence of **90 browser requests** contained only local assets: zero `/api/` requests and zero external requests. A subsequent complete automatic replay generated zero network requests and ended on Arrhenius with Catalyst offscreen. Entry tests independently verify that the development spike does not import the live application and that production mode does not import the spike.

Placement samples were **0–1.6 ms**; the largest observed React render sample was **15.3 ms**, including the math step. Diagnostics report React render duration, not commit or physical display latency. These are small-fixture development observations, not large-graph performance claims.

The experiment supports the intended interaction model within this fixture. Known limits: the one-lane strategy grows sideways; arbitrary edits/drags can create overlaps or awkward edges; the parking gap takes several manual drags to traverse; narrow views sacrifice whole-Core context and shrink extras. Automatic return can interrupt a learner reviewing history when teaching resumes, as intentionally specified. General layout, persistence, user-authored graph editing and semantic integration remain outside the spike.

## Validation and changed files

Passed: `npm run typecheck`, **284 tests across 49 files** (19 new spike tests), `npm run build`, offline `npm run eval:semantics:validate` (60 cases, unchanged frozen hash), `npm run check:repo`, and `git diff --check`. No paid evaluations or generated evidence were committed.

- Integration: `src/main.tsx`, `src/notation/NotationRenderer.tsx`, `package.json`, `package-lock.json`.
- Spike: `src/spikes/core-canvas/` contains `model.ts`, `fixture.ts`, `useFixture.ts`, `spatial.ts`, `projection.ts`, `CanvasNodes.tsx`, `CoreCanvasSpike.tsx`, `core-canvas.css`, and three focused test files.
- Documentation: this file only.
