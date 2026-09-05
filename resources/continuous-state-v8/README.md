# September 6 continuous-state repair evidence

**CONTINUOUS_LIVE_PASS = false.** These are new dogfood artifacts, separate from the immutable `resources/semantics/` benchmark history. No matched benchmark generation or frozen-gold tuning was performed.

The fixed 241-word `continuous-script.txt` was played with the macOS Samantha voice at 150 words/minute, without added sentence pauses, through speakers into the physical Insta360 Mic Pro TX MEDQNX microphone. No transcript injection, virtual microphone or ASR bypass was used. Script SHA-256: `e7e582a00db95120efbc9ca49edb28f16b7a27b54c87830fb03b7279f2b58b09`.

Chrome ran first on the normal teaching route; debug was used afterwards for export. `chrome-initial-summary.json` records the first v8 request-specific-schema run. `chrome-stable-summary.json` records the follow-up stable v8.1 schema run. Both used the six-second provider deadline and bounded recovery. Real timeouts recovered in both; later exhaustion paused with evidence preserved. The stable run included one explicit resume while microphone capture was muted.

The stable run recorded 38 committed checkpoints: 19 consumed once, 19 pending. It had 12 accepted requests and eight timeouts. All accepted transitions replay exactly; normal reload restored the same final state without provider calls. These results do not establish complete live acceptance. See the [repair report](../../docs/CONTINUOUS_STATE_REPAIR.md) for gate coverage and limitations.

Firefox loaded the app separately but could not start microphone capture. Its console reported a React script timeout. Reload and a fresh local origin did not resolve the control failure. No Firefox acoustic result is claimed, and the audio architecture is unchanged.

Raw JSONL exports are preserved outside the repository in the local `cuelayer-live-evidence-2026-09-06` directory. Aggregate summaries contain their exact hashes and sizes. Raw traces include ambient ASR and are not published.
