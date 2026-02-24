const API_BASE = '/api'; // Cloudflare Worker Endpoint
let settings = {}; // Global settings object

// Helper: Apply Theme
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('selectedTheme', theme);
}

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
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

// Global API Request Helper (with JWT Auth)
async function apiRequest(endpoint, method = 'GET', body = null) {
    try {
        const headers = {
            'Content-Type': 'application/json'
        };

        // Attach JWT Token if available
        const token = localStorage.getItem('pos_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const options = { method, headers };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, options);

        // Handle Unauthorized (expired token)
        if (response.status === 401) {
            // Only auto-logout if we had a token (not guest browsing)
            if (token) {
                localStorage.removeItem('pos_token');
                localStorage.removeItem('pos_user');
                // Don't redirect if on the login page
                if (!window.location.pathname.includes('login.html')) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'เซสชันหมดอายุ',
                        text: 'กรุณาเข้าสู่ระบบใหม่',
                        timer: 2000,
                        showConfirmButton: false
                    }).then(() => {
                        window.location.href = '/login.html';
                    });
                }
            }
            return null;
        }

        if (!response.ok) {
            const error = await response.text();
            let errorMessage = error || response.statusText;
            try {
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

// Image Compression Utility
async function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate dimensions
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Export as Data URL (Base64)
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}
