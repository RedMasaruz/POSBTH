-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS inventory_log; -- Logical dependency (optional)
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS users;

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
  created_by TEXT, -- Audit: User ID or Username
  created_by_name TEXT, -- Audit: User Name at time of sale
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sync_status TEXT DEFAULT 'synced'
);

DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'staff', 'dealer_vip', 'dealer')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_at_time DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

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

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed Initial Settings
INSERT INTO settings (key, value) VALUES 
('store_name', 'ร้านค้าตัวอย่าง'),
('tax_rate', '0'),
('currency', 'THB'),
('low_stock_threshold', '10'),
('receipt_header', 'ใบเสร็จรับเงิน\nร้านค้าตัวอย่าง'),
('receipt_footer', 'ขอบคุณที่ใช้บริการ');

-- Seed Users
INSERT INTO users (username, password, name, role) VALUES 
('admin', 'admin1234', 'เจ้าของร้าน', 'owner'),
('staff', 'staff1234', 'พนักงานขาย', 'staff'),
('vip', 'vip1234', 'ตัวแทนรายใหญ่', 'dealer_vip'),
('dealer', 'dealer1234', 'ตัวแทนรายย่อย', 'dealer');

-- Seed Initial Products (Example)
INSERT INTO products (id, name, sku, price, stock, min_stock, unit, category, image) VALUES
('V001', 'แร่ภูเขาไฟ 500 กรัม', 'VOLCANICMINERAL001', 90, 100, 10, 'ซอง', 'แร่ธาตุ', ''),
('V002', 'แร่ภูเขาไฟ 1 กิโลกรัม', 'VOLCANICMINERAL002', 140, 100, 10, 'ขวด', 'แร่ธาตุ', ''),
('V003', 'แร่ภูเขาไฟ 5 กิโลกรัม', 'VOLCANICMINERAL003', 370, 100, 10, 'ถุง', 'แร่ธาตุ', ''),
('V004', 'แร่ภูเขาไฟ 25 กิโลกรัม', 'VOLCANICMINERAL004', 980, 100, 10, 'กระสอบ', 'แร่ธาตุ', ''),
('V005', 'หัวเชื้อธาตุอาหาร 16 ชนิด หลัก รอง เสริม 1 ลิตร', 'VOLCANICWATER001', 220, 100, 10, 'ขวด', 'แร่ธาตุ', ''),
('V006', 'หัวเชื้อธาตุอาหาร 16 ชนิด หลัก รอง เสริม 1 แพ็ค', 'VOLCANICWATER002', 1050, 100, 10, 'ขวด', 'แร่ธาตุ', ''),
('V007', 'หัวเชื้อธาตุอาหาร 16 ชนิด หลัก รอง เสริม 1 ลัง', 'VOLCANICWATER003', 2050, 100, 10, 'ขวด', 'แร่ธาตุ', ''),
('P001', 'ฮิวมิค 1 ลิตร', 'HUMIC001', 0, 0, 10, 'ขวด', 'บำรุงดิน', ''),
('P002', 'จุลินทรีย์ 1 ลิตร', 'MICROBE001', 0, 0, 10, 'ขวด', 'บำรุงดิน', ''),
('P003', 'ผงถ่าน 1 ลิตร', 'CHARCOAL001', 0, 0, 10, 'ขวด', 'บำรุงดิน', ''),
('P004', 'นาโน 1 ลิตร', 'NANO001', 0, 0, 10, 'ขวด', 'บำรุงใบ', '');
