// ============================================================
// app.js — SPA Router & App Bootstrap
// ============================================================
import { restoreSession, loginWithPassword, isLoggedIn, getCurrentUser } from './auth.js';
import { initSidebar, setActiveRoute } from './components/sidebar.js';
import { initToasts, toast } from './components/toast.js';
import { loadDimCache } from './sheets-api.js';

// ─── Route Map ───────────────────────────────────────────────
const ROUTES = {
  'dashboard':                   () => import('./modules/dashboard.js').then(m => m.renderDashboard),
  'master/companies':            () => import('./modules/master/companies.js').then(m => m.renderCompanies),
  'master/products':             () => import('./modules/master/products.js').then(m => m.renderProducts),
  'master/ingredients':          () => import('./modules/master/ingredients.js').then(m => m.renderIngredients),
  'master/processes':            () => import('./modules/master/processes.js').then(m => m.renderProcesses),
  'master/recipes':              () => import('./modules/master/recipes.js').then(m => m.renderRecipes),
  'master/units':                () => import('./modules/master/units.js').then(m => m.renderUnits),
  'master/suppliers':            () => import('./modules/master/suppliers.js').then(m => m.renderSuppliers),
  'inventory/stock-in':          () => import('./modules/inventory/stock-in.js').then(m => m.renderStockIn),
  'inventory/stock-out':         () => import('./modules/inventory/stock-out.js').then(m => m.renderStockOut),
  'inventory/current-stock':     () => import('./modules/inventory/current-stock.js').then(m => m.renderCurrentStock),
  'production/new-batch':        () => import('./modules/production/new-batch.js').then(m => m.renderNewBatch),
  'production/batch-list':       () => import('./modules/production/batch-list.js').then(m => m.renderBatchList),
  'production/process-log':      () => import('./modules/production/process-log.js').then(m => m.renderProcessLog),
  'dispatch/new-dispatch':       () => import('./modules/dispatch/dispatch.js').then(m => m.renderNewDispatch),
  'dispatch/dispatch-list':      () => import('./modules/dispatch/dispatch.js').then(m => m.renderDispatchList),
  'sales/new-sale':              () => import('./modules/sales/sales.js').then(m => m.renderNewSale),
  'sales/sales-list':            () => import('./modules/sales/sales.js').then(m => m.renderSalesList),
  'sales/sales-returns':         () => import('./modules/sales/sales.js').then(m => m.renderSalesReturns),
  'corrections/inbox':           () => import('./modules/corrections/corrections-inbox.js').then(m => m.renderCorrectionsInbox),
  'reports/production':          () => import('./modules/reports/reports.js').then(m => m.renderProductionReport),
  'reports/inventory':           () => import('./modules/reports/reports.js').then(m => m.renderInventoryReport),
  'reports/sales':               () => import('./modules/reports/reports.js').then(m => m.renderSalesReport),
  'reports/ingredient-usage':    () => import('./modules/reports/reports.js').then(m => m.renderIngredientUsage),
  'settings/users':              () => import('./modules/settings/users.js').then(m => m.renderUsers),
  'settings/sheets-config':      () => import('./modules/settings/sheets-config.js').then(m => m.renderSheetsConfig),
};

// ─── Navigation Helper ───────────────────────────────────────
export function navigate(route) {
  window.location.hash = '#' + route;
}

// ─── Main Content Renderer ───────────────────────────────────
const mainEl = () => document.getElementById('fm-main');
let currentRoute = '';

async function renderRoute(hash) {
  const [routePart, queryPart] = (hash || '').replace(/^#/, '').split('?');
  const route = routePart || 'dashboard';
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));

  if (!isLoggedIn()) { showLogin(); return; }

  const loader = ROUTES[route];
  if (!loader) {
    mainEl().innerHTML = `<div class="page-header"><h1 class="page-title">404 — Page Not Found</h1><p><a href="#dashboard">Go to Dashboard</a></p></div>`;
    return;
  }

  // Show loading state
  mainEl().innerHTML = `<div class="page-loading"><div class="spinner"></div><p>Loading…</p></div>`;
  setActiveRoute(route);
  currentRoute = route;
  document.body.classList.remove('sidebar--open'); // close mobile drawer

  try {
    const renderFn = await loader();
    mainEl().innerHTML = '';
    await renderFn(mainEl(), params);
  } catch (err) {
    console.error('Route error:', err);
    mainEl().innerHTML = `<div class="page-error"><h2>Something went wrong</h2><p>${escHtml(err.message)}</p><button class="btn btn--primary" onclick="location.reload()">Reload</button></div>`;
    toast.error('Page error: ' + err.message);
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
      await loadDimCache();
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

  // Listen for cross-module toast events (e.g. from sheets-api.js)
  window.addEventListener('fm:toast', (e) => {
    const { type, message } = e.detail || {};
    if (type && message) toast[type]?.(message);
  });

  // Try to restore existing session
  const user = restoreSession();
  if (user) {
    hideLogin();
    initSidebar(navigate);
    await Promise.all([
      loadDimCache().catch(e => console.warn('Cache load failed:', e.message)),
      renderRoute(window.location.hash || '#dashboard'),
    ]);
  } else {
    showLogin();
    bindLoginForm();
  }

  // Hash-based routing
  window.addEventListener('hashchange', () => {
    if (isLoggedIn()) renderRoute(window.location.hash);
  });
}

bootstrap();

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
