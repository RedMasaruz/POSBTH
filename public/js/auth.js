const API_AUTH = '/api/auth/login';

// ==========================================
// 🔒 Secure Session Management (JWT)
// ==========================================

// Get JWT Token
function getToken() {
    return localStorage.getItem('pos_token');
}

// Check if user is logged in
function checkSession(shouldRedirect = true) {
    const user = getUser();
    if (!user) {
        if (shouldRedirect && !window.location.pathname.includes('login.html')) {
            window.location.href = '/login.html';
        }
        return false;
    }
    return true;
}

// Get current user data
function getUser() {
    const userStr = localStorage.getItem('pos_user');
    if (!userStr) return null;
    try {
        return JSON.parse(userStr);
    } catch (e) {
        return null;
    }
}

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username || !password) {
        Swal.fire({ icon: 'warning', title: 'กรุณากรอกข้อมูลให้ครบ' });
        return;
    }

    try {
        const response = await fetch(API_AUTH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.status === 429) {
            Swal.fire({
                icon: 'error',
                title: 'ถูกล็อกชั่วคราว',
                text: 'คุณพยายามเข้าสู่ระบบมากเกินไป กรุณารอ 60 วินาที',
                timer: 5000
            });
            return;
        }

        if (response.ok && data.success) {
            // Store JWT Token + User Session
            localStorage.setItem('pos_token', data.token);
            localStorage.setItem('pos_user', JSON.stringify(data.user));

            Swal.fire({
                icon: 'success',
                title: 'เข้าสู่ระบบสำเร็จ',
                text: `ยินดีต้อนรับ ${data.user.name}`,
                timer: 1500,
                showConfirmButton: false
            }).then(() => {
                window.location.href = '/';
            });
        } else {
            Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: data.message || 'รหัสผ่านผิด' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: e.message });
    }
}

const logoutAdmin = logout;

function logout() {
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_token');
    window.location.href = '/login.html';
}

// Role checking helper
function hasPermission(action) {
    const user = getUser();
    if (!user) return false;
    if (user.role === 'owner') return true;

    if (action === 'delete_order') return false;
    if (action === 'edit_stock') return false;
    if (action === 'view_dashboard') return user.role === 'owner';

    return true;
}
