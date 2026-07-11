// ============================================================
// app.js — SPA Router & App Bootstrap
// ============================================================
import { restoreSession, loginWithPassword, isLoggedIn, getCurrentUser } from './auth.js';
import { initSidebar, setActiveRoute } from './components/sidebar.js';
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
    // Stamp a unique render token on the container for stale-render detection.
    const renderToken = String(gen);
    m.dataset.renderToken = renderToken;

    // A no-op proxy: silently absorbs any method call, property set or read.
    // Returned by guardedContainer's query methods when the render is stale.
    const _noOp = (() => {
      const handler = {
        get:   () => _noOpFn,
        set:   () => true,
        apply: () => _noOpFn,
      };
      // needs to be a function so it can be used as a constructor or called
      function _noOpFn() {}
      return new Proxy(_noOpFn, handler);
    })();

    // Guarded container: query methods check the render token and return _noOp
    // if a newer render has already taken ownership of the container.
    const guardedContainer = new Proxy(m, {
      get(target, prop, receiver) {
        if (prop === 'querySelector' || prop === 'querySelectorAll' ||
            prop === 'getElementById') {
          return (...args) => {
            if (m.dataset.renderToken !== renderToken) {
              // This render is stale — return a silent no-op so that
              // `container.querySelector('#btn')?.addEventListener(...)` does nothing.
              return _noOp;
            }
            const el = target[prop].apply(target, args);
            return el; // may still be null — callers should use ?.
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await renderFn(guardedContainer, params);

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

    // Start dim cache in background — don't block the first render.
    // Each page fetches its own data; the cache just speeds up subsequent loads.
    loadDimCache().catch(e => console.warn('Dim cache preload failed:', e.message));

    await renderRoute(window.location.hash || '#dashboard');
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
