# Live acceptance — September 5, 2026

Status: `LIVE_SEMANTICS_PASS = false`. Overall SEMANTICS remains awaiting live acceptance. The frozen offline pass and `alpha-augment-p4-v7` promotion are unchanged. No runtime, policy, profile, schema, evaluator, or corpus was modified.

## Setup and preflight

- Tested branch/head: `feat/alpha-teaching-semantics` / `3a4593431c5ca435f864e7a566615760551634c6`. Working tree was clean before this evidence package. PR15 was open, Draft, and unmerged.
- Chrome 152.0.7977.77; Firefox 154.0.1; macOS.
- Physical playback: macOS Samantha voice at 145 words/min through Mac mini built-in speakers; physical input: Insta360 Mic Pro TX MEDQNX Bluetooth microphone (device reports 16 kHz; browser audio context reports 48 kHz). No virtual input, fake media, transcript injection, or ASR bypass was used.
- Local production-code path at `http://127.0.0.1:4178/session`: real getUserMedia → AudioWorklet/PCM listener → Speechmatics realtime → canonical checkpoints → normal interpretation endpoint → OpenAI → validation → persisted accepted Lesson Events → state/render. Both configured credentials were available and used without printing or copying them into the checkout.
- Normal routes were used during capture. Debug routes were opened only after capture for export. No rolling transcript was visible on the normal routes.
- Full script SHA-256: `8236e6262748fa7c9e2959dd5f7b8848532ff92e1c8f9292b96d61beb07cd7c8`. Wording was written before capture and never adapted to model output. Eight seconds of silence followed each scripted line. Playback timings are recorded separately. An initial sandboxed speaker command returned before actual playback could be established; it is not counted as script evidence.

## Frozen contract correlation

- Model: `gpt-5.6-luna`; low reasoning; exact active profile `alpha-augment-p4-v7`; policy `bounded-agent-p4-semantics-v7`.
- Policy digest: `aa6335f586197f38a21fbd75bcf3048dc881cbe3835f33b1d1e29b2d9a08514d`.
- Base schema digest: `a22b45d9fd27bfe9605c2ef15664347dbb4f4dc62e5b851352bb623874829653`.
- Both match the successful frozen v5 manifest. Actual schemas include request-specific checkpoint enums, so their hashes differ across requests. Each recorded live schema was regenerated from its exact request and matched its recorded digest: 16/16 Chrome contracts and 13/13 Firefox contracts. Every recorded policy digest matched v5.
- All 14 Chrome and 15 Firefox accepted steps had request, provider contract, provider request/output, normalized proposal, validation, accepted-event, and render correlation. All accepted canonical speech references matched immutable checkpoint text. Reapplying each accepted step reproduced its recorded state and accepted-event digest.
- Timed-out requests lack provider-response snapshots; the trace explicitly records `audit.unavailable`. A complete causal chain is claimed only for accepted contributions.

## Chrome fixed-script outcomes

Session: `session-3544c77a-9422-4810-a0db-f1b8894fde9b`.

| Script step | Observed outcome |
|---|---|
| 1 filler | Accepted KEEP/KEEP; no learner change. |
| 2 damaged notation | Accepted RECONSTRUCT and rendered `NH₄⁺`. |
| 3 stable definition | Failed: fragmented speech was consumed as unfinished; the complete definition was not established. |
| 4 attached explanation | Failed expected placement: the explanation became Active rather than Support on the missing definition. |
| 5 relationship | Catalyst pathway became TEXT Active with a subsequent ADD_SUPPORT saying activation energy is lower; no RELATION/TRANSFORM was established. |
| 6 TASK | Accepted teacher-originated sketching TASK and rendered it. |
| 7 Board update during TASK | TASK persisted, but the desired new Board proposition was consumed as unfinished. |
| 8 HINT | Two HINT SET proposals were rejected because the existing TASK had not been resolved. |
| 9 TASK completion | Not accepted; TASK remained visible. |
| 10–12 QUESTION, context, answer/resolution | Not reached by accepted state because interpretation backlog timed out. |
| 13 AUGMENT positive | Not reached by accepted state. |
| 14 irrelevant-domain trap | No irrelevant content displayed, but pending input prevents a successful semantic trap claim. |
| 15 leakage trap | No answer displayed, but pending input prevents a successful semantic trap claim. |
| 16 self-correction | Not reached by accepted state. No newly erroneous claim was displayed, but correction behavior was not verified. |
| 17 final topic shift | Not reached by accepted state; catalyst remained Active. |
| 18 quiet continuation | No surface churn, but input remained pending. |

There were 32 requests: 14 accepted, two validation rejections, and 16 client hard-deadline timeouts at 6,002–6,007 ms. The backlog grew to 36 pending checkpoints. All 51 committed checkpoints are accounted for: 15 consumed, 36 pending in the replayed debug state; zero duplicate consumption. No stale-result classification caused solely by later speech was observed. Accepted content contained no autonomous CORRECT/INITIATE, Cue AUGMENT, or invented action. Unreached safety scenarios remain unverified rather than being scored as passed.

Final visible state: “A catalyst provides an alternative reaction pathway”, Support “A catalyst lowers the activation energy.”, TASK “Sketch an energy profile and label the activation energy.”

## Reload and replay

Chrome was paused and the normal `/session` URL reloaded at 12:29:23 UTC. The same Board/Support/TASK rendered after reload; its state equals the final accepted Teaching State. No interpretation request occurred after reload (also none after the subsequent debug-route load). All accepted-event state transitions recomputed exactly. However, no complete live Cue lifecycle had been accepted before reload, so the full required replay gate is **not passed**. Firefox likewise reconstructed its accepted Board state with zero provider requests after reload.

## Firefox comparison

PR15 session: `session-8eefe489-667f-41c5-a59a-8ee4b0edac1f`. The fixed shorter script covered full continuous capture, Board, task creation, Board continuation, completion, and filler. It produced one Board update (“Activation energy”), no Cue update, 13 accepted requests / 15 accepted steps, and one six-second timeout. All 15 committed checkpoints were consumed. ASR severely distorted the task and other lines. Therefore the required Firefox semantic regression does not pass.

A separate checkout of pre-PR15 `b790b550b0aa73907bd6e833520fd965bab89ffd` ran at port 4179, with the same physical devices, speaker voice/rate, script, pauses, browser, and credentials. Baseline session: `session-e017db43-ddf7-4950-8065-4ea811f8990a`. It also severely distorted the speech, accepted 14 requests, and displayed one Board update plus a NOTE that expired. This is audio comparison evidence, not Alpha semantic evidence.

Both Firefox runs maintained audio acknowledgements with zero missing or duplicate/out-of-order sequence counts. No UI freezing or capture lag was visibly observed. The baseline and PR15 capture/transport/listener/trace-writer source files are unchanged. No PR15 audio-performance regression was demonstrated; the acoustic/ASR fidelity problem reproduces before PR15. These sequential runs do not establish acoustic equivalence or isolate a browser-driver cause, so a successful Firefox Cue run is still required. No audio architecture change is justified from this evidence.

## Actual trace volume

Decimal MB/min is bytes during capture divided by measured capture-to-pause duration, excluding setup, reload, and export events.

| Run | Export bytes | Capture bytes | Capture seconds | MB/min |
|---|---:|---:|---:|---:|
| Chrome PR15 | 3,753,350 | 3,728,244 | 323.100 | 0.692 |
| Firefox PR15 | 1,678,161 | 1,665,572 | 148.968 | 0.671 |
| Firefox baseline | 1,410,367 | 1,393,172 | 174.389 | 0.479 |

Chrome dominant categories: provider contracts 753,986 bytes; interpretation requests 555,375; provider requests 512,647. Firefox PR15: provider contracts 613,281; provider requests 394,992; transport summaries 116,478. Full byte/category counts are in the summaries.

There was one request snapshot per request and one provider contract/request/response set per returned provider result, with no duplicate snapshot multiplication per attempt. Trace gaps/dropped-event reports were zero. However, Chrome's repeated timeout attempts amplified request volume while pending evidence grew; this prevents an unconditional trace-amplification acceptance claim. Raw export size should not be confused with the capture-only rate.

## Failure classification and next step

1. **ASR/checkpoint/semantic boundary:** incomplete chunks from full spoken sentences were consumed as unfinished and not later assembled into the intended proposition. Firefox ASR fidelity was substantially worse in both versions. Preserve the natural captured evidence; do not tune the frozen prompt from these anecdotes.
2. **Semantic proposal / validation:** requests 15 and 16 attempted HINT SET over an unresolved TASK. The validator correctly prevented replacement. No relaxation of that safety rule was made.
3. **Scheduler/provider deadline:** requests 17–32 hit the existing six-second limit, preventing backlog recovery. Timeout is demonstrated; whether a longer limit yields a valid result remains untested. A proposed one-request diagnostic replay with a 30-second limit was blocked by automatic approval review because renewed disclosure of the captured transcript/state to OpenAI requires specific approval. No diagnostic replay was sent. Approval is pending.
4. **Render usability observation:** on the captured narrow Chrome window, the bottom session controls overlap part of the TASK card. This does not explain missing accepted transitions and was not changed in this acceptance-only iteration.

No frozen semantic change or speculative runtime change was made. `OFFLINE_SEMANTICS_PASS`, `CORE_ALPHA_PASS = true`, and `AUGMENT_ENABLED = true` continue to describe frozen offline evidence only. `LIVE_SEMANTICS_PASS = false`; PR15 remains Draft/open/unmerged.

Raw exports are preserved locally in the sibling `cuelayer-live-evidence-2026-09-05` directory and the original browser downloads; they were not uploaded to GitHub. SHA-256 hashes are in the committed summaries. This evidence package contains fixed scripts, playback timings, aggregate metrics, and integrity results only.

## Verification

Typecheck, all 158 tests, production build, frozen v5 validation, and `git diff --check` passed after the runs. No frozen artifacts changed.
