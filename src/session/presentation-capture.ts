import type { CaptureError } from "./session-types";

export function supportsDisplayCapture(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export async function requestPresentationStream(): Promise<MediaStream> {
  if (!supportsDisplayCapture()) throw { kind: "unsupported", message: "Screen sharing is not available in this browser. Try a current Chromium, Firefox, or Safari browser." } satisfies CaptureError;
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    throw captureErrorFrom(error);
  }
}

export function captureErrorFrom(error: unknown): CaptureError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "AbortError") return { kind: "cancelled", message: "Presentation selection was cancelled. Choose a window, tab, or screen when you are ready." };
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "permission-denied", message: "CueLayer could not access that presentation. Check browser permissions and try again." };
  return { kind: "unknown", message: "CueLayer could not start presentation capture. Please try selecting your presentation again." };
}

export function stopPresentationStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
