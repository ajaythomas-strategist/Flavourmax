// ============================================================
// app.js — SPA Router & App Bootstrap
// ============================================================
import { restoreSession, loginWithPassword, isLoggedIn, getCurrentUser, logout, changePassword } from './auth.js';
import { initSidebar, setActiveRoute, NAV_ITEMS } from './components/sidebar.js';
import { initToasts, toast } from './components/toast.js';
import { loadDimCache } from './supabase-api.js';

// ─── Route Map ───────────────────────────────────────────────
const ROUTES = {
  'dashboard':                   () => import('./modules/dashboard.js').then(m => m.renderDashboard),
  'master/companies':            () => import('./modules/master/companies.js').then(m => m.renderCompanies),
  'master/categories':           () => import('./modules/master/categories.js').then(m => m.renderCategories),
  'master/products':             () => import('./modules/master/products.js').then(m => m.renderProducts),
  'master/ingredients':          () => import('./modules/master/ingredients.js').then(m => m.renderIngredients),
  'master/processes':            () => import('./modules/master/processes.js').then(m => m.renderProcesses),
  'master/recipes':              () => import('./modules/master/recipes.js').then(m => m.renderRecipes),
  'master/units':                () => import('./modules/master/units.js').then(m => m.renderUnits),
  'master/suppliers':            () => import('./modules/master/suppliers.js').then(m => m.renderSuppliers),
  'master/warehouses':           () => import('./modules/master/warehouses.js').then(m => m.renderWarehouses),
  'inventory/stock-in':          () => import('./modules/inventory/stock-in.js').then(m => m.renderStockIn),
  'inventory/stock-out':         () => import('./modules/inventory/stock-out.js').then(m => m.renderStockOut),
  'inventory/current-stock':     () => import('./modules/inventory/current-stock.js').then(m => m.renderCurrentStock),
  'production/new-batch':        () => import('./modules/production/new-batch.js').then(m => m.renderNewBatch),
  'production/batch-list':       () => import('./modules/production/batch-list.js').then(m => m.renderBatchList),
  'production/process-log':      () => import('./modules/production/process-log.js').then(m => m.renderProcessLog),
  'dispatch/new-dispatch':       () => import('./modules/dispatch/dispatch.js').then(m => m.renderNewDispatch),
  'dispatch/dispatch-list':      () => import('./modules/dispatch/dispatch.js').then(m => m.renderDispatchList),
  'sales/new-order':             () => import('./modules/sales/sales-orders.js').then(m => m.renderNewSalesOrder),
  'sales/order-list':            () => import('./modules/sales/sales-orders.js').then(m => m.renderSalesOrderList),
  'sales/new-sale':              () => import('./modules/sales/sales.js').then(m => m.renderNewSale),
  'sales/sales-list':            () => import('./modules/sales/sales.js').then(m => m.renderSalesList),
  'sales/sales-returns':         () => import('./modules/sales/sales.js').then(m => m.renderSalesReturns),
  'corrections/inbox':           () => import('./modules/corrections/corrections-inbox.js').then(m => m.renderCorrectionsInbox),
  'reports/production':          () => import('./modules/reports/reports.js').then(m => m.renderProductionReport),
  'reports/inventory':           () => import('./modules/reports/reports.js').then(m => m.renderInventoryReport),
  'reports/sales':               () => import('./modules/reports/reports.js').then(m => m.renderSalesReport),
  'reports/lifecycle':           () => import('./modules/reports/reports.js').then(m => m.renderLifecycleReport),
  'reports/ingredient-usage':    () => import('./modules/reports/reports.js').then(m => m.renderIngredientUsage),
  'reports/bi':                  () => import('./modules/reports/bi.js').then(m => m.renderBIDashboard),
  'settings/users':              () => import('./modules/settings/users.js').then(m => m.renderUsers),
  'settings/sheets-config':      () => import('./modules/settings/sheets-config.js').then(m => m.renderSheetsConfig),
};

// ─── Navigation Helper ───────────────────────────────────────
export function navigate(route) {
  window.location.hash = '#' + route;
}

// ─── Loading State Helper ─────────────────────────────────────
function _showPageLoading(msg = 'Loading…', slow = false) {
  const el = document.getElementById('fm-main');
  if (!el) return;
  el.innerHTML = `
    <div class="page-loading">
      <div class="spinner"></div>
      <p style="margin-top:.5rem">${escHtml(msg)}</p>
      ${slow ? `<p style="font-size:.75rem;color:var(--color-text-muted);margin-top:.25rem">
        Supabase is waking up after inactivity — data will appear shortly.
      </p>` : ''}
    </div>`;
}

// ─── Main Content Renderer ───────────────────────────────────
const mainEl = () => document.getElementById('fm-main');
let currentRoute = '';
let _routeGen = 0; // incremented on every navigation; stale renders bail out early

async function renderRoute(hash) {
  const gen = ++_routeGen; // capture generation for this navigation

  const [routePart, queryPart] = (hash || '').replace(/^#/, '').split('?');
  const route = routePart || 'dashboard';
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));

  if (!isLoggedIn()) { showLogin(); return; }

  const loader = ROUTES[route];
  if (!loader) {
    const m = mainEl(); if (m) m.innerHTML = `<div class="page-header"><h1 class="page-title">404 — Page Not Found</h1><p><a href="#dashboard">Go to Dashboard</a></p></div>`;
    return;
  }

  setActiveRoute(route);
  currentRoute = route;
  // Close mobile drawer and reset hamburger icon
  document.body.classList.remove('sidebar--open');
  const hbg = document.getElementById('fm-hamburger');
  if (hbg) { hbg.setAttribute('aria-expanded', 'false'); hbg.innerHTML = '☰'; }

  // Show loading state with progressive feedback
  _showPageLoading('Loading…');
  const slowTimer  = setTimeout(() => { if (gen === _routeGen) _showPageLoading('Waking up backend… please wait', true); }, 4_000);
  const stuckTimer = setTimeout(() => { if (gen === _routeGen) _showPageLoading('Still connecting… this can take up to 30 seconds on first load', true); }, 15_000);

  try {
    const renderFn = await loader();
    clearTimeout(slowTimer); clearTimeout(stuckTimer);
    // If user navigated away while the module was loading, bail out silently
    if (gen !== _routeGen) return;
    const m = mainEl(); if (!m) return;
    m.innerHTML = '';
    await renderFn(m, params);
  } catch (err) {
    clearTimeout(slowTimer); clearTimeout(stuckTimer);
    if (gen !== _routeGen) return; // stale error — new page already rendered
    console.error('Route error:', err);
    const m = mainEl(); if (!m) return;
    m.innerHTML = `
      <div class="page-error">
        <div style="font-size:2.5rem;margin-bottom:1rem">⚠️</div>
        <h2 style="margin-bottom:.5rem">Page failed to load</h2>
        <p style="margin-bottom:1.5rem;color:var(--color-text-muted);max-width:400px;margin-left:auto;margin-right:auto">${escHtml(err.message)}</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">
          <button class="btn btn--primary" onclick="window.location.reload()">🔄 Reload Page</button>
          <button class="btn btn--ghost" onclick="window.location.hash='#dashboard'">Go to Dashboard</button>
        </div>
      </div>`;
    toast.error(err.message);
  }
}

// ─── Login Screen ─────────────────────────────────────────────
function showLogin() {
  const app = document.getElementById('fm-app');
  if (app) app.style.display = 'none';
  const loginEl = document.getElementById('fm-login');
  if (loginEl) loginEl.style.display = '';
}

function hideLogin() {
  const app = document.getElementById('fm-app');
  if (app) app.style.display = '';
  const loginEl = document.getElementById('fm-login');
  if (loginEl) loginEl.style.display = 'none';
}

function bindLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = form.querySelector('#login-email')?.value;
    const password = form.querySelector('#login-password')?.value;
    const btn      = form.querySelector('[type=submit]');
    const err      = document.getElementById('login-error');
    if (err) err.textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await loginWithPassword(email, password);
      hideLogin();
      initSidebar(navigate);
      // Cache loads in background; navigate immediately
      loadDimCache().catch(e => console.warn('Cache load failed:', e.message));
      navigate('dashboard');
    } catch (ex) {
      if (err) err.textContent = ex.message;
      toast.error(ex.message);
    } finally { btn.disabled = false; btn.textContent = 'Sign In'; }
  });
}

// ─── App Bootstrap ────────────────────────────────────────────
async function bootstrap() {
  initToasts();

  // Listen for logout event
  window.addEventListener('fm:logout', () => {
    showLogin();
    if (document.getElementById('fm-app')) document.getElementById('fm-app').style.display = 'none';
    document.getElementById('fm-sidebar').innerHTML = '';
  });

  // Listen for cross-module toast events (e.g. from supabase-api.js)
  window.addEventListener('fm:toast', (e) => {
    const { type, message } = e.detail || {};
    if (type && message) toast[type]?.(message);
  });

  // Try to restore existing session
  const user = restoreSession();
  if (user) {
    hideLogin();
    initSidebar(navigate);
    initPremiumTopbar();
    initCommandPalette();

    // Start dim cache in background — don't block the first render.
    loadDimCache().catch(e => console.warn('Dim cache preload failed:', e.message));

    await renderRoute(window.location.hash || '#dashboard');
  } else {
    showLogin();
    bindLoginForm();
  }

  // Hash-based routing
  window.addEventListener('hashchange', () => {
    if (isLoggedIn()) {
      renderRoute(window.location.hash);
      syncBreadcrumb();
    }
  });
}

bootstrap();

// ─── Visual Shell Interactive Features ────────────────────────

let activeDropdown = null;

function initPremiumTopbar() {
  const user = getCurrentUser();
  if (!user) return;

  // Restore dark mode theme button indicator
  const isDark = document.documentElement.classList.contains('dark-mode');
  const themeBtn = document.getElementById('topbar-theme-toggle');
  if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';

  // Set avatar initials & profile info
  const initials = user.full_name ? user.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?';
  const avatarEl = document.getElementById('topbar-user-avatar');
  if (avatarEl) avatarEl.textContent = initials;

  const profileHeader = document.getElementById('profile-header-user');
  if (profileHeader) {
    profileHeader.innerHTML = `
      <div style="font-weight:600;color:var(--color-text)">${escHtml(user.full_name)}</div>
      <div style="font-size:0.75rem;color:var(--color-text-muted);font-weight:400">${escHtml(user.role)}</div>
    `;
  }

  // Bind dropdown toggle helper
  const setupDropdown = (triggerId, menuId) => {
    const trigger = document.getElementById(triggerId);
    const menu = document.getElementById(menuId);
    if (!trigger || !menu) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.contains('dropdown-menu--open');
      closeAllDropdowns();
      if (!open) {
        menu.classList.add('dropdown-menu--open');
        activeDropdown = menu;
      }
    });
  };

  setupDropdown('btn-quick-action', 'quick-action-menu');
  setupDropdown('topbar-notification-btn', 'notifications-menu');
  setupDropdown('topbar-profile-btn', 'profile-menu');

  // Document click to close all dropdowns
  document.addEventListener('click', () => {
    closeAllDropdowns();
  });

  // Theme Switcher
  themeBtn?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('fm_bi_dark', isDark);
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    toast.success(`${isDark ? 'Dark' : 'Light'} Mode enabled.`);
  });

  // Profile Change Password
  document.getElementById('profile-chgpwd')?.addEventListener('click', () => {
    // Dispatch a click to the sidebar password button so we reuse its modal logic
    document.getElementById('sidebar-chgpwd')?.click();
  });

  // Profile Logout
  document.getElementById('profile-logout')?.addEventListener('click', () => {
    logout();
    window.location.reload();
  });

  // Pull mock notifications / alerts to notification badge
  setTimeout(() => {
    const badge = document.getElementById('fm-notification-badge');
    const body = document.getElementById('notifications-body');
    if (!badge || !body) return;

    // Check low stock count or pending corrections in Supabase or display standard system notifications
    badge.textContent = '2';
    badge.style.display = 'inline-flex';
    body.innerHTML = `
      <div class="notification-item">
        <div class="notification-title">🚨 Low Stock Alert</div>
        <div class="notification-desc">Some recipe ingredients are below minimum godown threshold.</div>
      </div>
      <div class="notification-item">
        <div class="notification-title">✏️ Pending Correction</div>
        <div class="notification-desc">New correction request is pending operator review.</div>
      </div>
    `;
  }, 1500);

  syncBreadcrumb();
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(m => {
    m.classList.remove('dropdown-menu--open');
  });
  activeDropdown = null;
}

// Update breadcrumb visually to show nested module hierarchy
function syncBreadcrumb() {
  const hash = (window.location.hash || '#dashboard').replace(/^#/, '').split('?')[0];
  const breadcrumb = document.getElementById('fm-breadcrumb');
  if (!breadcrumb) return;

  let pathName = 'Dashboard';
  for (const item of NAV_ITEMS) {
    if (item.route === hash) {
      pathName = item.label;
      break;
    }
    if (item.children) {
      const match = item.children.find(c => c.route === hash);
      if (match) {
        pathName = `${item.label} <span class="topbar__divider">/</span> ${match.label}`;
        break;
      }
    }
  }
  breadcrumb.innerHTML = pathName;
}

// ─── Global Command Palette ───────────────────────────────────

function initCommandPalette() {
  const trigger = document.getElementById('fm-search-trigger');
  const palette = document.getElementById('fm-cmd-palette');
  const searchInput = document.getElementById('fm-cmd-search');
  const resultsContainer = document.getElementById('fm-cmd-results');
  const closeBtn = document.getElementById('fm-cmd-close-kbd');

  if (!palette || !searchInput || !resultsContainer) return;

  // Flatten the NAV_ITEMS structure for quick searching
  const searchableLinks = [];
  NAV_ITEMS.forEach(item => {
    if (item.children) {
      item.children.forEach(c => {
        searchableLinks.push({
          label: `${item.label} → ${c.label}`,
          route: c.route,
          icon: c.icon
        });
      });
    } else {
      searchableLinks.push({
        label: item.label,
        route: item.route,
        icon: item.icon
      });
    }
  });

  // Render search results based on input matching
  const renderResults = () => {
    const q = searchInput.value.toLowerCase().trim();
    const matches = searchableLinks.filter(l => l.label.toLowerCase().includes(q));

    if (matches.length === 0) {
      resultsContainer.innerHTML = `<div class="cmd-palette__empty">No commands or pages found matching "${escHtml(searchInput.value)}"</div>`;
      return;
    }

    resultsContainer.innerHTML = matches.map((m, idx) => `
      <div class="cmd-palette__item ${idx === 0 ? 'cmd-palette__item--active' : ''}" data-route="${m.route}">
        <span class="cmd-palette__item-icon">${m.icon}</span>
        <span class="cmd-palette__item-label">${escHtml(m.label)}</span>
        <span class="cmd-palette__item-shortcut">Jump ↵</span>
      </div>
    `).join('');
  };

  // Open/Close functions
  const openPalette = () => {
    palette.showModal();
    searchInput.value = '';
    renderResults();
    setTimeout(() => searchInput.focus(), 50);
  };

  const closePalette = () => {
    palette.close();
  };

  trigger?.addEventListener('click', openPalette);
  closeBtn?.addEventListener('click', closePalette);

  // Trigger search on Cmd+K / Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openPalette();
    }
  });

  // Handle keyboard navigation inside search results
  searchInput.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.cmd-palette__item');
    if (items.length === 0) return;

    let activeIdx = Array.from(items).findIndex(item => item.classList.contains('cmd-palette__item--active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[activeIdx]?.classList.remove('cmd-palette__item--active');
      activeIdx = (activeIdx + 1) % items.length;
      items[activeIdx]?.classList.add('cmd-palette__item--active');
      items[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[activeIdx]?.classList.remove('cmd-palette__item--active');
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      items[activeIdx]?.classList.add('cmd-palette__item--active');
      items[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeItem = items[activeIdx];
      if (activeItem) {
        navigate(activeItem.dataset.route);
        closePalette();
      }
    }
  });

  // Live filter input event listener
  searchInput.addEventListener('input', renderResults);

  // Direct click handling
  resultsContainer.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-palette__item');
    if (!item) return;
    navigate(item.dataset.route);
    closePalette();
  });
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
