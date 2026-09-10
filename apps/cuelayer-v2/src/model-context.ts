import type { Task } from "./contract";
/** Stable host-issued identifiers, independent of provider memory or wording. */
export async function hostSlots(task: Task) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(task.id),
  );
  const prefix = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    newCoreIds: Array.from({ length: 4 }, (_, i) => `c:${prefix}:${i}`),
    newUnitIds: Array.from({ length: 24 }, (_, i) => `u:${prefix}:${i}`),
  };
}
