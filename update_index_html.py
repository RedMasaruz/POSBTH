
import re

file_path = 'public/index.html'

with open(file_path, 'r') as f:
    content = f.read()

replacements = {
    'checkout': r'''async function checkout() {
            if (cart.length === 0) {
                Swal.fire({
                    icon: 'error',
                    title: 'ตะกร้าว่าง',
                    text: 'กรุณาเพิ่มสินค้าก่อนชำระเงิน'
                });
                return;
            }
            
            // Prepare order data
            const orderData = {
                channel: 'หน้าร้าน',
                items: cart.map(item => ({
                    productId: item.product.id,
                    name: item.product.name,
                    price: parseFloat(item.product.price),
                    quantity: item.quantity
                })),
                payment_method: document.getElementById('payment-method').value,
                notes: document.getElementById('order-notes').value || '',
                status: 'completed',
                
                 // Calculate totals locally
                subtotal: cart.reduce((sum, item) => sum + (parseFloat(item.product.price) * item.quantity), 0),
                tax: 0, 
                total: 0
            };
            
             const taxRate = parseFloat(settings.tax_rate || 7);
            orderData.tax = orderData.subtotal * (taxRate / 100);
            orderData.total = orderData.subtotal + orderData.tax;
            
            Swal.fire({
                title: 'กำลังบันทึกคำสั่งซื้อ...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            const response = await apiRequest('/orders', 'POST', orderData);

            if (response && response.success) {
                    // Show success message
                    const receiptHtml = `
                        <div class="text-start">
                            <p><strong>เลขที่คำสั่งซื้อ:</strong> ${response.orderId}</p>
                            <p><strong>ยอดรวมสุทธิ:</strong> ${formatCurrency(response.total || orderData.total)}</p>
                            <p><strong>วันที่:</strong> ${new Date().toLocaleString('th-TH')}</p>
                            <hr>
                            <p><strong>รายการสินค้า:</strong></p>
                            <ul>
                                ${cart.map(item => `<li>${item.product.name} × ${item.quantity}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'ชำระเงินสำเร็จ!',
                        html: receiptHtml,
                        showCancelButton: true,
                        confirmButtonText: 'พิมพ์ใบเสร็จ',
                        cancelButtonText: 'ปิด',
                        showDenyButton: true,
                        denyButtonText: 'ไม่พิมพ์'
                    }).then((result) => {
                        if (result.isConfirmed) {
                             printReceipt(response.orderId);
                        }
                        
                        // Reset cart
                        cart = [];
                        updateCart();
                        document.getElementById('order-notes').value = '';
                        
                        // Refresh data
                        fetchAllData();
                    });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'ผิดพลาด',
                    text: response ? response.message : 'Unknown Error'
                });
            }
        }''',

    'printReceipt': r'''function printReceipt(orderId) {
            // Find order details
            let order = orders.find(o => o.id === orderId);
            
            if (!order) {
                 return; 
            }
            
            // Create receipt window
            const receiptWindow = window.open('', '_blank');
            
            let items = order.items;
            if (typeof items === 'string') {
                try {
                    items = JSON.parse(items);
                } catch(e) { items = []; }
            }
             
            const formatter = new Intl.NumberFormat('th-TH', {
                style: 'currency',
                currency: 'THB',
                minimumFractionDigits: 2
            });

            const receipt = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>ใบเสร็จรับเงิน</title>
                    <style>
                        body { font-family: 'TH Sarabun New', sans-serif; font-size: 14pt; width: 80mm; margin: 0 auto; padding: 10px; }
                        .header, .footer { text-align: center; }
                        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                        td { padding: 3px 0; }
                        .total { border-top: 2px dashed #000; padding-top: 10px; }
                        .text-right { text-align: right; }
                        .text-center { text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h3>${settings.store_name || 'ร้านค้า'}</h3>
                        <p>${(settings.receipt_header || '').replace(/\\n/g, '<br>')}</p>
                        <hr>
                    </div>
                    
                    <div class="order-info">
                        <p><strong>ใบเสร็จรับเงิน</strong></p>
                        <p>เลขที่: ${orderId}</p>
                        <p>วันที่: ${new Date().toLocaleString('th-TH')}</p>
                        <hr>
                    </div>
                    
                    <table>
                        <tbody id="receipt-items">
                             ${items.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td class="text-right">${item.quantity} x ${formatter.format(item.price)}</td>
                                    <td class="text-right">${formatter.format(item.quantity * item.price)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total">
                        <p>รวม: ${formatter.format(order.subtotal || 0)}</p>
                        <p>ภาษี: ${formatter.format(order.tax || 0)}</p>
                        <p><strong>ยอดรวมสุทธิ: ${formatter.format(order.total || 0)}</strong></p>
                    </div>
                    
                    <hr>
                    
                    <div class="footer">
                        <p>${(settings.receipt_footer || '').replace(/\\n/g, '<br>')}</p>
                        <p>ขอบคุณที่ใช้บริการ</p>
                    </div>
                    
                    <script>
                        setTimeout(() => {
                            window.print();
                            window.close();
                        }, 500);
                    <\/script>
                </body>
                </html>
            `;
            
            receiptWindow.document.write(receipt);
            receiptWindow.document.close();
        }''',

    'saveProduct': r'''function saveProduct(data) {
            Swal.fire({
                title: 'กำลังบันทึกสินค้า...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            apiRequest('/products', 'POST', data).then(response => {
                if (response && (response.success || response.id)) {
                    Swal.fire({
                        icon: 'success',
                        title: 'สำเร็จ!',
                        text: 'เพิ่มสินค้าเรียบร้อยแล้ว',
                        showConfirmButton: false,
                        timer: 1500
                    });
                    fetchAllData();
                } else {
                     Swal.fire({
                        icon: 'error',
                        title: 'ผิดพลาด!',
                        text: response ? response.message : 'Unknown error'
                    });
                }
            });
        }''',

    'updateProduct': r'''function updateProduct(data) {
            Swal.fire({
                title: 'กำลังอัปเดตสินค้า...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            apiRequest('/products', 'PUT', data).then(response => {
                if (response && response.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'สำเร็จ!',
                        text: 'อัปเดตสินค้าเรียบร้อยแล้ว',
                        showConfirmButton: false,
                        timer: 1500
                    });
                    fetchAllData();
                } else {
                     Swal.fire({
                        icon: 'error',
                        title: 'ผิดพลาด!',
                        text: response ? response.message : 'Unknown error'
                    });
                }
            });
        }''',

    'deleteProduct': r'''function deleteProduct(productId) {
            Swal.fire({
                title: 'กำลังลบสินค้า...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            apiRequest('/products', 'DELETE', { id: productId }).then(response => {
                if (response && response.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'ลบแล้ว!',
                        text: 'ลบสินค้าเรียบร้อยแล้ว',
                        showConfirmButton: false,
                        timer: 1500
                    });
                    fetchAllData();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'ผิดพลาด!',
                        text: response ? response.message : 'Unknown error'
                    });
                }
            });
        }''',

    'restockProduct': r'''function restockProduct(productId) {
            const product = products.find(p => p.id === productId);
            if (!product) return;
            
            Swal.fire({
                title: 'เติมสต็อกสินค้า',
                html: `
                    <p>สินค้า: <strong>${product.name}</strong></p>
                    <p>สต็อกปัจจุบัน: ${product.stock} ${product.unit}</p>
                    <input id="restock-qty" type="number" class="swal2-input" placeholder="จำนวนที่ต้องการเติม" min="1" value="10">
                `,
                showCancelButton: true,
                confirmButtonText: 'เติมสต็อก',
                cancelButtonText: 'ยกเลิก',
                preConfirm: () => {
                    const qty = document.getElementById('restock-qty').value;
                    if (!qty || parseInt(qty) < 1) {
                        Swal.showValidationMessage('กรุณากรอกจำนวนให้ถูกต้อง');
                        return false;
                    }
                    return qty;
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    const quantity = parseInt(result.value);
                    const newStock = parseInt(product.stock) + quantity;
                    
                    Swal.fire({
                        title: 'กำลังเติมสต็อก...',
                        allowOutsideClick: false,
                        didOpen: () => Swal.showLoading()
                    });
                    
                    apiRequest('/products', 'PUT', {
                         id: productId,
                         stock: newStock
                    }).then(response => {
                        if (response && response.success) {
                             Swal.fire({
                                icon: 'success',
                                title: 'สำเร็จ!',
                                text: `เติมสต็อก ${product.name} จำนวน ${quantity} ${product.unit}`,
                                showConfirmButton: false,
                                timer: 1500
                            });
                            fetchAllData();
                        } else {
                            Swal.fire({
                                icon: 'error',
                                title: 'ผิดพลาด!',
                                text: response ? response.message : 'Unknown error'
                            });
                        }
                    });
                }
            });
        }''',

    'saveSettings': r'''function saveSettings() {
            const settingsData = {
                store_name: document.getElementById('store-name').value,
                tax_rate: document.getElementById('tax-rate').value,
                currency: document.getElementById('currency').value,
                low_stock_threshold: document.getElementById('low-stock-threshold').value,
                receipt_header: document.getElementById('receipt-header').value,
                receipt_footer: document.getElementById('receipt-footer').value
            };
            
            Swal.fire({
                title: 'กำลังบันทึกการตั้งค่า...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            apiRequest('/settings', 'POST', settingsData).then(response => {
                if (response && response.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'สำเร็จ!',
                        text: 'บันทึกการตั้งค่าเรียบร้อยแล้ว',
                        showConfirmButton: false,
                        timer: 1500
                    });
                    fetchSettings();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'ผิดพลาด!',
                        text: response ? response.message : 'Unknown error'
                    });
                }
            });
        }''',
        
    'adjustStock': r'''function adjustStock(data) {
            Swal.fire({
                title: 'กำลังปรับสต็อก...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            const product = products.find(p => p.id === data.productId);
            if (!product) return;
            
            let newStock = parseInt(product.stock);
            if (data.action === 'เพิ่ม') newStock += data.quantity;
            else if (data.action === 'ลด') newStock -= data.quantity;
            else newStock = data.quantity;
            
            apiRequest('/products', 'PUT', { 
                id: data.productId, 
                stock: newStock
            }).then(response => {
                if (response && response.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'สำเร็จ!',
                        text: 'ปรับสต็อกเรียบร้อยแล้ว',
                        showConfirmButton: false,
                        timer: 1500
                    });
                    fetchAllData();
                } else {
                     Swal.fire({
                        icon: 'error',
                        title: 'ผิดพลาด!',
                        text: response ? response.message : 'Unknown error'
                    });
                }
            });
        }'''
}

def replace_function(file_content, func_name, new_code):
    # Find start of function
    pattern = r'function\s+' + func_name + r'\s*\([^)]*\)\s*\{'
    match = re.search(pattern, file_content)
    if not match:
        print(f"Function {func_name} not found.")
        return file_content
    
    start_index = match.start()
    
    # Find matching closing brace
    brace_count = 0
    in_function = False
    end_index = -1
    
    for i in range(start_index, len(file_content)):
        char = file_content[i]
        if char == '{':
            brace_count += 1
            in_function = True
        elif char == '}':
            brace_count -= 1
        
        if in_function and brace_count == 0:
            end_index = i + 1
            break
            
    if end_index != -1:
        # Check if we are replacing correct range
        print(f"Replacing {func_name}...")
        return file_content[:start_index] + new_code + file_content[end_index:]
    else:
        print(f"Could not find end of function {func_name}")
        return file_content

new_content = content
for func_name, code in replacements.items():
    new_content = replace_function(new_content, func_name, code)

with open(file_path, 'w') as f:
    f.write(new_content)

print("Update complete.")
