// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RealtimeClient, RealtimeContext, useRealtimeTranscription } from '@speechmatics/real-time-client-react';
import { createSpeechmaticsConfig } from './use-speechmatics-session';

it('exposes force-finalization through the public React context, without hook/internal access or automatic invocation', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new RealtimeClient();
  expect(typeof client.forceEndOfUtterance).toBe('function');
  const force = vi.spyOn(client, 'forceEndOfUtterance').mockImplementation(() => undefined);
  const configure = vi.spyOn(client, 'setRecognitionConfig').mockImplementation(() => undefined);
  let hook: ReturnType<typeof useRealtimeTranscription>;
  let experiment: () => void;
  function Harness() {
    hook = useRealtimeTranscription();
    const context = useContext(RealtimeContext)!;
    experiment = () => context.client.forceEndOfUtterance('channel-a');
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(() => root.render(<RealtimeContext value={{ client, socketState: undefined }}><Harness /></RealtimeContext>));
    expect(hook!).not.toHaveProperty('forceEndOfUtterance');
    expect(force).not.toHaveBeenCalled(); expect(configure).not.toHaveBeenCalled();
    experiment!(); expect(force).toHaveBeenCalledExactlyOnceWith('channel-a');
    hook!.setRecognitionConfig({ max_delay: 1.5, max_delay_mode: 'flexible' });
    expect(configure).toHaveBeenCalledExactlyOnceWith({ max_delay: 1.5, max_delay_mode: 'flexible' });
    expect(createSpeechmaticsConfig(48000).transcription_config).toMatchObject({ max_delay: 1.5, max_delay_mode: 'flexible', enable_partials: true });
  } finally { await act(() => root.unmount()); vi.restoreAllMocks(); }
});
