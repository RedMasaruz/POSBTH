import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

// --- Types ---
type Bindings = {
  DB: D1Database;
  __STATIC_CONTENT: KVNamespace;
  JWT_SECRET?: string;
  ADMIN_PASSWORD?: string;
};

type Variables = {
  user?: { id: number; username: string; name: string; role: string };
};

type OrderItem = {
  productId: string;
  quantity: number;
  name?: string;
  price?: number;
};

type OrderBody = {
  id?: string;
  items: OrderItem[];
  payment_method?: string;
  status?: string;
  notes?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  userId?: number;
  userName?: string;
  customer_name?: string;
  customer_address?: string;
  customer_phone?: string;
  slip_image?: string;
  payment_details?: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const assetManifest = JSON.parse(manifestJSON);

// ==========================================
// 🔒 SECURITY INFRASTRUCTURE
// ==========================================

// --- Password Hashing (Web Crypto API / PBKDF2) ---
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, KEY_LENGTH * 8
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Support legacy plain-text passwords (no ':' separator)
  if (!storedHash.includes(':')) {
    return password === storedHash;
  }
  const [saltHex, hashHex] = storedHash.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, KEY_LENGTH * 8
  );
  const computedHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === hashHex;
}

// --- JWT (Stateless Token-Based Auth) ---
const JWT_EXPIRY_SECONDS = 8 * 60 * 60; // 8 hours

function getJwtSecret(c: any): string {
  return c.env.JWT_SECRET || 'pos-kratom-default-secret-change-me-2026';
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  data.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signJWT(payload: any, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + JWT_EXPIRY_SECONDS };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${signatureB64}`;
}

async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const signatureBytes = base64UrlDecode(signatureB64);
    const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(signingInput));

    if (!isValid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// --- Rate Limiter (In-Memory, Per-Worker) ---
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_MAX = 5;       // Max 5 attempts
const RATE_LIMIT_WINDOW = 60000; // per 60 seconds

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || (now - record.lastAttempt > RATE_LIMIT_WINDOW)) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }
  record.count++;
  record.lastAttempt = now;
  if (record.count > RATE_LIMIT_MAX) return true;
  return false;
}

function resetRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

// --- Order Rate Limiter (Anti-Spam) ---
const orderAttempts = new Map<string, { count: number; lastAttempt: number }>();
const ORDER_RATE_MAX = 10;        // Max 10 orders
const ORDER_RATE_WINDOW = 60000;  // per 60 seconds

function isOrderRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = orderAttempts.get(ip);
  if (!record || (now - record.lastAttempt > ORDER_RATE_WINDOW)) {
    orderAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }
  record.count++;
  record.lastAttempt = now;
  if (record.count > ORDER_RATE_MAX) return true;
  return false;
}

// --- Input Validation Helpers ---
const MAX_SLIP_SIZE = 500 * 1024; // 500KB max for Base64 slip images

function sanitizeString(input: any, maxLength: number = 500): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength);
}

function validatePaymentMethod(method: string): boolean {
  return ['cash', 'promptpay', 'transfer'].includes(method);
}

function validateOrderStatus(status: string): boolean {
  return ['completed', 'pending_verification', 'cancelled'].includes(status);
}

// ==========================================
// 🛡️ MIDDLEWARE
// ==========================================

// CORS
app.use('/api/*', cors());

// Secure Headers (Anti-XSS, Anti-Clickjacking, HSTS)
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Permissive CSP for POS app (needs inline scripts for Bootstrap/SweetAlert)
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https://cdn-icons-png.flaticon.com; connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com https://cdn-icons-png.flaticon.com;");
});

// JWT Auth Middleware (protects sensitive routes)
const requireAuth = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(c, 'Unauthorized: No token provided', 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, getJwtSecret(c));
  if (!payload) {
    return errorResponse(c, 'Unauthorized: Invalid or expired token', 401);
  }
  c.set('user', payload);
  await next();
};

// Role-based middleware factory
const requireRole = (...roles: string[]) => {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return errorResponse(c, 'Forbidden: Insufficient permissions', 403);
    }
    await next();
  };
};

// --- General Utilities ---
const generateId = (prefix: string) => {
  const datePart = new Date().toISOString().replace(/[-:T.]/g, '').slice(2, 14);
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}${datePart}${randomPart}`;
};

const errorResponse = (c: any, message: string, status: number = 400) => {
  return c.json({ success: false, message: message, error: message }, status);
};

// ==========================================
// 🔑 AUTH API (Rate Limited + JWT)
// ==========================================
app.post('/api/auth/login', async (c) => {
  try {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

    // Rate Limiting Check
    if (isRateLimited(ip)) {
      return errorResponse(c, 'Too many login attempts. Please wait 60 seconds.', 429);
    }

    const { username, password } = await c.req.json();
    if (!username || !password) return errorResponse(c, 'Missing credentials', 400);

    const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(sanitizeString(username, 50)).first();

    if (!user) {
      // Log failed login (unknown user)
      try { await c.env.DB.prepare('INSERT INTO login_log (username, success, ip_address, user_agent) VALUES (?, 0, ?, ?)').bind(sanitizeString(username, 50), ip, (c.req.header('User-Agent') || '').substring(0, 200)).run(); } catch (_) { }
      return errorResponse(c, 'Invalid Credentials', 401);
    }

    // Verify password (supports both hashed and legacy plain-text)
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      // Log failed login (wrong password)
      try { await c.env.DB.prepare('INSERT INTO login_log (username, success, ip_address, user_agent) VALUES (?, 0, ?, ?)').bind(user.username, ip, (c.req.header('User-Agent') || '').substring(0, 200)).run(); } catch (_) { }
      return errorResponse(c, 'Invalid Credentials', 401);
    }

    // Auto-migrate legacy plain-text password to hashed
    if (!user.password.includes(':')) {
      const hashedPw = await hashPassword(password);
      await c.env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hashedPw, user.id).run();
    }

    // Reset rate limit on successful login
    resetRateLimit(ip);

    // Generate JWT Token
    const tokenPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    };
    const token = await signJWT(tokenPayload, getJwtSecret(c));

    // Log successful login
    try { await c.env.DB.prepare('INSERT INTO login_log (username, success, ip_address, user_agent) VALUES (?, 1, ?, ?)').bind(user.username, ip, (c.req.header('User-Agent') || '').substring(0, 200)).run(); } catch (_) { }

    return c.json({
      success: true,
      token,
      user: tokenPayload
    });

  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Verify Token Endpoint (for frontend session check)
app.get('/api/auth/verify', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json({ success: true, valid: true, user });
});

// Login Audit Log (Owner only)
app.get('/api/login-log', requireAuth, requireRole('owner'), async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM login_log ORDER BY timestamp DESC LIMIT 100'
    ).all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Password Migration Endpoint (Owner only - one-time use)
app.post('/api/auth/migrate-passwords', requireAuth, requireRole('owner'), async (c) => {
  try {
    const { results: users }: any = await c.env.DB.prepare('SELECT id, password FROM users').all();
    let migrated = 0;
    for (const user of users) {
      if (!user.password.includes(':')) {
        const hashedPw = await hashPassword(user.password);
        await c.env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hashedPw, user.id).run();
        migrated++;
      }
    }
    return c.json({ success: true, message: `Migrated ${migrated} password(s) to secure hash` });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// ==========================================
// 👥 USER MANAGEMENT (Owner Only)
// ==========================================
app.get('/api/users', requireAuth, requireRole('owner'), async (c) => {
  try {
    const { results } = await c.env.DB.prepare("SELECT id, username, name, role, created_at FROM users ORDER BY id").all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

app.post('/api/users', requireAuth, requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json();
    if (!body.username || !body.password || !body.name || !body.role) {
      return errorResponse(c, 'Missing required fields');
    }
    // Hash the password before storing
    const hashedPassword = await hashPassword(body.password);
    await c.env.DB.prepare(
      "INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)"
    ).bind(
      sanitizeString(body.username, 50),
      hashedPassword,
      sanitizeString(body.name, 100),
      sanitizeString(body.role, 20)
    ).run();
    return c.json({ success: true, message: 'User created' }, 201);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

app.put('/api/users/:id', requireAuth, requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const updates = [];
    const params = [];

    if (body.password) {
      const hashedPassword = await hashPassword(body.password);
      updates.push("password = ?"); params.push(hashedPassword);
    }
    if (body.name) { updates.push("name = ?"); params.push(sanitizeString(body.name, 100)); }
    if (body.role) { updates.push("role = ?"); params.push(sanitizeString(body.role, 20)); }

    if (updates.length > 0) {
      params.push(id);
      await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    }
    return c.json({ success: true, message: 'User updated' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return c.json({ success: true, message: 'User deleted' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// ==========================================
// 📊 ANALYTICS (Owner + Staff)
// ==========================================
app.get('/api/analytics', requireAuth, async (c) => {
  try {
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    let dateFilter = "";
    const params: any[] = [];

    if (startDate && endDate) {
      dateFilter = `WHERE date(created_at) >= ? AND date(created_at) <= ?`;
      params.push(sanitizeString(startDate, 10), sanitizeString(endDate, 10));
    }

    const bindQuery = (q: string) => {
      const stmt = c.env.DB.prepare(q);
      return params.length > 0 ? stmt.bind(...params) : stmt;
    };

    const kpiQuery = `
            SELECT 
                COUNT(id) as totalOrders,
                SUM(total) as totalSales,
                AVG(total) as avgOrderValue
            FROM orders ${dateFilter}
        `;
    const kpiResult: any = await bindQuery(kpiQuery).first();

    const trendQuery = `
            SELECT 
                STRFTIME('%Y-%m-%d', created_at) as date,
                SUM(total) as total
            FROM orders ${dateFilter}
            GROUP BY date
            ORDER BY date
        `;
    const { results: salesTrend } = await bindQuery(trendQuery).all();

    const paymentQuery = `
        SELECT payment_method as name, COUNT(*) as count 
        FROM orders ${dateFilter} 
        GROUP BY payment_method
    `;
    const { results: paymentMethods } = await bindQuery(paymentQuery).all();

    const statusQuery = `
        SELECT status, COUNT(*) as count 
        FROM orders ${dateFilter} 
        GROUP BY status
    `;
    const { results: orderStatus } = await bindQuery(statusQuery).all();

    const staffQuery = `
        SELECT created_by_name as name, SUM(total) as total 
        FROM orders ${dateFilter} 
        GROUP BY created_by_name 
        ORDER BY total DESC 
        LIMIT 5
    `;
    const { results: topStaff } = await bindQuery(staffQuery).all();

    const joinFilter = startDate && endDate ? `WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?` : '';

    const finalProductQuery = `
        SELECT p.name, SUM(oi.quantity) as quantity, SUM(oi.quantity * oi.price_at_time) as total
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        ${joinFilter}
        GROUP BY p.name
        ORDER BY quantity DESC
        LIMIT 5
    `;
    const { results: topProducts } = await bindQuery(finalProductQuery).all();

    const categoryQuery = `
        SELECT p.category as name, SUM(oi.quantity * oi.price_at_time) as total
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        ${joinFilter}
        GROUP BY p.category
    `;
    const { results: categorySales } = await bindQuery(categoryQuery).all();

    const totalProductsQuery = `
        SELECT SUM(oi.quantity) as total
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        ${joinFilter}
    `;
    const totalProductsResult: any = await bindQuery(totalProductsQuery).first();
    const totalProductsSold = totalProductsResult?.total || 0;

    const profitQuery = `SELECT items FROM orders ${dateFilter}`;
    const { results: orderItemsBlob } = await bindQuery(profitQuery).all();

    let totalCost = 0;
    orderItemsBlob.forEach((row: any) => {
      try {
        const items = JSON.parse(row.items);
        items.forEach((item: any) => {
          totalCost += (item.cost || 0) * item.quantity;
        });
      } catch (e) { }
    });

    const totalSales = kpiResult?.totalSales || 0;
    const grossProfit = totalSales - totalCost;

    return c.json({
      kpi: {
        totalOrders: kpiResult?.totalOrders || 0,
        totalSales: totalSales,
        avgOrderValue: kpiResult?.avgOrderValue || 0,
        totalProductsSold,
        totalCost,
        grossProfit
      },
      salesTrend,
      topProducts,
      topStaff,
      categorySales,
      paymentMethods,
      orderStatus
    });

  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Products API ---

// Get all products
app.get('/api/products', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM products ORDER BY id').all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Get single product
app.get('/api/products/:id', async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!product) return errorResponse(c, 'Product not found', 404);
  return c.json(product);
});

// Create product
app.post('/api/products', requireAuth, requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json();

    // Validation
    if (!body.name || !body.sku || body.price === undefined) {
      return errorResponse(c, 'Missing required fields: name, sku, price');
    }

    const id = body.id || generateId('P');

    // Check if ID exists
    const existingId = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
    if (existingId) return errorResponse(c, `Product ID ${id} already exists`, 400);

    // Check SKU uniqueness
    const existing = await c.env.DB.prepare('SELECT id FROM products WHERE sku = ?').bind(body.sku).first();
    if (existing) return errorResponse(c, 'SKU already exists', 400);

    await c.env.DB.prepare(
      `INSERT INTO products (id, name, sku, price, cost, price_dealer, price_vip, stock, min_stock, unit, category, image) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, body.name, body.sku, body.price, body.cost || 0,
      body.price_dealer || 0, body.price_vip || 0,
      body.stock || 0, body.min_stock || 10,
      body.unit || 'ชิ้น', body.category || 'ทั่วไป', body.image || ''
    ).run();

    // Log initial stock
    if (body.stock > 0) {
      await c.env.DB.prepare(
        `INSERT INTO inventory_log (action, product_id, product_name, quantity_change, new_stock, reference)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind('Initial Stock', id, body.name, body.stock, body.stock, 'manual_add').run();
    }

    return c.json({ success: true, id, message: 'Product created' }, 201);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Update product
app.put('/api/products/:id', requireAuth, requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const body: any = await c.req.json();

    if (!id) return errorResponse(c, 'Product ID missing');

    const newId = body.id || id;
    const isIdChanging = newId !== id;

    // Check if newId exists if it's changing
    if (isIdChanging) {
      const existing = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(newId).first();
      if (existing) return errorResponse(c, `ID ${newId} already exists`);
    }

    const updates = [];
    const values = [];

    // Map allowed fields to DB columns
    const fields = [
      'name', 'sku', 'price', 'cost', 'price_dealer', 'price_vip',
      'stock', 'min_stock', 'unit', 'category', 'image'
    ];

    // Add id if changing
    if (isIdChanging) {
      updates.push(`id = ?`);
      values.push(newId);
    }

    for (const field of fields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    if (updates.length === 0) {
      return errorResponse(c, 'No fields to update');
    }

    // Always update timestamp
    updates.push('updated_at = CURRENT_TIMESTAMP');

    values.push(id); // For WHERE clause

    const statements = [];

    // 1. Update Products
    const query = `UPDATE products SET ${updates.join(', ')} WHERE id = ?`;
    statements.push(c.env.DB.prepare(query).bind(...values));

    if (isIdChanging) {
      // 2. Update order_items
      statements.push(c.env.DB.prepare('UPDATE order_items SET product_id = ? WHERE product_id = ?').bind(newId, id));
      // 3. Update inventory_log
      statements.push(c.env.DB.prepare('UPDATE inventory_log SET product_id = ? WHERE product_id = ?').bind(newId, id));
    }

    await c.env.DB.batch(statements);

    return c.json({ success: true, message: 'Product updated', newId: isIdChanging ? newId : undefined });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Delete product
app.delete('/api/products/:id', requireAuth, requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    return c.json({ success: true, message: 'Product deleted' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Inventory API ---

// Get inventory log
app.get('/api/inventory', requireAuth, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM inventory_log ORDER BY timestamp DESC LIMIT 200'
    ).all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Adjust stock manually
app.post('/api/inventory/adjust', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { product_id, quantity, action, reference } = body;

    if (!product_id || quantity === undefined || !action) {
      return errorResponse(c, 'Missing required fields: product_id, quantity, action');
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty === 0) {
      return errorResponse(c, 'Quantity must be a non-zero number');
    }

    // Get current product
    const product: any = await c.env.DB.prepare(
      'SELECT id, name, stock FROM products WHERE id = ?'
    ).bind(product_id).first();

    if (!product) {
      return errorResponse(c, 'Product not found', 404);
    }

    const newStock = product.stock + qty;
    if (newStock < 0) {
      return errorResponse(c, `Cannot reduce stock below 0. Current stock: ${product.stock}`);
    }

    const user = c.get('user');
    const refText = sanitizeString(reference || '', 200) || `manual_adjust_by_${user?.name || 'unknown'}`;

    // Update stock + log
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(newStock, product_id),
      c.env.DB.prepare(
        `INSERT INTO inventory_log (action, product_id, product_name, quantity_change, new_stock, reference)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        sanitizeString(action, 50),
        product_id,
        product.name,
        qty,
        newStock,
        refText
      )
    ]);

    return c.json({
      success: true,
      message: `Stock adjusted: ${product.name} ${qty > 0 ? '+' : ''}${qty} → ${newStock}`,
      newStock
    });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Orders API ---

// Get orders (Auth required - protects customer data)
app.get('/api/orders', requireAuth, async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Create Order (Rate Limited + Validated)
app.post('/api/orders', async (c) => {
  try {
    // Rate limit order creation
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    if (isOrderRateLimited(ip)) {
      return errorResponse(c, 'Too many orders. Please wait before placing another order.', 429);
    }

    const body: OrderBody = await c.req.json();
    const items = body.items || [];

    if (items.length === 0) {
      return errorResponse(c, 'No items in order');
    }

    // Validate slip_image size (prevent oversized uploads)
    if (body.slip_image && body.slip_image.length > MAX_SLIP_SIZE) {
      return errorResponse(c, 'Slip image too large. Maximum 500KB allowed.', 413);
    }

    // 1. Verify Prices and Stock Server-Side
    let serverSubtotal = 0;
    const validatedItems = [];

    // Determine Pricing Tier
    let priceField = 'price'; // Default Retail
    if (body.userId) {
      const user: any = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(body.userId).first();
      if (user) {
        if (user.role === 'dealer') priceField = 'price_dealer';
        if (user.role === 'dealer_vip' || user.role === 'vip') priceField = 'price_vip';
      }
    }

    // Fetch all products involved
    for (const item of items) {
      if (item.quantity <= 0) continue; // Skip invalid quantities

      const product: any = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(item.productId).first();

      if (!product) {
        return errorResponse(c, `Product not found: ${item.productId}`, 400);
      }

      if (product.stock < item.quantity) {
        return errorResponse(c, `Insufficient stock for ${product.name}. Available: ${product.stock}`, 400);
      }

      // Use Server Price based on Tier
      let finalPrice = product[priceField];
      // Fallback to retail if tier price is 0/null
      if (!finalPrice || finalPrice === 0) finalPrice = product.price;

      const itemTotal = finalPrice * item.quantity;
      serverSubtotal += itemTotal;

      validatedItems.push({
        ...item,
        name: product.name, // Ensure name is correct
        price: finalPrice, // Force server price
        cost: product.cost || 0, // Snapshot Cost
        total: itemTotal
      });
    }

    // Calculate Discount
    const setting: any = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'discount_rate'").first();
    const discountRate = parseFloat(setting?.value || '0');
    const discount = serverSubtotal * (discountRate / 100);
    const serverTotal = serverSubtotal - discount;

    const orderId = body.id || generateId('ORD');

    // 2. Execute Transaction (Batch)
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO orders (id, subtotal, tax, total, payment_method, status, notes, items, slip_image, payment_details, created_by, created_by_name, created_at, customer_name, customer_address, customer_phone) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId, serverSubtotal, discount, serverTotal,
        body.payment_method || 'cash', body.status || 'completed', body.notes || '',
        JSON.stringify(validatedItems), body.slip_image || null, body.payment_details || null,
        body.userId ? String(body.userId) : null,
        body.userName || 'Guest', // created_by_name
        new Date().toISOString(),
        body.customer_name || null,
        body.customer_address || null,
        body.customer_phone || null
      )
    ];

    for (const item of validatedItems) {
      // Add to order_items
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES (?, ?, ?, ?)`
        ).bind(orderId, item.productId, item.quantity, item.price)
      );

      // Decrease Stock
      statements.push(
        c.env.DB.prepare(
          `UPDATE products SET stock = stock - ? WHERE id = ?`
        ).bind(item.quantity, item.productId)
      );

      // Log Inventory
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO inventory_log (action, product_id, product_name, quantity_change, new_stock, reference) 
           VALUES (?, ?, ?, ?, (SELECT stock FROM products WHERE id = ?) - ?, ?)`
        ).bind('Sale', item.productId, item.name, -item.quantity, item.productId, item.quantity, orderId)
      );
    }

    await c.env.DB.batch(statements);

    return c.json({ success: true, orderId, message: 'Order processed', total: serverTotal }, 201);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Update Order Status (Admin Verification)
app.patch('/api/orders/:id/status', requireAuth, async (c) => {
  try {
    const id = c.req.param('id');
    const { status } = await c.req.json();

    if (!id || !status) return errorResponse(c, 'Missing Order ID or Status');

    await c.env.DB.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(status, id)
      .run();

    return c.json({ success: true, message: `Order status updated to ${status}` });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});



// Delete Order (With Stock Restoration)
app.delete('/api/orders/:id', requireAuth, requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');

    // 1. Get Order Items to Restore Stock
    const { results: items } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?'
    ).bind(id).all();

    if (!items || items.length === 0) {
      // If no items found, just delete order
      await c.env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
      return c.json({ success: true, message: 'Order deleted (No items to restore)' });
    }

    const statements = [];

    // 2. Restore Stock
    for (const item of items) {
      const product: any = await c.env.DB.prepare('SELECT name, stock FROM products WHERE id = ?').bind(item.product_id).first();
      const productName = product ? product.name : 'Unknown Product';
      const currentStock = product ? product.stock : 0;
      const newStock = currentStock + item.quantity;

      // Update Product Stock
      statements.push(
        c.env.DB.prepare(
          'UPDATE products SET stock = ? WHERE id = ?'
        ).bind(newStock, item.product_id)
      );

      // Log Inventory Action
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO inventory_log (action, product_id, product_name, quantity_change, new_stock, reference)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          'Order Cancelled',
          item.product_id,
          productName,
          item.quantity,
          newStock,
          id
        )
      );
    }

    // 3. Delete Order Records
    statements.push(c.env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id));
    statements.push(c.env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id));

    await c.env.DB.batch(statements);

    return c.json({ success: true, message: 'Order deleted and stock restored' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Settings API ---
// Public settings (safe for guests: store_name, currency, discount_rate)
const PUBLIC_SETTINGS = ['store_name', 'currency', 'discount_rate', 'receipt_header', 'receipt_footer'];

app.get('/api/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM settings').all();
  const settings: any = {};

  // Check if user is authenticated
  const authHeader = c.req.header('Authorization');
  let isAuthenticated = false;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = await verifyJWT(authHeader.slice(7), getJwtSecret(c));
    isAuthenticated = !!payload;
  }

  results.forEach((row: any) => {
    // Only expose safe settings to guests
    if (isAuthenticated || PUBLIC_SETTINGS.includes(row.key)) {
      settings[row.key] = row.value;
    }
  });
  return c.json(settings);
});

app.post('/api/settings', requireAuth, requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json();
    const statements = [];

    for (const [key, value] of Object.entries(body)) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?) 
           ON CONFLICT(key) DO UPDATE SET value = ?`
        ).bind(key, value, value)
      );
    }

    if (statements.length > 0) {
      await c.env.DB.batch(statements);
    }

    return c.json({ success: true, message: 'Settings updated' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Dashboard Stats ---
app.get('/api/stats', requireAuth, async (c) => {
  try {
    const productCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM products').first('count');
    const orderCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM orders').first('count');

    // Today's sales
    const todaySales = await c.env.DB.prepare(
      `SELECT SUM(total) as total FROM orders WHERE date(created_at) = date('now')`
    ).first('total') || 0;

    const lowStock = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM products WHERE stock <= min_stock'
    ).first('count');

    // Daily Sales (Last 7 days)
    const { results: dailySales } = await c.env.DB.prepare(
      `SELECT date(created_at) as date, SUM(total) as sales 
       FROM orders 
       WHERE created_at >= date('now', '-7 days') 
       GROUP BY date(created_at) 
       ORDER BY date(created_at)`
    ).all();

    // Top Products
    const { results: topProducts } = await c.env.DB.prepare(
      `SELECT p.name, SUM(oi.quantity) as quantity 
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       GROUP BY p.name 
       ORDER BY quantity DESC 
       LIMIT 5`
    ).all();

    return c.json({
      products: productCount,
      orders: orderCount,
      todaySales: todaySales,
      lowStock: lowStock,
      dailySales: dailySales || [],
      topProducts: topProducts || []
    });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Fallback for all other GET requests (Static Assets)
app.get('*', async (c) => {
  try {
    const executionCtx = c.executionCtx;
    const fetchEvent = {
      request: c.req.raw,
      waitUntil: (promise: Promise<any>) => executionCtx.waitUntil(promise)
    };

    return await getAssetFromKV(fetchEvent as any, {
      ASSET_NAMESPACE: c.env.__STATIC_CONTENT,
      ASSET_MANIFEST: assetManifest
    });
  } catch (e) {
    return c.text('Not Found', 404);
  }
});

export default app;
