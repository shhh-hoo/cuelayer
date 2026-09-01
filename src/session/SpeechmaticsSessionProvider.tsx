import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PCMAudioRecorderProvider } from "@speechmatics/browser-audio-input-react";
import { RealtimeTranscriptionProvider } from "@speechmatics/real-time-client-react";
import workletScriptURL from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";

const SpeechmaticsAudioContext = createContext<(() => void) | null>(null);

/** Prepares the official recorder's AudioContext before the button click reaches speech startup. */
export function usePrepareSpeechmaticsAudioContext(): () => void {
  const prepareAudioContext = useContext(SpeechmaticsAudioContext);
  if (!prepareAudioContext) throw new Error("Speechmatics audio context must be provided");
  return prepareAudioContext;
}

/** Direct composition of the official Speechmatics React integrations for /session. */
export function SpeechmaticsSessionProvider({ children }: { children: React.ReactNode }) {
  const [audioContext, setAudioContext] = useState<AudioContext>();
  const prepareAudioContext = useCallback(() => {
    if (audioContext && audioContext.state !== "closed") return;
    setAudioContext(new AudioContext());
  }, [audioContext]);

  useEffect(() => () => { void audioContext?.close().catch(() => undefined); }, [audioContext]);

  return <SpeechmaticsAudioContext.Provider value={prepareAudioContext}>
    <RealtimeTranscriptionProvider url="wss://global.rt.speechmatics.com/v2">
      <PCMAudioRecorderProvider workletScriptURL={workletScriptURL} audioContext={audioContext}>
        {children}
      </PCMAudioRecorderProvider>
    </RealtimeTranscriptionProvider>
  </SpeechmaticsAudioContext.Provider>;
}
