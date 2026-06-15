// ============================================================
// auth.js — Authentication, Session & Role Management
// Supports Google OAuth 2.0 and simple email+password login
// ============================================================

import { CONFIG, ROLES, PERMISSIONS, SHEETS } from './config.js';
import { sheetsRead, setAccessToken, parseSheetRows, updateFullRow, findRowById } from './supabase-api.js';

// ─── Session ─────────────────────────────────────────────────
let _currentUser = null;
let _sessionTimer = null;

export function getCurrentUser() { return _currentUser; }
export function isLoggedIn() { return _currentUser !== null; }

export function hasPermission(permKey) {
  if (!_currentUser) return false;
  // Super Admin has unrestricted access to everything
  if (_currentUser.role === 'Super Admin') return true;
  const perm = PERMISSIONS[permKey];
  if (!perm) return false;
  return perm[_currentUser.role] === true;
}

/** True only when the logged-in user is Super Admin */
export function isSuperAdmin() {
  return _currentUser?.role === 'Super Admin';
}

// ─── Simple Login (email + password hash lookup) ──────────────
/** SHA-256 hash (Web Crypto, browser-native) */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── App Users ────────────────────────────────────────────────
const DEMO_USERS = [
  { user_id: 'USR-001', full_name: 'Ajay Thomas', email: 'mail@thestrategist.co.in', password: 'AjayThomas@1', role: 'Super Admin', is_active: 'TRUE' },
];

export async function loginWithPassword(email, password) {
  // ── Demo mode bypass ─────────────────────────────────────────
  // Fast-path for hardcoded admin; falls through to Supabase if password
  // was changed via "Change Password" (which updates dim_users).
  const demoUser = DEMO_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (demoUser && demoUser.password === password) {
    _currentUser = { user_id: demoUser.user_id, full_name: demoUser.full_name, email: demoUser.email, role: demoUser.role };
    persistSession(); startSessionTimer(); return _currentUser;
  }

  // Read dim_users from Supabase
  const values = await sheetsRead(`${SHEETS.USERS}!A:G`);
  const users = parseSheetRows(SHEETS.USERS, values);
  const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (!user) throw new Error('User not found.');
  if (user.is_active === 'FALSE' || user.is_active === false) throw new Error('Account is inactive.');

  const inputHash = await sha256(password);
  // If no password set yet (first login), accept any
  if (user.password_hash && user.password_hash !== inputHash) {
    throw new Error('Incorrect password.');
  }

  _currentUser = {
    user_id: user.user_id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
  };
  persistSession();
  startSessionTimer();
  return _currentUser;
}

// ─── Change Password (self-service) ──────────────────────────
export async function changePassword(currentPassword, newPassword) {
  if (!_currentUser) throw new Error('Not logged in.');
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters.');

  // Verify current password
  const values = await sheetsRead(`${SHEETS.USERS}!A:G`);
  const users  = parseSheetRows(SHEETS.USERS, values);
  const user   = users.find(u => u.email?.toLowerCase() === _currentUser.email.toLowerCase());

  if (user) {
    // If a hash exists, verify it
    if (user.password_hash) {
      const currentHash = await sha256(currentPassword);
      if (currentHash !== user.password_hash) throw new Error('Current password is incorrect.');
    }
    const newHash = await sha256(newPassword);
    const rowId   = await findRowById(SHEETS.USERS, user.user_id);
    await updateFullRow(SHEETS.USERS, rowId, { ...user, password_hash: newHash });
  } else {
    // DEMO_USERS admin — verify against hardcoded password
    const demoUser = DEMO_USERS.find(u => u.email.toLowerCase() === _currentUser.email.toLowerCase());
    if (!demoUser || demoUser.password !== currentPassword) {
      throw new Error('Current password is incorrect.');
    }
    // Store new hashed password in dim_users so next login picks it up
    const newHash = await sha256(newPassword);
    // Try to find/update in Supabase; if not found, this is a no-op for the demo user
    const rowId = await findRowById(SHEETS.USERS, demoUser.user_id);
    if (rowId) {
      await updateFullRow(SHEETS.USERS, rowId, { password_hash: newHash, updated_at: new Date().toISOString() });
    }
  }
}

// ─── Reset Password (admin resets for any user) ───────────────
export async function resetUserPassword(userId, newPassword) {
  if (!_currentUser || (_currentUser.role !== 'Admin' && _currentUser.role !== 'Super Admin'))
    throw new Error('Admin only.');
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters.');
  const newHash = await sha256(newPassword);
  const rowId   = await findRowById(SHEETS.USERS, userId);
  if (!rowId) throw new Error('User not found in database.');
  await updateFullRow(SHEETS.USERS, rowId, { password_hash: newHash, updated_at: new Date().toISOString() });
}

// ─── Google OAuth Login ───────────────────────────────────────
export async function loginWithGoogle(googleUser, users) {
  const email = googleUser.email || googleUser.getBasicProfile?.()?.getEmail?.();
  const name   = googleUser.name  || googleUser.getBasicProfile?.()?.getName?.();

  const user = users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
  if (!user) throw new Error(`No account found for ${email}. Contact Admin.`);
  if (user.is_active === 'FALSE') throw new Error('Account is inactive.');

  if (googleUser.access_token) setAccessToken(googleUser.access_token);

  _currentUser = {
    user_id: user.user_id,
    full_name: user.full_name || name,
    email: user.email,
    role: user.role,
  };
  persistSession();
  startSessionTimer();
  return _currentUser;
}

// ─── Session Persistence ──────────────────────────────────────
function persistSession() {
  sessionStorage.setItem('fm_user', JSON.stringify(_currentUser));
  sessionStorage.setItem('fm_session_ts', Date.now().toString());
}

export function restoreSession() {
  const raw = sessionStorage.getItem('fm_user');
  const ts  = parseInt(sessionStorage.getItem('fm_session_ts') || '0');
  if (!raw) return null;
  if (Date.now() - ts > CONFIG.SESSION_TIMEOUT_MS) {
    logout(); return null;
  }
  _currentUser = JSON.parse(raw);
  startSessionTimer();
  return _currentUser;
}

export function logout() {
  _currentUser = null;
  sessionStorage.removeItem('fm_user');
  sessionStorage.removeItem('fm_session_ts');
  if (_sessionTimer) clearTimeout(_sessionTimer);
  // Revoke Google token if any
  if (window.google?.accounts?.oauth2) {
    const token = sessionStorage.getItem('fm_gtoken');
    if (token) window.google.accounts.oauth2.revoke(token);
  }
  window.dispatchEvent(new Event('fm:logout'));
}

function startSessionTimer() {
  if (_sessionTimer) clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => {
    showToastLogout();
    logout();
  }, CONFIG.SESSION_TIMEOUT_MS);

  // Renew on activity
  ['click','keydown','touchstart'].forEach(ev =>
    document.addEventListener(ev, _resetTimer, { passive: true })
  );
}

function _resetTimer() {
  if (!_currentUser) return;
  sessionStorage.setItem('fm_session_ts', Date.now().toString());
  if (_sessionTimer) clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => { showToastLogout(); logout(); }, CONFIG.SESSION_TIMEOUT_MS);
}

function showToastLogout() {
  window.dispatchEvent(new CustomEvent('fm:toast', {
    detail: { type: 'warning', message: 'Session expired. Please log in again.' }
  }));
}

// ─── Google Identity Services Helpers ────────────────────────
export function initGoogleAuth(clientId, callback) {
  if (!window.google?.accounts?.oauth2) {
    console.warn('Google Identity Services not loaded.');
    return;
  }
  window._gsiClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: CONFIG.SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse.error) { callback(null, tokenResponse.error); return; }
      setAccessToken(tokenResponse.access_token);
      sessionStorage.setItem('fm_gtoken', tokenResponse.access_token);
      callback(tokenResponse, null);
    },
  });
}

export function requestGoogleToken() {
  if (window._gsiClient) window._gsiClient.requestAccessToken();
}
