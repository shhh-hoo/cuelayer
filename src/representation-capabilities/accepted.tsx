import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { AcceptedTeachingState } from '../teaching-representation/contracts.ts';
import { routeRelation, type RelationBox } from '../canvas-spatial/relations.ts';
import { z } from 'zod';
import { unitReferenceSchema } from '../lesson-stream/core/contracts.ts';
import { defineCapability } from '../teaching-representation/capability.ts';
import { textOf, unit } from '../teaching-representation/grounding.ts';

export const objectRef = unitReferenceSchema.extend({ kind: z.literal('OBJECT') }).strict();
export const relationRef = unitReferenceSchema.extend({ kind: z.literal('RELATION') }).strict();
export const textCapability = defineCapability({
  capabilityId: 'accepted.text', representationKind: 'TEXT', preferredWidth: 470,
  schema: z.object({ reference: objectRef }).strict(),
  validate(data, state) {
    if (!unit(state, data.reference)) throw new Error('text-reference-invalid');
    return { data, references: [data.reference] };
  },
  render: (data, { state }) => <p className="representation-text" data-semantic-id={data.reference.id}>{textOf(state, data.reference)}</p>,
});
export const graphCapability = defineCapability({
  capabilityId: 'accepted.relations', representationKind: 'DIAGRAM', preferredWidth: 440,
  schema: z.object({ nodes: z.array(objectRef).min(1).max(32), relations: z.array(relationRef).max(64) }).strict(),
  validate(raw, state, phase) {
    const nodes = raw.nodes.filter(ref => unit(state, ref));
    const relations = raw.relations.filter(ref => unit(state, ref));
    if (!nodes.length || (phase === 'proposal' && (nodes.length !== raw.nodes.length || relations.length !== raw.relations.length))) throw new Error('graph-reference-invalid');
    if (new Set(nodes.map(r => r.id)).size !== nodes.length || new Set(relations.map(r => r.id)).size !== relations.length) throw new Error('duplicate-graph-ref');
    const links = relations.filter(ref => {
      const value = unit(state, ref)!.value;
      const endpoints = 'fromObjectId' in value && 'toObjectId' in value && nodes.some(n => n.coreId === ref.coreId && n.id === value.fromObjectId)
        && nodes.some(n => n.coreId === ref.coreId && n.id === value.toObjectId);
      if (!endpoints && phase === 'proposal') throw new Error('graph-endpoints-invalid');
      return endpoints;
    });
    return { data: { nodes, relations: links }, references: [...nodes, ...links] };
  },
  render: (data, { state }) => <AcceptedGraph data={data} state={state} />,
});
function AcceptedGraph({ data, state }: { data: { nodes: z.infer<typeof objectRef>[]; relations: z.infer<typeof relationRef>[] }; state: AcceptedTeachingState }) {
  const marker = useId();
  const host = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ id: string; path: string; label: string }[]>([]);
  useLayoutEffect(() => {
    const element = host.current!;
    const measure = () => {
      const boxes: RelationBox[] = [...element.querySelectorAll<HTMLElement>('.graph-node')].map(node => ({
        id: node.dataset.semanticId!, x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight,
      }));
      setPaths(data.relations.flatMap(ref => {
        const value = unit(state, ref)!.value;
        if (!('fromObjectId' in value) || !('toObjectId' in value)) return [];
        const from = boxes.find(b => b.id === value.fromObjectId), to = boxes.find(b => b.id === value.toObjectId);
        const path = from && to ? routeRelation(from, to, boxes) : undefined;
        return path ? [{ id: ref.id, path, label: value.text }] : [];
      }));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [data, state]);
  return <div className="accepted-graph" ref={host}>
    {data.nodes.map(ref => <div className="graph-node" key={ref.id} data-semantic-id={ref.id}>{textOf(state, ref)}</div>)}
    <svg className="graph-connectors" data-connector-layer aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1 L8 5 L1 9" fill="none" /></marker></defs>{paths.map(p => <path key={p.id} d={p.path} markerEnd={`url(#${marker})`} data-relation-id={p.id}><title>{p.label}</title></path>)}</svg>
  </div>;
}
