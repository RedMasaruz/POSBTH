import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  __STATIC_CONTENT: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS
app.use('/api/*', cors());

// --- Static Assets Handling ---
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
// Hono middleware or route to handle static assets
// Since strict routing is not used, we can add a fallback route
import manifestJSON from '__STATIC_CONTENT_MANIFEST';
const assetManifest = JSON.parse(manifestJSON);



// --- Utilities ---
const generateId = (prefix: string) => {
  const datePart = new Date().toISOString().replace(/[-:T.]/g, '').slice(2, 14); // YYMMDDHHMMSS
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}${datePart}${randomPart}`;
};

// --- Products API ---

// Get all products
app.get('/api/products', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM products ORDER BY name').all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Get single product
app.get('/api/products/:id', async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!product) return c.json({ error: 'Product not found' }, 404);
  return c.json(product);
});

// Create product
app.post('/api/products', async (c) => {
  try {
    const body = await c.req.json();
    const id = generateId('P');

    // Check SKU
    const existing = await c.env.DB.prepare('SELECT id FROM products WHERE sku = ?').bind(body.sku).first();
    if (existing) return c.json({ error: 'SKU already exists' }, 400);

    await c.env.DB.prepare(
      `INSERT INTO products (id, name, sku, price, stock, min_stock, unit, category, image) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, body.name, body.sku, body.price, body.stock || 0, body.min_stock || 10,
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
    return c.json({ error: e.message }, 500);
  }
});

// Update product
app.put('/api/products/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();

    // If updating stock directly via this endpoint
    const newStock = body.stock;
    const currentProduct = await c.env.DB.prepare('SELECT stock, name FROM products WHERE id = ?').bind(id).first();

    await c.env.DB.prepare(
      `UPDATE products SET name=?, sku=?, price=?, stock=?, min_stock=?, unit=?, category=?, image=?, updated_at=CURRENT_TIMESTAMP 
       WHERE id=?`
    ).bind(
      body.name, body.sku, body.price, body.stock, body.min_stock,
      body.unit, body.category, body.image, id
    ).run();

    // Log stock change if it changed significantly and not tracked via orders
    // This is a simple heuristic or we could require client to send reason
    // For now, simpler is better.

    return c.json({ success: true, message: 'Product updated' });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Delete product
app.delete('/api/products/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    return c.json({ success: true, message: 'Product deleted' });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Orders API ---

// Get orders
app.get('/api/orders', async (c) => {
  try {
    // Get last 100 orders
    const { results } = await c.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Create Order
app.post('/api/orders', async (c) => {
  try {
    const body = await c.req.json();
    const orderId = body.id || generateId('ORD');
    const items = body.items || [];

    // 1. Create Order
    // Include items as JSON string for easy retrieval
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO orders (id, subtotal, tax, total, payment_method, status, notes, items, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId, body.subtotal, body.tax, body.total,
        body.payment_method || 'cash', body.status || 'completed', body.notes || '',
        JSON.stringify(items),
        new Date().toISOString()
      )
    ];

    // 2. Process Items & Update Stock
    for (const item of items) {
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
           VALUES (?, ?, ?, ?, (SELECT stock FROM products WHERE id = ?), ?)`
        ).bind('Sale', item.productId, item.name || 'Unknown', -item.quantity, item.productId, orderId)
      );
    }

    await c.env.DB.batch(statements);

    return c.json({ success: true, orderId, message: 'Order processed', total: body.total }, 201);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Settings API ---
app.get('/api/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM settings').all();
  const settings: any = {};
  results.forEach((row: any) => settings[row.key] = row.value);
  return c.json(settings);
});

app.post('/api/settings', async (c) => {
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
    return c.json({ error: e.message }, 500);
  }
});

// --- Dashboard Stats ---
app.get('/api/stats', async (c) => {
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

    // Top Products (by quantity) - Requires parsing JSON if not joining tables, 
    // but better to use order_items table for aggregation!
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
    return c.json({ error: e.message }, 500);
  }
});

// Fallback for all other GET requests (Static Assets)
app.get('*', async (c) => {
  try {
    // Fallback to serving assets
    // Need to mock the fetch event structure slightly for getAssetFromKV
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
