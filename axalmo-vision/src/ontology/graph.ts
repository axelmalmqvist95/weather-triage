import type { Observation, OntologyEvent, Property, Severity, Space } from './schema.ts';

export type NodeType = 'property' | 'space' | 'observation';
export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  r: number;
  severity?: Severity;
  status?: string;
  events: number;
}
export type EdgeType = 'har-yta' | 'del-av' | 'har-observation';
export interface GraphEdge { from: string; to: string; type: EdgeType }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; bounds: { minX: number; minY: number; width: number; height: number } }

/**
 * Bygger relationsgrafen för en fastighet med en deterministisk radiell layout (inget layoutbibliotek):
 * fastigheten i mitten, ytor i en inre ring (underytor bredvid sin förälder), observationer i en yttre ring.
 */
export function buildGraph(
  data: { properties: Property[]; spaces: Space[]; observations: Observation[]; events: OntologyEvent[] },
  propertyId: string,
): Graph {
  const prop = data.properties.find((p) => p.id === propertyId);
  if (!prop) return { nodes: [], edges: [], bounds: { minX: -100, minY: -100, width: 200, height: 200 } };

  const evCount = new Map<string, number>();
  for (const e of data.events) evCount.set(e.subjectId, (evCount.get(e.subjectId) ?? 0) + 1);

  const spaces = data.spaces.filter((s) => s.propertyId === propertyId);
  // Ordna så att underytor kommer direkt efter sin förälder.
  const ordered: Space[] = [];
  const visit = (parent: string | undefined) => {
    for (const s of spaces.filter((x) => x.parentSpaceId === parent).sort((a, b) => a.name.localeCompare(b.name, 'sv'))) {
      ordered.push(s);
      visit(s.id);
    }
  };
  visit(undefined);
  for (const s of spaces) if (!ordered.includes(s)) ordered.push(s); // föräldralösa (bör inte förekomma)

  const nodes: GraphNode[] = [{ id: prop.id, type: 'property', label: prop.name, x: 0, y: 0, r: 26, events: evCount.get(prop.id) ?? 0 }];
  const edges: GraphEdge[] = [];
  const R1 = 150;
  const R2 = 270;
  const n = Math.max(ordered.length, 1);

  ordered.forEach((s, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    nodes.push({ id: s.id, type: 'space', label: s.name, x: Math.cos(a) * R1, y: Math.sin(a) * R1, r: 16, events: evCount.get(s.id) ?? 0 });
    edges.push(s.parentSpaceId ? { from: s.parentSpaceId, to: s.id, type: 'del-av' } : { from: prop.id, to: s.id, type: 'har-yta' });

    const obs = data.observations.filter((o) => o.spaceId === s.id);
    const spread = Math.min(((Math.PI * 2) / n) * 0.8, 0.25 * obs.length);
    obs.forEach((o, j) => {
      const b = a + (obs.length > 1 ? (j / (obs.length - 1) - 0.5) * spread : 0);
      const r = R2 + (j % 2) * 34;
      nodes.push({
        id: o.id, type: 'observation', label: o.title, x: Math.cos(b) * r, y: Math.sin(b) * r, r: 8 + o.severity * 2,
        severity: o.severity, status: o.status, events: evCount.get(o.id) ?? 0,
      });
      edges.push({ from: s.id, to: o.id, type: 'har-observation' });
    });
  });

  const pad = 60;
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  return { nodes, edges, bounds: { minX, minY, width: Math.max(...xs) + pad - minX, height: Math.max(...ys) + pad - minY } };
}

/** Grannar till en nod (för markering och detaljvy). */
export function neighbours(g: Graph, id: string): Set<string> {
  const s = new Set<string>([id]);
  for (const e of g.edges) {
    if (e.from === id) s.add(e.to);
    if (e.to === id) s.add(e.from);
  }
  return s;
}
