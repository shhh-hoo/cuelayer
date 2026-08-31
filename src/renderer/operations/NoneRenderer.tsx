import type { TokenPresentation } from "./shared";

export function nonePresentation(): TokenPresentation {
  return { className: "caption-token", opacity: 1, scale: 1 };
}
