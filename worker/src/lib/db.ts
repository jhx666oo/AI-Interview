import { verifyJwt } from './crypto';

// ==================== D1 Helpers ====================

export function uuid(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

const ENUM_FIELDS = new Set([
  'role', 'status', 'urgency', 'position_type', 'screening_result', 'stage',
  'reject_reason_category', 'result', 'interview_type', 'interview_category',
  'test_type', 'channel_type', 'overall_result', 'employment_type',
  'contract_type', 'trigger_type', 'node_type', 'question_generation_status',
  'parse_status', 'recommendation'
]);

export function transformRow(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'number' && (value === 0 || value === 1) && /^is_/.test(key)) {
      result[key] = value === 1;
    } else if (typeof value === 'string' && value.length > 0 && (value[0] === '{' || value[0] === '[')) {
      try { result[key] = JSON.parse(value); } catch { result[key] = value; }
    } else if (ENUM_FIELDS.has(key) && typeof value === 'string') {
      result[key] = value.toLowerCase();
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function prepareValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function validCol(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// ==================== Generic CRUD ====================

export async function registerCrud(app: any, table: string, authMiddleware: any, options?: { filters?: Record<string, (c: any) => string | null> }) {
  const base = `/api/${table.replace(/_/g, '-')}`;

  // LIST
  app.get(base, authMiddleware, async (c: any) => {
    try {
      let sql = `SELECT * FROM ${table} WHERE 1=1`;
      const params: any[] = [];
      if (options?.filters) {
        for (const [col, fn] of Object.entries(options.filters)) {
          const val = fn(c);
          if (val !== null && val !== undefined && val !== '') {
            sql += ` AND ${col} = ?`;
            params.push(val);
          }
        }
      }
      sql += ' ORDER BY created_at DESC';
      const { results } = await c.env.DB.prepare(sql).bind(...params).all();
      return c.json((results || []).map(transformRow));
    } catch (e: any) { return c.json({ detail: e.message }, 500); }
  });

  // GET by ID
  app.get(`${base}/:id`, authMiddleware, async (c: any) => {
    try {
      const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(c.req.param('id')).first();
      if (!row) return c.json({ detail: 'Not found' }, 404);
      return c.json(transformRow(row));
    } catch (e: any) { return c.json({ detail: e.message }, 500); }
  });

  // CREATE
  app.post(base, authMiddleware, async (c: any) => {
    try {
      const body = await c.req.json();
      body.id = body.id || uuid();
      const nowStr = now();
      const cols = Object.keys(body).filter(validCol);
      const values = cols.map(k => prepareValue(body[k]));
      const placeholders = cols.map(() => '?').join(', ');
      const colList = cols.join(', ');
      await c.env.DB.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`).bind(...values).run();
      const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(body.id).first();
      return c.json(transformRow(row), 201);
    } catch (e: any) { return c.json({ detail: e.message }, 500); }
  });

  // UPDATE
  app.put(`${base}/:id`, authMiddleware, async (c: any) => {
    try {
      const body = await c.req.json();
      const sets: string[] = [];
      const values: any[] = [];
      for (const k of Object.keys(body)) {
        if (!validCol(k) || k === 'id' || k === 'created_at') continue;
        sets.push(`${k} = ?`);
        values.push(prepareValue(body[k]));
      }
      if (sets.length === 0) return c.json({ detail: 'No fields to update' }, 400);
      sets.push(`updated_at = '${now()}'`);
      values.push(c.req.param('id'));
      await c.env.DB.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
      const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(c.req.param('id')).first();
      return c.json(transformRow(row));
    } catch (e: any) { return c.json({ detail: e.message }, 500); }
  });

  // DELETE
  app.delete(`${base}/:id`, authMiddleware, async (c: any) => {
    try {
      await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(c.req.param('id')).run();
      return c.json({ detail: 'Deleted' });
    } catch (e: any) { return c.json({ detail: e.message }, 500); }
  });
}

// ==================== Auth Middleware ====================

export async function getUser(db: D1Database, email: string): Promise<any | null> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  return row ? transformRow(row) : null;
}

export function authMiddlewareFn(secretKey: string): any {
  return async (c: any, next: any) => {
    const auth = c.req.header('Authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return c.json({ detail: 'Not authenticated' }, 401);
    const payload = await verifyJwt(secretKey, match[1]);
    if (!payload) return c.json({ detail: 'Invalid token' }, 401);
    const user = await getUser(c.env.DB, payload.sub);
    if (!user) return c.json({ detail: 'User not found' }, 401);
    if (!user.is_active) return c.json({ detail: 'Account disabled' }, 403);
    c.set('user', user);
    await next();
  };
}

export function serializeUser(user: any) {
  const { hashed_password, ...rest } = user;
  return { ...rest, has_password: !!hashed_password, plain_password: rest.plain_password || (hashed_password ? '123456' : '') };
}

export function requireRole(roles: string[]) {
  return async (c: any, next: any) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ detail: 'Operation not permitted' }, 403);
    }
    await next();
  };
}

export function getOwnerName(c: any): string | null {
  const user = c.get('user');
  if (!user || user.role === 'admin') return null;
  return user.full_name || null;
}
