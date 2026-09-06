// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("../../App"); vi.doUnmock("./CoreCanvasSpike"); vi.doUnmock("react-dom/client"); });
it.each([
  { development: true, path: "/dev/core-canvas", spike: true },
  { development: true, path: "/session", spike: false },
  { development: false, path: "/dev/core-canvas", spike: false },
])("isolates entry loading: $path, development=$development", async ({ development, path, spike }) => {
  vi.resetModules();
  vi.stubEnv("DEV", development);
  window.history.replaceState(null, "", path);
  const loadSession = vi.fn();
  const loadSpike = vi.fn();
  const render = vi.fn();
  vi.doMock("../../App", () => { loadSession(); return { default: () => null }; });
  vi.doMock("./CoreCanvasSpike", () => { loadSpike(); return { default: () => null }; });
  vi.doMock("react-dom/client", () => ({ default: { createRoot: () => ({ render }) } }));
  await import("../../main");
  expect(render).toHaveBeenCalledOnce();
  expect(loadSpike).toHaveBeenCalledTimes(spike ? 1 : 0);
  expect(loadSession).toHaveBeenCalledTimes(spike ? 0 : 1);
});
