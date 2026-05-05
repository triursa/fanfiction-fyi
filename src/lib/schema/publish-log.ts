import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const publishLog = sqliteTable('publish_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id'),
  chapterId: integer('chapter_id'),
  step: text('step').notNull(),
  status: text('status', {
    enum: ['attempt', 'success', 'fail'],
  }).notNull(),
  httpStatus: integer('http_status'),
  error: text('error'),
  userId: integer('user_id'),
  requestSummary: text('request_summary'),
  responseSummary: text('response_summary'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const idxPublishLogWork = index('idx_publish_log_work').on(publishLog.workId);
export const idxPublishLogStep = index('idx_publish_log_step').on(publishLog.step);
export const idxPublishLogCreated = index('idx_publish_log_created').on(publishLog.createdAt);