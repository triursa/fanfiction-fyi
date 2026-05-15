export const prerender = false;

import type { APIRoute } from 'astro';

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'fanfiction.fyi API',
    version: '1.0.0',
    description: 'The fanfiction.fyi read/write API provides JSON access to works, tags, search, collections, comments, and more. Public read endpoints support CORS. Authenticated endpoints require a session cookie or Bearer API key.',
    contact: { url: 'https://fanfiction.fyi' },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: 'https://fanfiction.fyi', description: 'Production' },
  ],
  security: [
    { cookieAuth: [] },
    { bearerAuth: [] },
  ],
  paths: {
    '/api/works': {
      get: {
        summary: 'List published works',
        tags: ['Works'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 }, description: 'Results per page' },
          { name: 'tag_type', in: 'query', schema: { type: 'string' }, description: 'Filter by tag type (fandom, character, etc.)' },
          { name: 'tag_name', in: 'query', schema: { type: 'string' }, description: 'Filter by tag name (substring match)' },
        ],
        responses: {
          '200': { description: 'List of works' },
        },
      },
    },
    '/api/works/{id}': {
      get: {
        summary: 'Get a work by ID',
        tags: ['Works'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Work details' }, '404': { description: 'Work not found' } },
      },
    },
    '/api/works/{id}/chapters': {
      get: {
        summary: 'List chapters for a work',
        tags: ['Works'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Chapter list' } },
      },
    },
    '/api/works/{id}/chapters/{chapterId}': {
      get: {
        summary: 'Get a chapter by ID',
        tags: ['Works'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'chapterId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Chapter content' }, '404': { description: 'Not found' } },
      },
    },
    '/api/works/{id}/comments': {
      get: {
        summary: 'List comments on a work',
        tags: ['Comments'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: { '200': { description: 'Comment list' } },
      },
      post: {
        summary: 'Post a comment',
        tags: ['Comments'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string' }, parent_id: { type: 'integer' } } } } },
        },
        responses: { '201': { description: 'Comment created' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/api/works/{id}/lineage': {
      get: {
        summary: 'Get chapter lineage (tree structure)',
        tags: ['Works'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Lineage tree' } },
      },
    },
    '/api/works/{id}/relations': {
      get: {
        summary: 'Get work relationships',
        tags: ['Works'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Relationships' } },
      },
    },
    '/api/works/{id}/export': {
      get: {
        summary: 'Export a work as EPUB or TXT',
        tags: ['Works'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['epub', 'txt'] }, description: 'Export format' },
        ],
        responses: { '200': { description: 'Exported file' } },
      },
    },
    '/api/search': {
      get: {
        summary: 'Full-text search',
        tags: ['Search'],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Search query' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'tag_type', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['complete', 'wip'] } },
        ],
        responses: { '200': { description: 'Search results' } },
      },
    },
    '/api/tags/browse': {
      get: {
        summary: 'Browse tags by type',
        tags: ['Tags'],
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: { '200': { description: 'Tags list' } },
      },
    },
    '/api/tags': {
      get: {
        summary: 'List all tags',
        tags: ['Tags'],
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, description: 'Filter by name' }],
        responses: { '200': { description: 'Tags list' } },
      },
    },
    '/api/characters': {
      get: {
        summary: 'List characters',
        tags: ['Characters'],
        parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }],
        responses: { '200': { description: 'Characters list' } },
      },
    },
    '/api/characters/{id}': {
      get: {
        summary: 'Get character by ID',
        tags: ['Characters'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Character details' } },
      },
    },
    '/api/pseuds/{id}/public': {
      get: {
        summary: 'Get public pseud profile',
        tags: ['Pseuds'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Pseud profile' } },
      },
    },
    '/api/pseuds': {
      get: {
        summary: 'List pseuds (authors)',
        tags: ['Pseuds'],
        responses: { '200': { description: 'Pseuds list' } },
      },
    },
    '/api/collections/{id}': {
      get: {
        summary: 'Get collection by ID',
        tags: ['Collections'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Collection details' } },
      },
    },
    '/api/collections': {
      get: {
        summary: 'List collections',
        tags: ['Collections'],
        responses: { '200': { description: 'Collections list' } },
      },
    },
    '/api/series/{id}': {
      get: {
        summary: 'Get series by ID',
        tags: ['Series'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Series details' } },
      },
    },
    '/api/series': {
      get: {
        summary: 'List series',
        tags: ['Series'],
        responses: { '200': { description: 'Series list' } },
      },
    },
    '/api/canon/lore': {
      get: {
        summary: 'List canon lore entries',
        tags: ['Canon'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Lore entries' } },
      },
    },
    '/api/canon/locations': {
      get: {
        summary: 'List canon locations',
        tags: ['Canon'],
        responses: { '200': { description: 'Locations' } },
      },
    },
    '/api/canon/references': {
      get: {
        summary: 'List canon references',
        tags: ['Canon'],
        responses: { '200': { description: 'References' } },
      },
    },
    '/api/notifications': {
      get: {
        summary: 'List notifications',
        tags: ['Notifications'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } },
        ],
        responses: { '200': { description: 'Notifications list with unread count' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/api/notifications/read': {
      put: {
        summary: 'Mark notifications as read',
        tags: ['Notifications'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer', description: 'Notification ID, or omit to mark all as read' } } } } },
        },
        responses: { '200': { description: 'Success' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/api/notifications/preferences': {
      get: {
        summary: 'Get notification preferences',
        tags: ['Notifications'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { '200': { description: 'Preferences list' }, '401': { description: 'Unauthorized' } },
      },
      put: {
        summary: 'Update notification preference',
        tags: ['Notifications'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['type', 'enabled'], properties: { type: { type: 'string', enum: ['comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system'] }, enabled: { type: 'boolean' } } } } },
        },
        responses: { '200': { description: 'Success' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/api/user/keys': {
      get: {
        summary: 'List API keys',
        tags: ['API Keys'],
        security: [{ cookieAuth: [] }],
        responses: { '200': { description: 'API keys list' }, '401': { description: 'Unauthorized' } },
      },
      post: {
        summary: 'Create a new API key',
        tags: ['API Keys'],
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 64 } } } } },
        },
        responses: { '201': { description: 'Key created — plaintext key shown once' }, '400': { description: 'Validation error' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/api/user/keys/{id}': {
      delete: {
        summary: 'Revoke an API key',
        tags: ['API Keys'],
        security: [{ cookieAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Key revoked' }, '404': { description: 'Key not found' }, '401': { description: 'Unauthorized' } },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
        description: 'Session cookie obtained from login',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key starting with ffy_ — obtain from /settings > API Keys',
      },
    },
    schemas: {
      Work: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          summary: { type: 'string' },
          word_count: { type: 'integer' },
          published_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          language: { type: 'string' },
          complete: { type: 'integer' },
          tags: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } } } },
          pseuds: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' } } } },
        },
      },
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'] },
        },
      },
      Collection: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          privacy: { type: 'string' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          type: { type: 'string', enum: ['comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system'] },
          title: { type: 'string' },
          body: { type: 'string' },
          link: { type: 'string' },
          read: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          keyPrefix: { type: 'string' },
          rateLimitTier: { type: 'string', enum: ['free', 'pro'] },
          lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};