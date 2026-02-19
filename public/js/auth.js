const API_AUTH = '/api/auth/login';

// Check if user is logged in
function checkSession(shouldRedirect = true) {
    const user = getUser();
    if (!user) {
        // If not on login page, redirect only if requested
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

        if (response.ok && data.success) {
            // Store User Session
            localStorage.setItem('pos_user', JSON.stringify(data.user));

            Swal.fire({
                icon: 'success',
                title: 'เข้าสู่ระบบสำเร็จ',
                text: `ยินดีต้อนรับ ${data.user.name}`,
                timer: 1500,
                showConfirmButton: false
            }).then(() => {
                window.location.href = '/'; // Go to POS
            });
        } else {
            Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: data.message || 'รหัสผ่านผิด' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: e.message });
    }
}

const logoutAdmin = logout; // Alias for compatibility with admin.html

function logout() {
    localStorage.removeItem('pos_user');
    window.location.href = '/login.html';
}

// For backward compatibility / role checking helper
function hasPermission(action) {
    const user = getUser();
    if (!user) return false;

    // Owner can do everything
    if (user.role === 'owner') return true;

    // Permissions Matrix
    if (action === 'delete_order') return false; // Staff/Dealer cannot delete
    if (action === 'edit_stock') return false;   // Staff/Dealer cannot edit stock
    if (action === 'view_dashboard') return user.role === 'owner';

    return true; // Default allow selling
}
