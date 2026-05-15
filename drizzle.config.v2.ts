import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/v2/lib/schema/index.ts',
  out: './drizzle/v2',
  dialect: 'sqlite',
});