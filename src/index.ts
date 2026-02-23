import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

// --- Types ---
type Bindings = {
  DB: D1Database;
  __STATIC_CONTENT: KVNamespace;
  ADMIN_PASSWORD?: string; // Environment variable
};

type OrderItem = {
  productId: string;
  quantity: number;
  name?: string; // Optional coming from client, but we should fetch from DB
  price?: number; // Optional, we will ignore/verify against DB
};

type OrderBody = {
  id?: string;
  items: OrderItem[];
  payment_method?: string;
  status?: string;
  notes?: string;
  subtotal?: number; // For reference/validation only
  tax?: number;      // For reference/validation only
  total?: number;    // For reference/validation only
  userId?: number;   // ID of the user creating the order
  userName?: string; // Name of the user creating the order
  customer_name?: string;
  customer_address?: string;
  customer_phone?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const assetManifest = JSON.parse(manifestJSON);

// --- Middleware ---
app.use('/api/*', cors());

// --- Utilities ---
const generateId = (prefix: string) => {
  const datePart = new Date().toISOString().replace(/[-:T.]/g, '').slice(2, 14); // YYMMDDHHMMSS
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}${datePart}${randomPart}`;
};

// Helper: Standardized Error Response
const errorResponse = (c: any, message: string, status: number = 400) => {
  return c.json({ success: false, message: message, error: message }, status);
};

// --- Auth API ---
// --- Auth API ---
app.post('/api/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password) return errorResponse(c, 'Missing credentials', 400);

    // Check against DB
    const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();

    if (!user || user.password !== password) {
      return errorResponse(c, 'Invalid Credentials', 401);
    }

    // Return User Info (exclude password)
    return c.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });

  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- User Management API ---
app.get('/api/users', async (c) => {
  try {
    const { results } = await c.env.DB.prepare("SELECT id, username, name, role, created_at FROM users ORDER BY id").all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

app.post('/api/users', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.username || !body.password || !body.name || !body.role) {
      return errorResponse(c, 'Missing required fields');
    }
    await c.env.DB.prepare(
      "INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)"
    ).bind(body.username, body.password, body.name, body.role).run();
    return c.json({ success: true, message: 'User created' }, 201);
  } catch (e: any) {
    return errorResponse(c, e.message, 500); // Check for UNIQUE constraint violation
  }
});

app.put('/api/users/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const updates = [];
    const params = [];

    if (body.password) { updates.push("password = ?"); params.push(body.password); }
    if (body.name) { updates.push("name = ?"); params.push(body.name); }
    if (body.role) { updates.push("role = ?"); params.push(body.role); }

    if (updates.length > 0) {
      params.push(id);
      await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    }
    return c.json({ success: true, message: 'User updated' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

app.delete('/api/users/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return c.json({ success: true, message: 'User deleted' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Analytics API ---
app.get('/api/analytics', async (c) => {
  try {
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    let dateFilter = "";
    const params: any[] = [];

    if (startDate && endDate) {
      // Use SQLite date() function for robust YYYY-MM-DD comparison
      dateFilter = `WHERE date(created_at) >= ? AND date(created_at) <= ?`;
      params.push(startDate, endDate);
    }

    const queryParams = params.length > 0 ? params : undefined;
    const bindQuery = (q: string) => {
      const stmt = c.env.DB.prepare(q);
      return params.length > 0 ? stmt.bind(...params) : stmt;
    };

    // 1. KPIs
    const kpiQuery = `
            SELECT 
                COUNT(id) as totalOrders,
                SUM(total) as totalSales,
                AVG(total) as avgOrderValue
            FROM orders ${dateFilter}
        `;
    const kpiResult: any = await bindQuery(kpiQuery).first();

    // 2. Sales Trend (Daily)
    const trendQuery = `
            SELECT 
                STRFTIME('%Y-%m-%d', created_at) as date,
                SUM(total) as total
            FROM orders ${dateFilter}
            GROUP BY date
            ORDER BY date
        `;
    const { results: salesTrend } = await bindQuery(trendQuery).all();

    // 3. Detailed Stats (Top Products, Staff, etc.) via JS Aggregation
    // 3. Optimized Stats via separate SQL queries (Faster than JS loop)

    // Payment Stats
    const paymentQuery = `
        SELECT payment_method as name, COUNT(*) as count 
        FROM orders ${dateFilter} 
        GROUP BY payment_method
    `;
    const { results: paymentMethods } = await bindQuery(paymentQuery).all();

    // Order Status
    const statusQuery = `
        SELECT status, COUNT(*) as count 
        FROM orders ${dateFilter} 
        GROUP BY status
    `;
    const { results: orderStatus } = await bindQuery(statusQuery).all();

    // Top Staff (By Sales Amount)
    const staffQuery = `
        SELECT created_by_name as name, SUM(total) as total 
        FROM orders ${dateFilter} 
        GROUP BY created_by_name 
        ORDER BY total DESC 
        LIMIT 5
    `;
    const { results: topStaff } = await bindQuery(staffQuery).all();

    // Safer Filter for joins
    const joinFilter = startDate && endDate ? `WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?` : '';

    // Top Products (using order_items + products tables)
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

    // Category Sales (using order_items + products)
    const categoryQuery = `
        SELECT p.category as name, SUM(oi.quantity * oi.price_at_time) as total
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        ${joinFilter}
        GROUP BY p.category
    `;
    const { results: categorySales } = await bindQuery(categoryQuery).all();

    // Total Products Sold
    const totalProductsQuery = `
        SELECT SUM(oi.quantity) as total
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        ${joinFilter}
    `;
    const totalProductsResult: any = await bindQuery(totalProductsQuery).first();
    const totalProductsSold = totalProductsResult?.total || 0;

    // Gross Profit (Still needs JSON parsing as 'cost' is only in JSON snapshot)
    // Optimization: Fetch ONLY the items column to reduce bandwidth
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
      debug: {
        startDate, endDate,
        dateFilter,
        params,
        kpiSQL: kpiQuery,
        kpiResultRaw: kpiResult
      },
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
app.post('/api/products', async (c) => {
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
app.put('/api/products/:id', async (c) => {
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
app.delete('/api/products/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    return c.json({ success: true, message: 'Product deleted' });
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// --- Orders API ---

// Get orders
app.get('/api/orders', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
    return c.json(results);
  } catch (e: any) {
    return errorResponse(c, e.message, 500);
  }
});

// Create Order (CRITICAL SECURITY FIX)
app.post('/api/orders', async (c) => {
  try {
    const body: OrderBody = await c.req.json();
    const items = body.items || [];

    if (items.length === 0) {
      return errorResponse(c, 'No items in order');
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
        `INSERT INTO orders (id, subtotal, tax, total, payment_method, status, notes, items, created_by, created_by_name, created_at, customer_name, customer_address, customer_phone) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId, serverSubtotal, discount, serverTotal,
        body.payment_method || 'cash', body.status || 'completed', body.notes || '',
        JSON.stringify(validatedItems),
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



// Delete Order (With Stock Restoration)
app.delete('/api/orders/:id', async (c) => {
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
    return errorResponse(c, e.message, 500);
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
