import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

// Quick access to D1 from server routes / pages
export function getDb(Astro: { locals: { runtime: { env: { DB: D1Database } } } }): D1Database {
  return Astro.locals.runtime.env.DB;
}

// Create a Drizzle instance from a D1 binding
export function getDrizzle(d1: D1Database) {
  return drizzle(d1, { schema });
}

