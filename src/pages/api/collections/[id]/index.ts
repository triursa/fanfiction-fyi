export const prerender = false;

import { queryFirst, queryAll } from '@/lib/db';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const collectionId = Number(params.id);
  if (!collectionId) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const collection = await queryFirst<any>(db,
    `SELECT c.*, p.name as owner_name
     FROM collections c
     JOIN pseuds p ON c.owner_pseud_id = p.id
     WHERE c.id = ?1`,
    collectionId
  );

  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Only show public/unrevealed collections via API
  if (!['public', 'unrevealed'].includes(collection.privacy)) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const works = await queryAll<any>(db,
    `SELECT w.id, w.title, w.summary, w.word_count, w.published_at
     FROM works w
     JOIN collection_items ci ON w.id = ci.work_id
     WHERE ci.collection_id = ?1
       AND w.published_at IS NOT NULL`,
    collectionId
  );

  return new Response(JSON.stringify({ collection, works }), {
    headers: { 'Content-Type': 'application/json' }
  });
};