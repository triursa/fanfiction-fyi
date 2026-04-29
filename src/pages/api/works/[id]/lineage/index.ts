export const prerender = false;

import { queryFirst, queryAll } from '@/lib/db';
import type { APIRoute } from 'astro';

// GET /api/works/[id]/lineage — recursive graph data (depth-limited to 3 hops)
// Returns nodes (works) and edges (relations) for visualization
export const GET: APIRoute = async ({ params, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, workId);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const MAX_DEPTH = 3;
  const visited = new Set<number>();
  const nodes: any[] = [];
  const edges: any[] = [];

  // BFS traversal collecting works and relations
  async function traverse(currentId: number, depth: number) {
    if (depth > MAX_DEPTH || visited.has(currentId)) return;
    visited.add(currentId);

    // Fetch work info
    const w = await queryFirst<any>(
      db,
      `SELECT w.id, w.title, w.word_count, w.published_at,
              GROUP_CONCAT(p.name, ', ') as authors
       FROM works w
       LEFT JOIN creatorships c ON c.work_id = w.id
       LEFT JOIN pseuds p ON p.id = c.pseud_id AND c.role = 'author'
       WHERE w.id = ?1
       GROUP BY w.id`,
      currentId
    );

    if (!w) return;

    nodes.push({
      id: w.id,
      title: w.title,
      word_count: w.word_count,
      published: !!w.published_at,
      authors: w.authors || '',
      isRoot: w.id === workId,
    });

    // Fetch outgoing relations (this work → other works)
    const outgoing = await queryAll<any>(
      db,
      `SELECT wr.id as edge_id, wr.work_id, wr.related_work_id, wr.relation_type
       FROM work_relations wr
       WHERE wr.work_id = ?1`,
      currentId
    );

    for (const edge of outgoing) {
      edges.push({
        id: edge.edge_id,
        source: edge.work_id,
        target: edge.related_work_id,
        relation_type: edge.relation_type,
        direction: 'outgoing',
      });
      if (!visited.has(edge.related_work_id)) {
        await traverse(edge.related_work_id, depth + 1);
      }
    }

    // Fetch incoming relations (other works → this work)
    const incoming = await queryAll<any>(
      db,
      `SELECT wr.id as edge_id, wr.work_id, wr.related_work_id, wr.relation_type
       FROM work_relations wr
       WHERE wr.related_work_id = ?1`,
      currentId
    );

    for (const edge of incoming) {
      edges.push({
        id: edge.edge_id,
        source: edge.work_id,
        target: edge.related_work_id,
        relation_type: edge.relation_type,
        direction: 'incoming',
      });
      if (!visited.has(edge.work_id)) {
        await traverse(edge.work_id, depth + 1);
      }
    }
  }

  await traverse(workId, 0);

  // Deduplicate edges (same edge_id can appear twice if we traverse both directions)
  const seenEdges = new Set<number>();
  const uniqueEdges = edges.filter(e => {
    if (seenEdges.has(e.id)) return false;
    seenEdges.add(e.id);
    return true;
  });

  return new Response(JSON.stringify({ nodes, edges: uniqueEdges }), {
    headers: { 'Content-Type': 'application/json' },
  });
};