import type { OperationRendererProps, TokenPresentation } from "./shared";

export function nonePresentation(_: OperationRendererProps): TokenPresentation {
  return { className: "caption-token", opacity: 1, scale: 1 };
}
