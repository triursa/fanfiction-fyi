export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { works, creatorships, pseuds, workRelations } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

// GET /api/works/[id]/lineage — recursive graph data (depth-limited to 3 hops)
// Returns nodes (works) and edges (relations) for visualization
export const GET: APIRoute = async ({ params, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const MAX_DEPTH = 3;
  const visited = new Set<number>();
  const nodes: any[] = [];
  const edges: any[] = [];

  // BFS traversal collecting works and relations
  async function traverse(currentId: number, depth: number) {
    if (depth > MAX_DEPTH || visited.has(currentId)) return;
    visited.add(currentId);

    // Fetch work info with author names — use raw D1 for GROUP_CONCAT
    const w = await d1.prepare(
      `SELECT w.id, w.title, w.word_count, w.published_at,
              GROUP_CONCAT(p.name, ', ') as authors
       FROM works w
       LEFT JOIN creatorships c ON c.work_id = w.id
       LEFT JOIN pseuds p ON p.id = c.pseud_id AND c.role = 'author'
       WHERE w.id = ?
       GROUP BY w.id`
    ).bind(currentId).first<any>();

    if (!w) return;

    nodes.push({
      id: w.id,
      title: w.title,
      word_count: w.word_count,
      published: !!w.published_at,
      authors: w.authors || '',
      isRoot: w.id === workId,
    });

    // Fetch outgoing relations
    const outgoing = await db.select().from(workRelations).where(eq(workRelations.workId, currentId));
    for (const edge of outgoing) {
      edges.push({
        id: edge.id,
        source: edge.workId,
        target: edge.relatedWorkId,
        relation_type: edge.relationType,
        direction: 'outgoing',
      });
      if (!visited.has(edge.relatedWorkId)) {
        await traverse(edge.relatedWorkId, depth + 1);
      }
    }

    // Fetch incoming relations
    const incoming = await db.select().from(workRelations).where(eq(workRelations.relatedWorkId, currentId));
    for (const edge of incoming) {
      edges.push({
        id: edge.id,
        source: edge.workId,
        target: edge.relatedWorkId,
        relation_type: edge.relationType,
        direction: 'incoming',
      });
      if (!visited.has(edge.workId)) {
        await traverse(edge.workId, depth + 1);
      }
    }
  }

  await traverse(workId, 0);

  // Deduplicate edges
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