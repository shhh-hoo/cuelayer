/** CSS/geometry observation only: pointer-events:none makes hit testing unsuitable.
 * Occlusion, physical display, and learner attention remain unverified. */
export type DomObservation = "visible" | "hidden" | "not_in_viewport" | "empty" | "unavailable";
export type DomItemObservation = { id: string; observation: DomObservation };
function elementVisibility(target: HTMLElement): DomObservation {
  if (document.visibilityState !== "visible") return "hidden";
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return "hidden";
  }
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return "not_in_viewport";
  return "visible";
}
export function surfaceItems(root: HTMLElement | null): DomItemObservation[] {
  if (!root?.isConnected) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-board-item-id], [data-support-id], [data-cue-id]')].map(target => ({
    id: target.dataset.boardItemId ?? target.dataset.supportId ?? target.dataset.cueId!, observation: elementVisibility(target),
  }));
}
export function surfaceVisibility(root: HTMLElement | null): DomObservation {
  if (document.visibilityState !== "visible") return "hidden";
  const items = surfaceItems(root);
  return items.find(item => item.observation === "visible")?.observation ?? items[0]?.observation ?? "empty";
}
