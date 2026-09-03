import { SessionPage } from "./session/SessionPage";
import { SpeechmaticsSessionProvider } from "./session/SpeechmaticsSessionProvider";

export default function App() {
  return <SpeechmaticsSessionProvider><SessionPage /></SpeechmaticsSessionProvider>;
}
