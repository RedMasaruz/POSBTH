const API_BASE = '/api'; // Cloudflare Worker Endpoint
let settings = {}; // Global settings object

// Helper: Apply Theme
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('selectedTheme', theme);
}

// Force Reset App Logic
function forceResetApp() {
    Swal.fire({
        title: 'ยืนยันการรีเซ็ตแอป?',
        text: 'การรีเซ็ตจะลบข้อมูลแคชและรีสตาร์ทแอปพลิเคชันใหม่ทั้งหมดเพื่อรับเวอร์ชันล่าสุด',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'ใช่, รีเซ็ตทันที',
        cancelButtonText: 'ยกเลิก'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                title: 'กำลังรีเซ็ต...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            // 1. Clear Caches
            if ('caches' in window) {
                caches.keys().then(names => {
                    for (let name of names) caches.delete(name);
                });
            }

            // 2. Unregister Service Workers
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    for (let registration of registrations) registration.unregister();
                });
            }

            // 3. Clear Storage
            localStorage.clear();
            sessionStorage.clear();

            // 4. Reload
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        }
    });
}

// Global Event Listeners (Theme)
document.addEventListener('DOMContentLoaded', () => {
    // Theme Switcher Logic
    const themeParams = document.querySelectorAll('[data-theme]');
    themeParams.forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const theme = el.getAttribute('data-theme');
            applyTheme(theme);
        });
    });
});

// Global API Request Helper
async function apiRequest(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (!response.ok) {
            const error = await response.text();
            let errorMessage = error || response.statusText;
            try {
                // Try to parse JSON error
                const json = JSON.parse(error);
                errorMessage = json.message || json.error || errorMessage;
            } catch (e) {
                // Ignore parse error, use text
            }
            throw new Error(errorMessage);
        }
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        // Silent fail for background updates?
        // But for interactive, we should show alert.
        // We will show alert if method is NOT GET (likely user action)
        if (method !== 'GET') {
            Swal.fire({
                icon: 'error',
                title: 'เกิดข้อผิดพลาด',
                text: error.message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้'
            });
        }
        return null;
    }
}

// Format Currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: (settings && settings.currency) ? settings.currency : 'THB',
        minimumFractionDigits: 2
    }).format(amount || 0);
}
