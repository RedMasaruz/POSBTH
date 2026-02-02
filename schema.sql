DROP TABLE IF EXISTS products;
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 10,
  unit TEXT DEFAULT 'ชิ้น',
  category TEXT DEFAULT 'ทั่วไป',
  image TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  subtotal DECIMAL(10, 2) NOT NULL,
  tax DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  payment_method TEXT,
  status TEXT DEFAULT 'pending',
  channel TEXT DEFAULT 'POS',
  notes TEXT,
  items TEXT, -- JSON string of items for easy retrieval
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sync_status TEXT DEFAULT 'synced'
);

DROP TABLE IF EXISTS order_items;
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_at_time DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

DROP TABLE IF EXISTS inventory_log;
CREATE TABLE inventory_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  action TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  quantity_change INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  reference TEXT
);

DROP TABLE IF EXISTS settings;
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed Initial Settings
INSERT INTO settings (key, value) VALUES 
('store_name', 'ร้านค้าตัวอย่าง'),
('tax_rate', '7'),
('currency', 'THB'),
('low_stock_threshold', '10'),
('receipt_header', 'ใบเสร็จรับเงิน\nร้านค้าตัวอย่าง'),
('receipt_footer', 'ขอบคุณที่ใช้บริการ');

-- Seed Initial Products (Example)
INSERT INTO products (id, name, sku, price, stock, min_stock, unit, category, image) VALUES
('P001', 'น้ำดื่ม', 'DRINK001', 10, 100, 20, 'ขวด', 'เครื่องดื่ม', 'https://via.placeholder.com/80x80/0ea5e9/ffffff?text=น้ำ'),
('P002', 'ขนมปัง', 'FOOD001', 25, 50, 10, 'ถุง', 'อาหาร', 'https://via.placeholder.com/80x80/f59e0b/ffffff?text=ขนม');
