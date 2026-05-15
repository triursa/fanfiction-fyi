import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema/index';

export type Database = ReturnType<typeof getDb>;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}