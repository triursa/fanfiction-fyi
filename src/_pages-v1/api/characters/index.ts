export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { characters, characterGroups, characterAppearances } from '@/lib/schema';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { eq, and, like, sql, isNotNull, desc, asc, count } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const params = url.searchParams;

  const q = params.get('q') || '';
  const fandom = params.get('fandom') || '';
  const groupId = params.get('group_id') || '';
  const hasGroup = params.get('has_group') === 'true';
  const sort = params.get('sort') || 'name';
  const page = Math.max(Number(params.get('page') || 1), 1);
  const limit = Math.min(Number(params.get('limit') || 25), 100);
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];
  if (q) conditions.push(like(characters.name, `%${q}%`));
  if (fandom) conditions.push(eq(characters.fandom, fandom));
  if (groupId) conditions.push(eq(characters.groupId, Number(groupId)));
  if (hasGroup) conditions.push(isNotNull(characters.groupId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count query
  const countRow = await drz
    .select({ total: count() })
    .from(characters)
    .where(where)
    .get();
  const total = countRow?.total ?? 0;

  // Data query with subquery for work_count and left join for group_name
  const validSorts: Record<string, any> = {
    name: asc(characters.name),
    recent: desc(characters.createdAt),
    works: desc(sql`work_count`),
  };

  const charRows = await drz
    .select({
      id: characters.id,
      name: characters.name,
      fandom: characters.fandom,
      groupId: characters.groupId,
      tagId: characters.tagId,
      description: characters.description,
      shortDesc: characters.shortDesc,
      avatarKey: characters.avatarKey,
      aliases: characters.aliases,
      createdBy: characters.createdBy,
      updatedBy: characters.updatedBy,
      createdAt: characters.createdAt,
      updatedAt: characters.updatedAt,
      workCount: sql<number>`(SELECT COUNT(*) FROM character_appearances ca WHERE ca.character_id = ${characters.id})`.as('work_count'),
      groupName: characterGroups.name,
    })
    .from(characters)
    .leftJoin(characterGroups, eq(characters.groupId, characterGroups.id))
    .where(where)
    .orderBy(validSorts[sort] || validSorts.name)
    .limit(limit)
    .offset(offset);

  // Convert camelCase keys to snake_case for API compatibility
  const charactersResult = charRows.map(c => ({
    id: c.id,
    name: c.name,
    fandom: c.fandom,
    group_id: c.groupId,
    tag_id: c.tagId,
    description: c.description,
    short_desc: c.shortDesc,
    avatar_key: c.avatarKey,
    aliases: c.aliases,
    created_by: c.createdBy,
    updated_by: c.updatedBy,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    work_count: c.workCount,
    group_name: c.groupName,
  }));

  return new Response(JSON.stringify({ characters: charactersResult, total, page, limit }), {
    headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') },
  });
};