import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { renderNotation } from "../../notation/NotationRenderer";
import type { Content } from "./model";
import type { CanvasNode } from "./projection";

export function FixtureContent({ content }: { content: Content }) {
  const markup = useMemo(() => content.kind === "math" ? renderNotation(content.tex, true) : null, [content]);
  if (content.kind === "text") return <span>{content.text}</span>;
  return <span className="notation-renderer spike-math" data-display="block" data-notation-status="katex" aria-label={content.label}>
    <span className="notation-katex" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup! }} />
  </span>;
}

export const KnowledgeNode = memo(function KnowledgeNode({ id, data }: NodeProps<CanvasNode>) {
  return <div className="spike-knowledge" data-node-id={id} data-core-id={data.coreId} data-core-state={data.status} data-inspected={data.inspected} data-root={data.root}>
    <Handle id="in" type="target" position={Position.Top} />
    <FixtureContent content={data.content!} />
    <Handle id="out" type="source" position={Position.Bottom} />
    <Handle id="contrast-source" type="source" position={Position.Right} />
    <Handle id="contrast-target" type="target" position={Position.Left} />
  </div>;
});

export const CoreOriginNode = memo(function CoreOriginNode({ data }: NodeProps<CanvasNode>) {
  return <div className="core-grip" data-core-id={data.coreId} data-core-state={data.status} data-inspected={data.inspected} title="Drag to move this entire Core">
    <span aria-hidden="true">⠿</span><span>Move Core</span>
  </div>;
});

export const SupportNode = memo(function SupportNode({ id, data }: NodeProps<CanvasNode>) {
  return <aside className="spike-support" data-support-id={id} data-core-id={data.coreId} data-core-state={data.status} data-inspected={data.inspected} data-displaced={data.displaced}>
    <span className="spike-support-label">Example · Support{data.displaced ? " · earlier" : ""}</span>
    <p>{data.supportText}</p>
  </aside>;
});
