// POS System Variables
let products = [];
let orders = [];
let cart = [];
let currentSort = 'default'; // Sorting state
let currentTier = 'retail'; // 'retail', 'dealer', 'vip'
let isGuest = false;
let updateInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Set last updated time
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = new Date().toLocaleTimeString('th-TH');
    }

    // Check Session (RBAC) - Allow Guest
    if (typeof checkSession === 'function') {
        checkSession(false);
    }

    // Display User Info
    const user = getUser();
    const pricingContainer = document.getElementById('pricing-tier-container');

    if (user) {
        // Name & Role
        const nameEl = document.getElementById('user-name-display');
        const roleEl = document.getElementById('user-role-display');
        if (nameEl) nameEl.textContent = user.name;
        if (roleEl) roleEl.textContent = `สถานะ: ${user.role} (ID: ${user.id || '-'})`;

        // Role-Based Pricing Logic
        if (user.role === 'dealer') {
            setPricingTier('dealer');
        } else if (user.role === 'dealer_vip') {
            setPricingTier('vip');
        } else {
            // Owner / Staff
            setPricingTier('retail');
        }

        // Show/Filter Dropdown
        if (pricingContainer) {
            pricingContainer.style.display = 'block';
            filterPricingOptions(user.role);
        }

        // Show Admin Link for Owner
        if (user.role === 'owner') {
            const adminBtn = document.getElementById('admin-link-btn');
            if (adminBtn) adminBtn.style.display = 'inline-block';
        }
    } else {
        // Guest Mode
        isGuest = true;
        const loginBtn = document.getElementById('login-btn');
        const profileMenu = document.getElementById('user-profile-menu');

        // Hide sensitive info for Guest
        const salesContainer = document.getElementById('daily-sales-container');
        const recentOrders = document.getElementById('recent-orders-section');

        if (salesContainer) {
            salesContainer.style.setProperty('display', 'none', 'important');
            salesContainer.classList.remove('d-lg-flex');
        }
        if (recentOrders) recentOrders.style.display = 'none';

        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (profileMenu) profileMenu.style.display = 'none';

        setPricingTier('retail');
    }

    // Apply saved theme
    const savedTheme = localStorage.getItem('selectedTheme') || 'dark';
    applyTheme(savedTheme);

    // Initialize view mode
    setupViewModeToggle();

    // Check if system is initialized
    checkSystemStatus();

    // Setup event listeners
    setupEventListeners();

    // Initialize live updates
    startLiveUpdates();
});

function checkSystemStatus() {
    apiRequest('/products').then(data => {
        const initPrompt = document.getElementById('init-prompt');
        const posSystem = document.getElementById('pos-system');

        if (initPrompt) initPrompt.style.display = 'none';
        if (posSystem) posSystem.style.display = 'block';

        if (data) {
            products = data || [];
            fetchAllData();
        }
    }).catch(err => {
        console.error('System Check Error:', err);
        const initPrompt = document.getElementById('init-prompt');
        const posSystem = document.getElementById('pos-system');

        if (initPrompt) initPrompt.style.display = 'none';
        if (posSystem) posSystem.style.display = 'block';

        Swal.fire({
            icon: 'warning',
            title: 'เชื่อมต่อระบบไม่ได้',
            text: 'ไม่สามารถดึงข้อมูลได้ อาจเป็นเพราะเพิ่งติดตั้งใหม่หรือปัญหาเครือข่าย',
            footer: '<a href="#" onclick="location.reload()">ลองรีเฟรชหน้าจอ</a>'
        });
    });
}

function fetchAllData() {
    fetchProducts();
    fetchOrders();
    fetchSettings();
}

function fetchProducts() {
    apiRequest('/products').then(data => {
        if (data) {
            products = data;
            updateQuickStats();
            renderProductGrid();
            renderQuickSelect();
            renderCategoryFilters();
        }
    });
}

function fetchOrders() {
    apiRequest('/orders').then(data => {
        if (data) {
            orders = data;
            updateQuickStats();
            renderRecentOrdersTable();
        }
    });
}

function fetchSettings() {
    apiRequest('/settings').then(data => {
        if (data) {
            settings = data;
            // POS doesn't need to update settings UI (inputs), 
            // but might use settings for receipts/currency
        }
    });
}

function updateQuickStats() {
    const totalProductsEl = document.getElementById('total-products');
    const todaySalesEl = document.getElementById('today-sales');
    const totalOrdersEl = document.getElementById('total-orders');
    const lowStockCountEl = document.getElementById('low-stock-count');

    if (!totalProductsEl) return; // Exit if elements don't exist (e.g. simplified view)

    const totalProducts = products.length;
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = orders.filter(order => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate === today;
    });
    const todaySales = todayOrders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0);
    const totalOrders = orders.length;
    const lowStockThreshold = parseInt(settings.low_stock_threshold || 10);
    const lowStockProducts = products.filter(p => parseInt(p.stock) <= lowStockThreshold && parseInt(p.stock) > 0).length;

    totalProductsEl.textContent = totalProducts;
    todaySalesEl.textContent = formatCurrency(todaySales);
    totalOrdersEl.textContent = totalOrders;
    lowStockCountEl.textContent = lowStockProducts;

    // Sync Header Stats as well
    const liveSalesEl = document.getElementById('live-sales-today');
    if (liveSalesEl) {
        liveSalesEl.textContent = formatCurrency(todaySales);
    }
}

function updateLiveStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = orders.filter(order => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate === today;
    });
    const todaySales = todayOrders.reduce((sum, order) => sum + parseFloat(order.total || 0), 0);

    const liveSalesEl = document.getElementById('live-sales-today');
    if (liveSalesEl) {
        liveSalesEl.textContent = formatCurrency(todaySales);
    }
}

function startLiveUpdates() {
    updateLiveStats();
    updateInterval = setInterval(() => {
        updateLiveStats();
        const lastUpdatedEl = document.getElementById('last-updated');
        if (lastUpdatedEl) {
            lastUpdatedEl.textContent = new Date().toLocaleTimeString('th-TH');
        }
    }, 60000);
}

// Product Functions



function filterPricingOptions(role) {
    const retailOption = document.querySelector('a[data-tier="retail"]');
    const dealerOption = document.querySelector('a[data-tier="dealer"]');
    const vipOption = document.querySelector('a[data-tier="vip"]');

    if (role === 'dealer') {
        // Dealer sees: Retail & Dealer. Hides VIP.
        if (retailOption) retailOption.parentElement.style.display = 'block';
        if (dealerOption) dealerOption.parentElement.style.display = 'block';
        if (vipOption) vipOption.parentElement.style.display = 'none';
    } else if (role === 'dealer_vip') {
        // VIP sees: Retail & VIP. Hides Dealer.
        if (retailOption) retailOption.parentElement.style.display = 'block';
        if (dealerOption) dealerOption.parentElement.style.display = 'none';
        if (vipOption) vipOption.parentElement.style.display = 'block';
    } else if (role === 'owner' || role === 'admin' || role === 'staff') {
        // Owner sees ALL
        if (retailOption) retailOption.parentElement.style.display = 'block';
        if (dealerOption) dealerOption.parentElement.style.display = 'block';
        if (vipOption) vipOption.parentElement.style.display = 'block';
    } else {
        // Others (Guest?): Retail only? Or allow all?
        // Let's safe default to All if we don't know, or restrict?
        // Let's show All and let setPricingTier fall back if authorized? 
        // Actually safe default is to show logic for Owner.
        if (retailOption) retailOption.parentElement.style.display = 'block';
        if (dealerOption) dealerOption.parentElement.style.display = 'block';
        if (vipOption) vipOption.parentElement.style.display = 'block';
    }
}

function getPrice(product) {
    if (!product) return 0;

    let price = parseFloat(product.price); // Default Retail

    if (currentTier === 'dealer') {
        const dealerPrice = parseFloat(product.price_dealer);
        if (!isNaN(dealerPrice) && dealerPrice > 0) {
            price = dealerPrice;
        }
    } else if (currentTier === 'vip') {
        const vipPrice = parseFloat(product.price_vip);
        if (!isNaN(vipPrice) && vipPrice > 0) {
            price = vipPrice;
        }
    }

    return price;
}

function setPricingTier(tier) {
    // Validate
    if (!['retail', 'dealer', 'vip'].includes(tier)) return;
    currentTier = tier;

    // Update UI
    const displayEl = document.getElementById('current-tier-display');
    if (displayEl) {
        let label = 'ราคา: หน้าร้าน';
        if (tier === 'dealer') label = 'ราคา: ตัวแทนย่อย';
        if (tier === 'vip') label = 'ราคา: ตัวแทนใหญ่';
        displayEl.textContent = label;

        // Update button style?
        const btn = document.getElementById('pricingDropdown');
        if (btn) {
            btn.className = `btn dropdown-toggle d-flex align-items-center ${tier === 'retail' ? 'btn-outline-success' : 'btn-success'}`;
        }
    }

    // Refresh Views
    renderProductGrid();
    updateCart(); // Recalculate totals
}


function showProductQuickView(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const stock = parseInt(product.stock);
    const stockStatus = stock <= 0 ? 'หมดสต็อก' : stock <= 5 ? 'เหลือน้อย' : 'พร้อมขาย';
    const stockColor = stock <= 0 ? 'danger' : stock <= 5 ? 'warning' : 'success';

    let imageUrl = product.image;
    if (!imageUrl || imageUrl.trim() === '') {
        const bgColor = 'e2e8f0';
        const textColor = '64748b';
        const text = encodeURIComponent(product.name.substring(0, 2).toUpperCase());
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150" fill="none">
            <rect width="150" height="150" fill="#${bgColor}"/>
            <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="50" fill="#${textColor}" text-anchor="middle" dy=".3em">${text}</text>
        </svg>`;
        imageUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
    }

    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150" fill="none"><rect width="150" height="150" fill="#f1f5f9"/><path d="M75 50v50m-25-25h50" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/></svg>`;
    const fallbackUrl = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`;

    Swal.fire({
        title: product.name,
        html: `
            <div class="text-center mb-3">
                <img src="${imageUrl}"
                     alt="${product.name}"
                     onerror="this.src='${fallbackUrl}'"
                     style="width: 150px; height: 150px; object-fit: cover; border-radius: 12px; margin-bottom: 1rem;">
            </div>
            <div class="text-start">
                <p><strong>รหัส:</strong> ${product.sku || product.id}</p>
                <p><strong>ราคา:</strong> ${formatCurrency(getPrice(product))}</p>
                <p><strong>คงเหลือ:</strong> <span class="text-${stockColor}">${product.stock} ${product.unit}</span> (${stockStatus})</p>
                <p><strong>หมวดหมู่:</strong> ${product.category || 'ทั่วไป'}</p>
            </div>
        `,
        showCancelButton: stock > 0,
        confirmButtonText: stock > 0 ? 'เพิ่มลงตะกร้า' : 'ปิด',
        cancelButtonText: 'ปิด', // No Edit button for POS
        showDenyButton: false
    }).then((result) => {
        if (result.isConfirmed && stock > 0) {
            addToCart(product);
        }
    });
}

function renderProductGrid() {
    const container = document.getElementById('product-grid-view');
    if (!container) return;

    container.innerHTML = '';

    if (products.length === 0) {
        container.innerHTML = '<div class="text-center py-5" style="grid-column: 1 / -1;"><i class="bi bi-box-seam" style="font-size: 3rem; color: var(--text-secondary);"></i><p class="mt-3">ไม่มีรายการสินค้า</p></div>';
        return;
    }

    const activeCategory = document.querySelector('#category-filters .active')?.dataset.category || 'all';
    const filteredProducts = activeCategory === 'all'
        ? products
        : products.filter(p => p.category === activeCategory);

    const showImages = document.getElementById('viewModeToggle')?.checked ?? true;

    // Apply Sorting
    filteredProducts.sort((a, b) => {
        const priceA = getPrice(a);
        const priceB = getPrice(b);

        if (currentSort === 'price-asc') {
            return priceA - priceB;
        } else if (currentSort === 'price-desc') {
            return priceB - priceA;
        } else {
            // Default: Sort by Name or ID
            return a.name.localeCompare(b.name, 'th');
        }
    });

    filteredProducts.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card hover-lift';
        card.onclick = () => addToCart(product);

        const stock = parseInt(product.stock);
        let stockClass = 'normal';
        let stockText = 'พร้อมขาย';

        if (stock <= 0) {
            stockClass = 'out';
            stockText = 'หมดสต็อก';
        } else if (stock <= 5) {
            stockClass = 'low';
            stockText = 'เหลือน้อย';
        }

        let imageUrl = product.image;
        if (!imageUrl || imageUrl.trim() === '') {
            // Use a clean Box Icon SVG
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" fill="none">
                <rect width="120" height="120" fill="#f8fafc"/>
                <path d="M60 40 L60 80 M40 60 L80 60" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" display="none"/> <!-- Optional Plus -->
                <path d="M40 45 L60 35 L80 45 L80 75 L60 85 L40 75 Z M40 45 L60 55 L80 45 M60 55 L60 85" stroke="#94a3b8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>`;
            imageUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
        }

        let imageHtml = '';
        if (showImages) {
            const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" fill="none"><rect width="120" height="120" fill="#f1f5f9"/><path d="M60 40v40m-20-20h40" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round"/></svg>`;
            const fallbackUrl = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`;

            imageHtml = `
            <div class="product-image">
                <img src="${imageUrl}" alt="${product.name}" loading="lazy" onerror="this.src='${fallbackUrl}'">
            </div>`;
        }

        card.innerHTML = `
            <div class="product-category">${product.category || 'ทั่วไป'}</div>
            ${imageHtml}
            <div class="product-price">${formatCurrency(getPrice(product))}</div>
            <div class="product-name">${product.name}</div>
            <div class="product-code">${product.sku || product.id}</div>
            <div class="product-stock ${stockClass}">
                ${stockText} (${product.stock} ${product.unit})
            </div>
            <div class="product-actions">
                <button onclick="event.stopPropagation(); showProductQuickView('${product.id}')">
                    <i class="bi bi-eye"></i>
                </button>
            </div>
        `;

        if (stock <= 0) {
            card.style.opacity = '0.6';
            card.style.cursor = 'not-allowed';
            card.onclick = (e) => {
                e.stopPropagation();
                Swal.fire({
                    icon: 'error',
                    title: 'สินค้าหมด',
                    text: 'สินค้าชิ้นนี้หมดสต็อกแล้ว',
                    showConfirmButton: false,
                    timer: 2000
                });
            };
        }

        container.appendChild(card);
    });
}

function renderQuickSelect() {
    const select = document.getElementById('quick-select-product');
    if (!select) return;

    select.innerHTML = '<option selected disabled>เลือกสินค้า...</option>';

    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.name} (${formatCurrency(product.price)})`;
        option.disabled = parseInt(product.stock) <= 0;
        select.appendChild(option);
    });

    select.onchange = function () {
        const selectedProduct = products.find(p => p.id === this.value);
        if (selectedProduct) addToCart(selectedProduct);
    };
}

function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    if (!container) return;

    container.innerHTML = '';

    const categoryCounts = {};
    products.forEach(product => {
        const category = product.category || 'ทั่วไป';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    const allBtn = document.createElement('button');
    allBtn.className = 'btn btn-sm btn-primary active';
    allBtn.dataset.category = 'all';
    allBtn.innerHTML = `<i class="bi bi-grid me-1"></i>ทั้งหมด (${products.length})`;
    allBtn.onclick = () => filterProducts('all');
    container.appendChild(allBtn);

    Object.entries(categoryCounts).forEach(([category, count]) => {
        const button = document.createElement('button');
        button.className = 'btn btn-sm btn-outline-primary';
        button.dataset.category = category;

        let icon = 'bi-tag';
        if (category.includes('อาหาร') || category.includes('เครื่องดื่ม')) icon = 'bi-cup';
        if (category.includes('สุขภาพ')) icon = 'bi-heart';
        if (category.includes('เครื่องเขียน')) icon = 'bi-pencil';
        if (category.includes('อิเล็กทรอนิกส์')) icon = 'bi-laptop';

        button.innerHTML = `<i class="bi ${icon} me-1"></i>${category} (${count})`;
        button.onclick = () => filterProducts(category);
        container.appendChild(button);
    });
}

function filterProducts(category) {
    document.querySelectorAll('#category-filters .btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.category === category) {
            btn.classList.add('active');
        }
    });

    renderProductGrid();
}

function setSortMode(mode) {
    currentSort = mode;

    // Update button text or state if needed (optional)
    const btn = document.getElementById('sortDropdown');
    if (btn) {
        let text = 'เรียงราคา';
        if (mode === 'price-asc') text = 'ราคา: ต่ำ -> สูง';
        if (mode === 'price-desc') text = 'ราคา: สูง -> ต่ำ';
        if (mode === 'default') text = 'เรียงตามชื่อ';
        btn.innerHTML = `<i class="bi bi-sort-numeric-down"></i> ${text}`;
    }

    renderProductGrid();
}

// Cart Functions
function addToCart(product) {
    if (parseInt(product.stock) <= 0) {
        Swal.fire({
            icon: 'error',
            title: 'สินค้าหมด',
            text: 'สินค้าชิ้นนี้หมดสต็อกแล้ว',
            showConfirmButton: false,
            timer: 2000
        });
        return;
    }

    const existingItemIndex = cart.findIndex(item => item.product.id === product.id);

    if (existingItemIndex >= 0) {
        if (cart[existingItemIndex].quantity >= parseInt(product.stock)) {
            Swal.fire({
                icon: 'warning',
                title: 'จำนวนไม่เพียงพอ',
                text: `จำนวนคงเหลือไม่เพียงพอ (เหลือ: ${product.stock} ${product.unit})`,
                showConfirmButton: false,
                timer: 2000
            });
            return;
        }
        cart[existingItemIndex].quantity += 1;
    } else {
        cart.push({
            product: product,
            quantity: 1
        });
    }

    updateCart();

    // Feedback
    const feedback = document.createElement('div');
    feedback.innerHTML = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999;
            pointer-events: none;
        ">
            <div style="
                background: var(--accent-success);
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 12px;
                font-weight: 600;
                box-shadow: var(--shadow-lg);
                animation: fadeInOut 2s ease-in-out;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            ">
                <i class="bi bi-check-circle-fill"></i>
                เพิ่ม ${product.name} ลงตะกร้าแล้ว
            </div>
        </div>
    `;

    document.body.appendChild(feedback);

    if (!document.getElementById('feedback-animation')) {
        const style = document.createElement('style');
        style.id = 'feedback-animation';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translate(-50%, -40%); }
                15% { opacity: 1; transform: translate(-50%, -50%); }
                85% { opacity: 1; transform: translate(-50%, -50%); }
                100% { opacity: 0; transform: translate(-50%, -60%); }
            }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        if (feedback.parentNode) feedback.remove();
    }, 2000);
}

function updateCart() {
    const container = document.getElementById('cart-items');
    const subtotalElement = document.getElementById('cart-subtotal');
    const taxElement = document.getElementById('cart-tax');
    const totalElement = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('checkout-btn');

    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5">
                <i class="bi bi-cart-x fs-1 text-secondary"></i>
                <p class="mt-3">ยังไม่มีสินค้าในตะกร้า</p>
            </div>
        `;
        subtotalElement.textContent = '฿0.00';
        taxElement.textContent = '฿0.00';
        totalElement.textContent = '฿0.00';
        checkoutBtn.disabled = true;
        return;
    }

    const subtotal = cart.reduce((sum, item) => sum + (getPrice(item.product) * item.quantity), 0);
    const discountRate = parseFloat(settings.discount_rate || 0);
    const discount = subtotal * (discountRate / 100);
    const total = subtotal - discount;

    subtotalElement.parentElement.style.display = discount > 0 ? 'flex' : 'none';
    taxElement.parentElement.style.display = discount > 0 ? 'flex' : 'none';

    // Update labels if needed
    subtotalElement.textContent = formatCurrency(subtotal);
    taxElement.textContent = formatCurrency(discount);
    totalElement.textContent = formatCurrency(total);
    checkoutBtn.disabled = false;

    // Guest Checkout Logic
    if (isGuest) {
        checkoutBtn.innerHTML = '<i class="bi bi-truck me-2"></i>สั่งซื้อทันที (Guest Checkout)';
        checkoutBtn.classList.remove('btn-success');
        checkoutBtn.classList.add('btn-primary');
        checkoutBtn.onclick = showGuestCheckoutModal;
    } else {
        checkoutBtn.innerHTML = '<i class="bi bi-check-circle me-2"></i>ชำระเงิน';
        checkoutBtn.classList.add('btn-success');
        checkoutBtn.classList.remove('btn-primary');
        checkoutBtn.onclick = () => checkout(); // Pass nothing
    }

    container.innerHTML = '';
    cart.forEach((item, index) => {
        const itemElement = document.createElement('div');
        itemElement.className = 'cart-item';
        itemElement.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.product.name}</div>
                <div class="cart-item-price">${formatCurrency(getPrice(item.product))}/${item.product.unit}</div>
            </div>
            <div class="cart-item-qty">
                <button class="qty-btn" onclick="adjustCartQty(${index}, -1)">-</button>
                <input type="text" class="qty-input" value="${item.quantity}" readonly>
                <button class="qty-btn" onclick="adjustCartQty(${index}, 1)">+</button>
                <button class="btn btn-sm btn-outline-danger ms-2" onclick="removeFromCart(${index})">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        container.appendChild(itemElement);
    });
}

function adjustCartQty(index, change) {
    const item = cart[index];
    const newQty = item.quantity + change;

    if (newQty < 1) {
        removeFromCart(index);
        return;
    }

    if (newQty > parseInt(item.product.stock)) {
        Swal.fire({
            icon: 'warning',
            title: 'จำนวนไม่เพียงพอ',
            text: `จำนวนคงเหลือไม่เพียงพอ (เหลือ: ${item.product.stock} ${item.product.unit})`
        });
        return;
    }

    cart[index].quantity = newQty;
    updateCart();
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCart();
}

function clearCart() {
    if (cart.length === 0) return;

    Swal.fire({
        title: 'ล้างตะกร้าสินค้า',
        text: "คุณต้องการล้างตะกร้าสินค้าทั้งหมดใช่หรือไม่?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'ใช่, ล้างเลย',
        cancelButtonText: 'ยกเลิก'
    }).then((result) => {
        if (result.isConfirmed) {
            cart = [];
            updateCart();
            Swal.fire({
                icon: 'success',
                title: 'ล้างแล้ว',
                text: 'ล้างตะกร้าสินค้าเรียบร้อยแล้ว',
                showConfirmButton: false,
                timer: 1500
            });
        }
    });
}

async function checkout(guestData = null) {
    if (cart.length === 0) {
        Swal.fire({
            icon: 'error',
            title: 'ตะกร้าว่าง',
            text: 'กรุณาเพิ่มสินค้าก่อนชำระเงิน'
        });
        return;
    }

    const orderData = {
        channel: 'หน้าร้าน',
        items: cart.map(item => ({
            productId: item.product.id,
            name: item.product.name,
            price: getPrice(item.product), // USE CORRECT PRICE
            quantity: item.quantity
        })),
        payment_method: document.getElementById('payment-method').value,
        notes: document.getElementById('order-notes').value || '',
        status: 'completed',
        subtotal: cart.reduce((sum, item) => sum + (getPrice(item.product) * item.quantity), 0),
        tax: 0,
        total: 0,
        userId: getUser()?.id,
        userName: getUser()?.name,
        // Guest Fields
        customer_name: guestData ? guestData.name : null,
        customer_address: guestData ? guestData.address : null,
        customer_phone: guestData ? guestData.phone : null
    };

    const discountRate = parseFloat(settings.discount_rate || 0); // Corrected property name from tax_rate
    orderData.tax = orderData.subtotal * (discountRate / 100);
    orderData.total = orderData.subtotal - orderData.tax;

    Swal.fire({
        title: 'กำลังบันทึกคำสั่งซื้อ...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const response = await apiRequest('/orders', 'POST', orderData);

    if (response && response.success) {
        const receiptHtml = `
            <div class="text-start">
                <p><strong>เลขที่คำสั่งซื้อ:</strong> ${response.orderId}</p>
                <p><strong>ยอดรวมสุทธิ:</strong> ${formatCurrency(response.total || orderData.total)}</p>
                <p><strong>วันที่:</strong> ${new Date().toLocaleString('th-TH')}</p>
                ${guestData ? `<p><strong>ลูกค้า:</strong> ${guestData.name} (${guestData.phone})</p>` : ''}
                <hr>
                <p><strong>รายการสินค้า:</strong></p>
                <ul>
                    ${cart.map(item => `<li>${item.product.name} × ${item.quantity}</li>`).join('')}
                </ul>
            </div>
        `;

        Swal.fire({
            icon: 'success',
            title: 'สั่งซื้อสำเร็จ!',
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

            cart = [];
            updateCart();
            document.getElementById('order-notes').value = '';
            fetchAllData();
        });
    } else {
        Swal.fire({
            icon: 'error',
            title: 'ผิดพลาด',
            text: response ? response.message : 'Unknown Error'
        });
    }
}

async function showGuestCheckoutModal() {
    const { value: formValues } = await Swal.fire({
        title: 'ข้อมูลจัดส่ง (Guest Mode)',
        html: `
            <div class="text-start">
                <label class="form-label">ชื่อ-นามสกุล <span class="text-danger">*</span></label>
                <input id="guest-name" class="form-control mb-2" placeholder="กรอกชื่อ-นามสกุล">
                
                <label class="form-label">เบอร์โทรศัพท์ <span class="text-danger">*</span></label>
                <input id="guest-phone" class="form-control mb-2" placeholder="กรอกเบอร์โทรศัพท์">
                
                <label class="form-label">ที่อยู่จัดส่ง <span class="text-danger">*</span></label>
                <textarea id="guest-address" class="form-control" rows="3" placeholder="บ้านเลขที่, ถนน, แขวง/ตำบล, เขต/อำเภอ, จังหวัด, รหัสไปรษณีย์"></textarea>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'ยืนยันการสั่งซื้อ',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const name = document.getElementById('guest-name').value;
            const phone = document.getElementById('guest-phone').value;
            const address = document.getElementById('guest-address').value;
            if (!name || !phone || !address) {
                Swal.showValidationMessage('กรุณากรอกข้อมูลให้ครบถ้วน');
            }
            return { name, phone, address };
        }
    });

    if (formValues) {
        checkout(formValues);
    }
}

function renderRecentOrdersTable() {
    const container = document.getElementById('recent-orders-table');
    if (!container) return;

    const recentOrders = orders.slice(0, 5);

    container.innerHTML = '';

    if (recentOrders.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-5">
                    <i class="bi bi-receipt fs-1 text-secondary mb-3 d-block"></i>
                    ยังไม่มีรายการคำสั่งซื้อ
                </td>
            </tr>
        `;
        return;
    }

    recentOrders.forEach(order => {
        let items = [];
        try {
            items = JSON.parse(order.items);
        } catch (e) { items = []; }

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${order.id}</td>
            <td>${new Date(order.created_at).toLocaleDateString('th-TH')}</td>
            <td>${items.slice(0, 2).map(item => item.name).join(', ')}${items.length > 2 ? '...' : ''}</td>
            <td>${items.reduce((sum, item) => sum + item.quantity, 0)}</td>
            <td>${formatCurrency(order.total)}</td>
            <td><span class="status-badge ${order.status === 'completed' ? 'status-success' : 'status-warning'}">${order.status}</span></td>
            <td>
                <div class="d-flex gap-1 justify-content-center">
                    <button class="btn btn-sm btn-outline-primary" onclick="printReceipt('${order.id}')" title="พิมพ์ใบเสร็จ">
                        <i class="bi bi-printer"></i>
                    </button>
                </div>
            </td>
        `;
        container.appendChild(row);
    });
}

function refreshProducts() {
    fetchProducts();
    Swal.fire({
        icon: 'success',
        title: 'อัปเดตแล้ว',
        showConfirmButton: false,
        timer: 1500
    });
}

// Receipt Logic
function printReceipt(orderId) {
    let order = orders.find(o => o.id === orderId);
    if (!order) return;

    const receiptWindow = window.open('', '_blank');

    let items = order.items;
    if (typeof items === 'string') {
        try {
            items = JSON.parse(items);
        } catch (e) { items = []; }
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
                <p style="display: ${order.tax > 0 ? 'block' : 'none'}">รวม: ${formatter.format(order.subtotal || 0)}</p>
                <p style="display: ${order.tax > 0 ? 'block' : 'none'}">ส่วนลด: ${formatter.format(order.tax || 0)}</p>
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
}

function setupEventListeners() {
    // Global input validation
    document.body.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
            if (e.target.min && parseFloat(e.target.value) < parseFloat(e.target.min)) {
                e.target.value = e.target.min;
            }
        }
    });
}

function setupViewModeToggle() {
    const toggle = document.getElementById('viewModeToggle');
    if (toggle) {
        toggle.checked = true;
        toggle.addEventListener('change', renderProductGrid);
    }
}
