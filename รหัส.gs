function doGet(e) {
  const action = e.parameter.action;
  const page = e.parameter.page;

  // ถ้าเป็น action แรกให้สร้างชีต
  if (action === 'initializePOS') {
    const callback = e.parameter.callback;
    const jsonResponse = createPOSSheets();
    const jsonString = JSON.stringify(jsonResponse);
    const jsonp = callback + '(' + jsonString + ')';
    return ContentService.createTextOutput(jsonp).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  if (!action) {
    return HtmlService.createTemplateFromFile('index.html')
      .evaluate()
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .setTitle('ระบบ POS | Point of Sale System v2026')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const callback = e.parameter.callback;
  let jsonResponse;

  try {
    switch (action) {
      case 'getProducts':
        jsonResponse = getProducts();
        break;
      case 'getOrders':
        jsonResponse = getOrders();
        break;
      case 'createOrder':
        jsonResponse = createOrder(e.parameter);
        break;
      case 'updateStock':
        jsonResponse = updateStock(e.parameter);
        break;
      case 'getInventoryLog':
        jsonResponse = getInventoryLog();
        break;
      case 'getSettings':
        jsonResponse = getSettings();
        break;
      case 'updateSettings':
        jsonResponse = updateSettings(e.parameter);
        break;
      case 'getDashboardStats':
        jsonResponse = getDashboardStats();
        break;
      case 'getDailySales':
        jsonResponse = getDailySales();
        break;
      case 'getTopProducts':
        jsonResponse = getTopProducts();
        break;
      default:
        jsonResponse = { result: 'error', message: 'Invalid action' };
    }
  } catch (err) {
    Logger.log(err);
    jsonResponse = { result: 'error', message: err.message, stack: err.stack };
  }

  const jsonString = JSON.stringify(jsonResponse);
  const jsonp = callback + '(' + jsonString + ')';
  return ContentService.createTextOutput(jsonp).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

const SHEET_ID = "1nvpC81OISBQmNdQ2RV7i1w72H_Rkbv_9WNsaqxMTd6A";
const ss = SpreadsheetApp.openById(SHEET_ID);
// === CACHE SYSTEM ===
const CACHE_TTL = 21600; // 6 hours

function getCachedData(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached != null) {
    return JSON.parse(cached);
  }
  return null;
}

function setCachedData(key, data) {
  const cache = CacheService.getScriptCache();
  try {
    // Cache limit is 100KB per key. If data is too large, it will fail silently or throw.
    // In production, you might need to chunk data, but for <1000 products, this is fine.
    cache.put(key, JSON.stringify(data), CACHE_TTL);
  } catch (e) {
    console.warn("Cache put failed for " + key + ": " + e.toString());
  }
}

function clearCache(key) {
  const cache = CacheService.getScriptCache();
  cache.remove(key);
}

// === API FUNCTIONS ===
function getProducts() {
  // Try cache first
  const cached = getCachedData('products');
  if (cached) return cached;

  // If miss, fetch from sheet
  const sheet = ss.getSheetByName("products");
  const data = sheetToObjects(sheet);
  
  // Save to cache
  setCachedData('products', data);
  return data;
}

function getOrders() {
  // Orders change frequently, so we might cache for a shorter time or not at all 
  // if we want absolute realtime. However, for "Best Performance", we cache 
  // and clear cache on new order.
  const cached = getCachedData('orders');
  if (cached) return cached;

  const sheet = ss.getSheetByName("orders");
  const data = sheetToObjects(sheet);
  
  setCachedData('orders', data);
  return data;
}

function getSettings() {
  const cached = getCachedData('settings');
  if (cached) return cached;

  const sheet = ss.getSheetByName("settings");
  let data = {};
  if (sheet) {
    const rows = sheet.getDataRange().getValues();
    // Assuming settings are key-value in columns A and B
    // Or if sheetToObjects format, we stick to that.
    // Let's assume standard sheetToObjects for consistency if structure allows,
    // but usually settings are single row or Key-Value. 
    // Let's use sheetToObjects and take the first row or reduce.
    const rawData = sheetToObjects(sheet);
    if (rawData.length > 0) {
      data = rawData[0];
    }
  }
  
  setCachedData('settings', data);
  return data;
}

// The original global sheet variables are still here, but the cached functions above
// now fetch the sheet directly using ss.getSheetByName.
const productsSheet = ss.getSheetByName("products");
const ordersSheet = ss.getSheetByName("orders");
const inventorySheet = ss.getSheetByName("inventory_log");
const settingsSheet = ss.getSheetByName("settings");

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
    .getContent();
}

// Utility Functions
function sheetToObjects(sheet) {
  if (!sheet) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return data.map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });
}

function findRowByValue(sheet, searchValue, columnIndex = 1) {
  if (!sheet) return -1;
  const data = sheet.getRange(2, columnIndex, sheet.getLastRow(), 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] == searchValue) {
      return i + 2;
    }
  }
  return -1;
}

function logInventoryChange(action, productId, productName, quantityChange, reference) {
  if (!inventorySheet) return;
  
  const product = getProductById(productId);
  if (!product) return;
  
  const newStock = parseInt(product.stock) + parseInt(quantityChange);
  
  const logRow = [
    new Date(),
    action,
    productId,
    productName,
    quantityChange,
    newStock,
    reference
  ];
  
  inventorySheet.appendRow(logRow);
  
  // อัปเดตสต็อกใน products sheet
  const productRow = findRowByValue(productsSheet, productId, 1);
  if (productRow !== -1) {
    productsSheet.getRange(productRow, 5).setValue(newStock); // คอลัมน์ stock
  }
}

// Main POS Functions
function getProducts() {
  return sheetToObjects(productsSheet);
}

function getProductById(productId) {
  const products = getProducts();
  return products.find(product => product.id === productId);
}

function getOrders() {
  return sheetToObjects(ordersSheet);
}

function createOrder(data) {
  try {
    // สร้างรหัสคำสั่งซื้อ
    const orderId = 'ORD' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + Math.floor(Math.random() * 1000);
    
    // แปลง items จาก JSON string
    let items = [];
    let subtotal = 0;
    
    if (data.items) {
      items = JSON.parse(data.items);
      items.forEach(item => {
        const product = getProductById(item.productId);
        if (product) {
          subtotal += parseFloat(product.price) * parseInt(item.quantity);
        }
      });
    }
    
    // คำนวณภาษี
    const taxRate = parseFloat(getSetting('tax_rate')) || 7;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    
    // บันทึกคำสั่งซื้อ
    const orderRow = [
      orderId,
      data.channel || 'หน้าร้าน',
      data.items,
      subtotal,
      tax,
      total,
      data.payment_method || 'เงินสด',
      data.status || 'pending',
      data.notes || '',
      new Date(),
      'synced',
      new Date()
    ];
    
    ordersSheet.appendRow(orderRow);
    
    // ลดสต็อกสินค้า
    items.forEach(item => {
      const product = getProductById(item.productId);
      if (product) {
        logInventoryChange('ขาย', item.productId, product.name, -parseInt(item.quantity), orderId);
      }
    });

    // Clear Cache
    clearCache('orders');
    clearCache('products');
    clearCache('dashboardStats');
    
    return {
      result: 'success',
      orderId: orderId,
      subtotal: subtotal,
      tax: tax,
      total: total,
      timestamp: new Date().toISOString()
    };
    
  } catch (e) {
    return { result: 'error', message: e.toString() };
  }
}

function updateStock(data) {
  try {
    const product = getProductById(data.productId);
    if (!product) {
      return { result: 'error', message: 'ไม่พบสินค้า' };
    }
    
    const quantityChange = parseInt(data.quantity);
    if (isNaN(quantityChange)) {
      return { result: 'error', message: 'จำนวนไม่ถูกต้อง' };
    }
    
    const action = data.action || 'เพิ่ม';
    const reference = data.reference || 'manual';
    
    logInventoryChange(action, data.productId, product.name, quantityChange, reference);

    // Clear Cache
    clearCache('products');
    clearCache('inventoryLog');
    clearCache('dashboardStats');
    
    return {
      result: 'success',
      productId: data.productId,
      quantityChange: quantityChange,
      action: action,
      newStock: parseInt(product.stock) + quantityChange
    };
    
  } catch (e) {
    return { result: 'error', message: e.toString() };
  }
}

function getInventoryLog() {
  return sheetToObjects(inventorySheet);
}

function getSettings() {
  const settings = sheetToObjects(settingsSheet);
  const settingsObj = {};
  settings.forEach(setting => {
    settingsObj[setting.key] = setting.value;
  });
  return settingsObj;
}

function getSetting(key) {
  const settings = getSettings();
  return settings[key];
}

function updateSettings(data) {
  try {
    const settings = getSettings();
    
    Object.keys(data).forEach(key => {
      const row = findRowByValue(settingsSheet, key, 1);
      if (row !== -1) {
        settingsSheet.getRange(row, 2).setValue(data[key]);
        settingsSheet.getRange(row, 3).setValue(new Date());
      } else {
        // ถ้ายังไม่มี ให้เพิ่มใหม่
        settingsSheet.appendRow([key, data[key], new Date()]);
      }
    });
    
    // Clear Cache
    clearCache('settings');
    
    return {
      result: 'success',
      message: 'อัปเดตการตั้งค่าเรียบร้อยแล้ว'
    };
    
  } catch (e) {
    return { result: 'error', message: e.toString() };
  }
}

// Dashboard Functions
function getDashboardStats() {
  const products = getProducts();
  const orders = getOrders();
  const inventoryLogs = getInventoryLog();
  
  // สถิติสินค้า
  const totalProducts = products.length;
  const lowStockProducts = products.filter(p => parseInt(p.stock) <= parseInt(p.min_stock || 10)).length;
  const outOfStockProducts = products.filter(p => parseInt(p.stock) <= 0).length;
  
  // สถิติการขาย
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(order => {
    const orderDate = new Date(order.created_at).toISOString().split('T')[0];
    return orderDate === today;
  });
  
  const totalSales = orders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0);
  const todaySales = todayOrders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0);
  
  // สถิติคำสั่งซื้อ
  const totalOrders = orders.length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const completedOrders = orders.filter(o => o.status === 'completed').length;
  
  return {
    result: 'success',
    stats: {
      totalProducts: totalProducts,
      lowStockProducts: lowStockProducts,
      outOfStockProducts: outOfStockProducts,
      totalSales: totalSales,
      todaySales: todaySales,
      totalOrders: totalOrders,
      pendingOrders: pendingOrders,
      completedOrders: completedOrders,
      todayOrders: todayOrders.length
    }
  };
}

function getDailySales() {
  const orders = getOrders();
  const dailyData = {};
  
  orders.forEach(order => {
    const date = new Date(order.created_at).toISOString().split('T')[0];
    if (!dailyData[date]) {
      dailyData[date] = {
        date: date,
        orders: 0,
        sales: 0
      };
    }
    dailyData[date].orders++;
    dailyData[date].sales += parseFloat(order.total || 0);
  });
  
  const sortedData = Object.values(dailyData)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-30); // 30 วันที่ผ่านมา
  
  return {
    result: 'success',
    dailySales: sortedData
  };
}

function getTopProducts() {
  const orders = getOrders();
  const productSales = {};
  
  orders.forEach(order => {
    try {
      if (order.items) {
        const items = JSON.parse(order.items);
        items.forEach(item => {
          const product = getProductById(item.productId);
          if (product) {
            const key = `${product.id}|${product.name}`;
            if (!productSales[key]) {
              productSales[key] = {
                id: product.id,
                name: product.name,
                quantity: 0,
                revenue: 0
              };
            }
            productSales[key].quantity += parseInt(item.quantity || 0);
            productSales[key].revenue += parseFloat(product.price) * parseInt(item.quantity || 0);
          }
        });
      }
    } catch (e) {
      Logger.log('Error parsing order items: ' + e);
    }
  });
  
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);
  
  return {
    result: 'success',
    topProducts: topProducts
  };
}

// ฟังก์ชันจัดการสินค้า
function addProduct(data) {
  try {
    // ตรวจสอบว่า SKU ซ้ำหรือไม่
    const existingProduct = findRowByValue(productsSheet, data.sku, 3);
    if (existingProduct !== -1) {
      return { result: 'error', message: 'รหัส SKU ซ้ำ' };
    }
    
    // สร้างรหัสสินค้า
    const productId = 'P' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss');
    
    const productRow = [
      productId,
      data.name,
      data.sku,
      data.price,
      data.stock || 0,
      data.min_stock || 10,
      data.unit || 'ชิ้น',
      data.category || 'ทั่วไป',
      data.image || ''
    ];
    
    productsSheet.appendRow(productRow);
    
    // บันทึกใน inventory log
    if (parseInt(data.stock) > 0) {
      logInventoryChange('เพิ่มสต็อก', productId, data.name, parseInt(data.stock), 'manual_add');
    }

    // Clear Cache
    clearCache('products');
    clearCache('dashboardStats');
    
    return {
      result: 'success',
      productId: productId,
      message: 'เพิ่มสินค้าเรียบร้อยแล้ว'
    };
    
  } catch (e) {
    return { result: 'error', message: e.toString() };
  }
}

function updateProduct(data) {
  try {
    const row = findRowByValue(productsSheet, data.id, 1);
    if (row === -1) {
      return { result: 'error', message: 'ไม่พบสินค้า' };
    }
    
    // อัปเดตข้อมูลสินค้า
    productsSheet.getRange(row, 2).setValue(data.name);
    productsSheet.getRange(row, 3).setValue(data.sku);
    productsSheet.getRange(row, 4).setValue(data.price);
    productsSheet.getRange(row, 5).setValue(data.stock);
    productsSheet.getRange(row, 6).setValue(data.min_stock);
    productsSheet.getRange(row, 7).setValue(data.unit);
    productsSheet.getRange(row, 8).setValue(data.category);
    productsSheet.getRange(row, 9).setValue(data.image);
    
    // Clear Cache
    clearCache('products');
    clearCache('dashboardStats');

    return {
      result: 'success',
      message: 'อัปเดตสินค้าเรียบร้อยแล้ว'
    };
    
  } catch (e) {
    return { result: 'error', message: e.toString() };
  }
}

function deleteProduct(productId) {
  try {
    const row = findRowByValue(productsSheet, productId, 1);
    if (row === -1) {
      return { result: 'error', message: 'ไม่พบสินค้า' };
    }
    
    // เก็บข้อมูลก่อนลบ
    const productName = productsSheet.getRange(row, 2).getValue();
    
    productsSheet.deleteRow(row);

    // Clear Cache
    clearCache('products');
    clearCache('dashboardStats');

    return {
      result: 'success',
      message: `ลบสินค้า "${productName}" เรียบร้อยแล้ว`
    };
    
  } catch (e) {
    return { result: 'error', message: e.toString() };
  }
}

function createPOSSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // ลบชีตเก่าถ้ามี (ป้องกันการซ้ำ)
  const sheetNames = ['products', 'orders', 'inventory_log', 'settings'];
  sheetNames.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      ss.deleteSheet(sheet);
    }
  });
  
  // สร้างชีต PRODUCTS
  const productsSheet = ss.insertSheet('products');
  productsSheet.getRange('A1:I1').setValues([['id', 'name', 'sku', 'price', 'stock', 'min_stock', 'unit', 'category', 'image']]);
  productsSheet.getRange('A1:I1').setFontWeight('bold');
  productsSheet.setFrozenRows(1);
  
  // ตั้งค่าความกว้างคอลัมน์
  productsSheet.setColumnWidth(1, 80);  // id
  productsSheet.setColumnWidth(2, 200); // name
  productsSheet.setColumnWidth(3, 120); // sku
  productsSheet.setColumnWidth(4, 100); // price
  productsSheet.setColumnWidth(5, 100); // stock
  productsSheet.setColumnWidth(6, 100); // min_stock
  productsSheet.setColumnWidth(7, 80);  // unit
  productsSheet.setColumnWidth(8, 120); // category
  productsSheet.setColumnWidth(9, 150); // image
  
  // เพิ่มข้อมูลสินค้าเริ่มต้น
  const initialProducts = [
    ['P001', 'น้ำดื่ม', 'DRINK001', 10, 100, 20, 'ขวด', 'เครื่องดื่ม', 'https://via.placeholder.com/80x80/0ea5e9/ffffff?text=น้ำ'],
    ['P002', 'ขนมปัง', 'FOOD001', 25, 50, 10, 'ถุง', 'อาหาร', 'https://via.placeholder.com/80x80/f59e0b/ffffff?text=ขนม'],
    ['P003', 'ยาสีฟัน', 'CARE001', 45, 30, 5, 'หลอด', 'ดูแลสุขภาพ', 'https://via.placeholder.com/80x80/10b981/ffffff?text=ยา'],
    ['P004', 'กระดาษ A4', 'OFFICE001', 120, 200, 50, 'รีม', 'เครื่องเขียน', 'https://via.placeholder.com/80x80/8b5cf6/ffffff?text=กระดาษ'],
    ['P005', 'ปากกาลูกลื่น', 'OFFICE002', 15, 150, 30, 'ด้าม', 'เครื่องเขียน', 'https://via.placeholder.com/80x80/ec4899/ffffff?text=ปากกา']
  ];
  
  if (productsSheet.getLastRow() === 1) {
    productsSheet.getRange(2, 1, initialProducts.length, initialProducts[0].length).setValues(initialProducts);
  }
  
  // สร้างชีต ORDERS
  const ordersSheet = ss.insertSheet('orders');
  ordersSheet.getRange('A1:L1').setValues([['id', 'channel', 'items', 'subtotal', 'tax', 'total', 'payment_method', 'status', 'notes', 'created_at', 'sync_status', 'updated_at']]);
  ordersSheet.getRange('A1:L1').setFontWeight('bold');
  ordersSheet.setFrozenRows(1);
  
  // ตั้งค่าความกว้างคอลัมน์
  ordersSheet.setColumnWidth(1, 80);   // id
  ordersSheet.setColumnWidth(2, 100);  // channel
  ordersSheet.setColumnWidth(3, 300);  // items
  ordersSheet.setColumnWidth(4, 100);  // subtotal
  ordersSheet.setColumnWidth(5, 80);   // tax
  ordersSheet.setColumnWidth(6, 100);  // total
  ordersSheet.setColumnWidth(7, 120);  // payment_method
  ordersSheet.setColumnWidth(8, 100);  // status
  ordersSheet.setColumnWidth(9, 200);  // notes
  ordersSheet.setColumnWidth(10, 120); // created_at
  ordersSheet.setColumnWidth(11, 100); // sync_status
  ordersSheet.setColumnWidth(12, 120); // updated_at
  
  // สร้างชีต INVENTORY_LOG
  const inventorySheet = ss.insertSheet('inventory_log');
  inventorySheet.getRange('A1:G1').setValues([['timestamp', 'action', 'product_id', 'product_name', 'quantity_change', 'new_stock', 'reference']]);
  inventorySheet.getRange('A1:G1').setFontWeight('bold');
  inventorySheet.setFrozenRows(1);
  
  // ตั้งค่าความกว้างคอลัมน์
  inventorySheet.setColumnWidth(1, 150); // timestamp
  inventorySheet.setColumnWidth(2, 80);  // action
  inventorySheet.setColumnWidth(3, 80);  // product_id
  inventorySheet.setColumnWidth(4, 200); // product_name
  inventorySheet.setColumnWidth(5, 120); // quantity_change
  inventorySheet.setColumnWidth(6, 100); // new_stock
  inventorySheet.setColumnWidth(7, 120); // reference
  
  // สร้างชีต SETTINGS
  const settingsSheet = ss.insertSheet('settings');
  settingsSheet.getRange('A1:C1').setValues([['key', 'value', 'updated_at']]);
  settingsSheet.getRange('A1:C1').setFontWeight('bold');
  settingsSheet.setFrozenRows(1);
  
  // ตั้งค่าความกว้างคอลัมน์
  settingsSheet.setColumnWidth(1, 150); // key
  settingsSheet.setColumnWidth(2, 200); // value
  settingsSheet.setColumnWidth(3, 120); // updated_at
  
  // เพิ่มการตั้งค่าเริ่มต้น
  const initialSettings = [
    ['store_name', 'ร้านค้าตัวอย่าง', new Date()],
    ['tax_rate', '7', new Date()],
    ['currency', 'THB', new Date()],
    ['receipt_header', 'ใบเสร็จรับเงิน\nร้านค้าตัวอย่าง\nที่อยู่: 123 ถนนตัวอย่าง\nโทร: 02-123-4567', new Date()],
    ['receipt_footer', 'ขอบคุณที่ใช้บริการ\nรับคืนสินค้าภายใน 7 วัน\n*** ใบเสร็จนี้เป็นใบเสร็จรับเงิน ***', new Date()],
    ['low_stock_threshold', '10', new Date()],
    ['auto_backup', 'true', new Date()]
  ];
  
  if (settingsSheet.getLastRow() === 1) {
    settingsSheet.getRange(2, 1, initialSettings.length, initialSettings[0].length).setValues(initialSettings);
  }
  
  // ปรับลำดับชีต
  ss.setActiveSheet(productsSheet);
  ss.moveActiveSheet(1);
  ss.setActiveSheet(ordersSheet);
  ss.moveActiveSheet(2);
  ss.setActiveSheet(inventorySheet);
  ss.moveActiveSheet(3);
  ss.setActiveSheet(settingsSheet);
  ss.moveActiveSheet(4);
  
  return {
    success: true,
    message: 'สร้างแผ่นงาน POS สำเร็จแล้ว',
    sheets: ['products', 'orders', 'inventory_log', 'settings']
  };
}

// ฟังก์ชันเริ่มต้นระบบ POS
function initializePOSSystem() {
  Swal.fire({
    title: 'กำลังเริ่มต้นระบบ POS...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });
  
  jsonpRequest(`${SCRIPT_URL}?action=initializePOS`, response => {
    if (response.success) {
      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ!',
        html: `
          <div class="text-start">
            <p>สร้างแผ่นงานระบบ POS สำเร็จแล้ว:</p>
            <ul class="mt-2">
              <li>✅ products - จัดการสินค้า</li>
              <li>✅ orders - คำสั่งซื้อ</li>
              <li>✅ inventory_log - ประวัติสต็อก</li>
              <li>✅ settings - การตั้งค่า</li>
            </ul>
          </div>
        `,
        confirmButtonText: 'ตกลง'
      });
      
      // โหลดข้อมูลใหม่
      fetchAllData();
    } else {
      Swal.fire({
        icon: 'error',
        title: 'ผิดพลาด',
        text: response.message
      });
    }
  });
}

// ฟังก์ชันสร้างคำสั่งซื้อใหม่
function createNewOrder(orderData) {
  Swal.fire({
    title: 'กำลังบันทึกคำสั่งซื้อ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });
  
  let url = `${SCRIPT_URL}?action=createOrder`;
  Object.keys(orderData).forEach(key => {
    if (orderData[key] !== undefined) {
      url += `&${encodeURIComponent(key)}=${encodeURIComponent(orderData[key])}`;
    }
  });
  
  jsonpRequest(url, response => {
    if (response.result === 'success') {
      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ!',
        html: `
          <div class="text-start">
            <p>สร้างคำสั่งซื้อสำเร็จ</p>
            <p><strong>หมายเลขคำสั่งซื้อ:</strong> ${response.orderId}</p>
            <p><strong>ยอดรวม:</strong> ${formatCurrency(response.total)}</p>
            <p><strong>วันที่:</strong> ${new Date().toLocaleString('th-TH')}</p>
          </div>
        `,
        showConfirmButton: false,
        timer: 3000
      });
      
      // รีเฟรชข้อมูล
      fetchAllData();
      
      // พิมพ์ใบเสร็จ (ถ้าต้องการ)
      if (window.confirm('ต้องการพิมพ์ใบเสร็จหรือไม่?')) {
        printReceipt(response.orderId);
      }
    } else {
      Swal.fire({
        icon: 'error',
        title: 'ผิดพลาด',
        text: response.message
      });
    }
  });
}

// ฟังก์ชันฟอร์แมตเงิน
function formatCurrency(amount) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2
  }).format(amount);
}

// ฟังก์ชันพิมพ์ใบเสร็จ
function printReceipt(orderId) {
  // สร้างหน้าสำหรับพิมพ์ใบเสร็จ
  const receiptWindow = window.open('', '_blank');
  
  // โหลดข้อมูลคำสั่งซื้อ
  jsonpRequest(`${SCRIPT_URL}?action=getOrderDetails&orderId=${orderId}`, response => {
    if (response.result === 'success') {
      const receipt = generateReceiptHTML(response.order);
      receiptWindow.document.write(receipt);
      receiptWindow.document.close();
      receiptWindow.print();
    }
  });
}

// ฟังก์ชันสร้าง HTML สำหรับใบเสร็จ
function generateReceiptHTML(order) {
  const settings = getSettings(); // ต้องดึงการตั้งค่ามาก่อน
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>ใบเสร็จรับเงิน</title>
      <style>
        body { font-family: 'TH Sarabun New', sans-serif; font-size: 14pt; }
        .receipt { width: 80mm; margin: 0 auto; padding: 10px; }
        .header, .footer { text-align: center; }
        .items { width: 100%; border-collapse: collapse; margin: 10px 0; }
        .items td { padding: 3px 0; }
        .total { border-top: 2px dashed #000; padding-top: 10px; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
      </style>
    </head>
    <body>
      <div class="receipt">
        <div class="header">
          <h3>${settings.store_name || 'ร้านค้า'}</h3>
          <p>${(settings.receipt_header || '').replace(/\n/g, '<br>')}</p>
          <hr>
        </div>
        
        <div class="order-info">
          <p><strong>ใบเสร็จรับเงิน</strong></p>
          <p>เลขที่: ${order.id}</p>
          <p>วันที่: ${new Date(order.created_at).toLocaleString('th-TH')}</p>
          <hr>
        </div>
        
        <table class="items">
          ${JSON.parse(order.items).map(item => `
            <tr>
              <td>${item.name}</td>
              <td class="text-right">${item.quantity} x ${item.price}</td>
              <td class="text-right">${item.quantity * item.price}</td>
            </tr>
          `).join('')}
        </table>
        
        <div class="total">
          <p>รวม: ${formatCurrency(order.subtotal)}</p>
          <p>ภาษี: ${formatCurrency(order.tax)}</p>
          <p><strong>ยอดรวมสุทธิ: ${formatCurrency(order.total)}</strong></p>
        </div>
        
        <hr>
        
        <div class="payment">
          <p>ชำระโดย: ${order.payment_method}</p>
        </div>
        
        <hr>
        
        <div class="footer">
          <p>${(settings.receipt_footer || '').replace(/\n/g, '<br>')}</p>
          <p>ขอบคุณที่ใช้บริการ</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

