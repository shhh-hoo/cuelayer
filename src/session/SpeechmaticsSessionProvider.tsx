import { useEffect, useState } from "react";
import { PCMAudioRecorderProvider } from "@speechmatics/browser-audio-input-react";
import { RealtimeTranscriptionProvider } from "@speechmatics/real-time-client-react";
import workletScriptURL from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";

const SAMPLE_RATE = 16_000;

/** Direct composition of the official Speechmatics React integrations for /session. */
export function SpeechmaticsSessionProvider({ children }: { children: React.ReactNode }) {
  const [audioContext] = useState(() => new AudioContext({ sampleRate: SAMPLE_RATE }));

  useEffect(() => () => { void audioContext.close().catch(() => undefined); }, [audioContext]);

  return <RealtimeTranscriptionProvider url="wss://global.rt.speechmatics.com/v2">
    <PCMAudioRecorderProvider workletScriptURL={workletScriptURL} audioContext={audioContext}>
      {children}
    </PCMAudioRecorderProvider>
  </RealtimeTranscriptionProvider>;
}
