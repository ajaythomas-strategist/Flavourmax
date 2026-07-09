// ============================================================
// components/sidebar.js — Collapsible Sidebar Navigation
// Role-aware nav, active route highlighting, mobile drawer
// ============================================================

import { getCurrentUser, hasPermission, logout, changePassword } from '../auth.js';
import { toast } from './toast.js';

export const NAV_ITEMS = [
  {
    label: 'Dashboard', icon: '▦', route: 'dashboard', perm: 'dashboard',
  },
  {
    label: 'Master Data', icon: '⚙', perm: 'master_view',
    children: [
      { label: 'Companies',       icon: '🏢', route: 'master/companies',   perm: 'master_view' },
      { label: 'Categories',      icon: '🏷', route: 'master/categories',  perm: 'master_view' },
      { label: 'Products',        icon: '📦', route: 'master/products',    perm: 'master_view' },
      { label: 'Ingredients',     icon: '🧪', route: 'master/ingredients', perm: 'master_view' },
      { label: 'Processes & Fields', icon: '🔧', route: 'master/processes', perm: 'master_view' },
      { label: 'Recipes',         icon: '📋', route: 'master/recipes',     perm: 'master_view' },
      { label: 'Units',            icon: '⚖', route: 'master/units',       perm: 'master_view' },
      { label: 'Suppliers',       icon: '🚛', route: 'master/suppliers',   perm: 'master_view' },
      { label: 'Godowns / Warehouses', icon: '🏬', route: 'master/warehouses', perm: 'master_view' },
    ]
  },
  {
    label: 'Inventory', icon: '🏭', perm: 'inventory_view',
    children: [
      { label: 'Stock In',       icon: '⬇', route: 'inventory/stock-in',      perm: 'inventory_view' },
      { label: 'Stock Out',      icon: '⬆', route: 'inventory/stock-out',     perm: 'inventory_view' },
      { label: 'Current Stock',  icon: '📊', route: 'inventory/current-stock', perm: 'inventory_view' },
    ]
  },
  {
    label: 'Production', icon: '⚗', perm: 'production_view',
    children: [
      { label: 'New Batch',    icon: '➕', route: 'production/new-batch',   perm: 'production_edit' },
      { label: 'Batch List',   icon: '📄', route: 'production/batch-list',  perm: 'production_view' },
    ]
  },
  {
    label: 'Dispatch', icon: '🚚', perm: 'dispatch_view',
    children: [
      { label: 'New Dispatch',   icon: '➕', route: 'dispatch/new-dispatch',   perm: 'dispatch_edit' },
      { label: 'Dispatch List',  icon: '📄', route: 'dispatch/dispatch-list',  perm: 'dispatch_view' },
    ]
  },
  {
    label: 'Sales Orders', icon: '📋', perm: 'sales_view',
    children: [
      { label: 'New Sales Order',   icon: '➕', route: 'sales/new-order',    perm: 'sales_edit' },
      { label: 'Sales Order List',  icon: '📄', route: 'sales/order-list',   perm: 'sales_view' },
    ]
  },
  {
    label: 'Invoices', icon: '🧾', perm: 'sales_view',
    children: [
      { label: 'New Invoice',   icon: '➕', route: 'sales/new-sale',    perm: 'sales_edit' },
      { label: 'Invoice List',  icon: '📄', route: 'sales/sales-list',  perm: 'sales_view' },
      { label: 'Sales Returns', icon: '↩', route: 'sales/sales-returns', perm: 'sales_view' },
    ]
  },
  {
    label: 'Corrections', icon: '✏', route: 'corrections/inbox', perm: 'corrections_raise',
  },
  {
    label: 'BI Dashboards', icon: '📊', perm: 'reports_view',
    children: [
      { label: 'Executive Dashboard',   icon: '🏛', route: 'reports/bi?tab=executive',   perm: 'reports_view' },
      { label: 'Order Analytics',       icon: '📋', route: 'reports/bi?tab=orders',      perm: 'reports_view' },
      { label: 'Production & WIP',      icon: '⚗', route: 'reports/bi?tab=production',  perm: 'reports_view' },
      { label: 'Process Analytics',     icon: '⏱', route: 'reports/bi?tab=process',     perm: 'reports_view' },
      { label: 'Inventory & Godowns',   icon: '🏬', route: 'reports/bi?tab=inventory',   perm: 'reports_view' },
      { label: 'Dispatch Tracking',     icon: '🚚', route: 'reports/bi?tab=dispatch',    perm: 'reports_view' },
      { label: 'Customer Analytics',    icon: '🏢', route: 'reports/bi?tab=customer',    perm: 'reports_view' },
      { label: 'Product Performance',   icon: '🏷', route: 'reports/bi?tab=product',     perm: 'reports_view' },
      { label: 'Meeting Reviews',       icon: '👥', route: 'reports/bi?tab=reviews',     perm: 'reports_view' },
      { label: 'Exception Control',     icon: '🚨', route: 'reports/bi?tab=exceptions',  perm: 'reports_view' },
      { label: 'Labour & Shifts',       icon: '👥', route: 'reports/bi?tab=labour',      perm: 'reports_view' },
      { label: 'Machine Performance',   icon: '⚙', route: 'reports/bi?tab=machines',    perm: 'reports_view' },
    ]
  },
  {
    label: 'Settings', icon: '⚙', perm: 'settings_edit',
    children: [
      { label: 'User Management', icon: '👥', route: 'settings/users', perm: 'users_manage' },
    ]
  },
];

// ─── Bottom nav items (primary 4 + menu) ────────────────────
const BOTTOM_NAV = [
  { icon: '▦',  label: 'Dashboard',  route: 'dashboard',             perm: 'dashboard' },
  { icon: '🏭', label: 'Inventory',  route: 'inventory/current-stock', perm: 'inventory_view' },
  { icon: '⚗',  label: 'Production', route: 'production/batch-list',  perm: 'production_view' },
  { icon: '🚚', label: 'Dispatch',   route: 'dispatch/dispatch-list', perm: 'dispatch_view' },
  { icon: '☰',  label: 'More',       route: null,                     perm: 'dashboard' },
];

// Manage Favorites & Recents in LocalStorage
function getFavorites() { return JSON.parse(localStorage.getItem('fm_favs') || '[]'); }
function toggleFavorite(route, label, icon) {
  let favs = getFavorites();
  const index = favs.findIndex(f => f.route === route);
  if (index > -1) favs.splice(index, 1);
  else favs.push({ route, label, icon });
  localStorage.setItem('fm_favs', JSON.stringify(favs));
  renderFavoritesList();
}
function addRecentPage(route, label, icon) {
  if (!route) return;
  let recs = JSON.parse(localStorage.getItem('fm_recs') || '[]');
  // Filter out duplicate
  recs = recs.filter(r => r.route !== route);
  recs.unshift({ route, label, icon });
  recs = recs.slice(0, 5); // keep last 5
  localStorage.setItem('fm_recs', JSON.stringify(recs));
  renderRecentsList();
}

function renderFavoritesList() {
  const el = document.getElementById('sidebar-favorites-list');
  const sect = document.getElementById('sidebar-favorites-section');
  if (!el || !sect) return;
  const favs = getFavorites();
  if (favs.length === 0) {
    sect.style.display = 'none';
    return;
  }
  sect.style.display = 'block';
  el.innerHTML = favs.map(f => `
    <li>
      <a class="sidebar__link sidebar__link--child" href="#${f.route}" data-route="${f.route}">
        <span class="sidebar__icon">${f.icon}</span>
        <span class="sidebar__label">${escHtml(f.label)}</span>
      </a>
    </li>
  `).join('');
}

function renderRecentsList() {
  const el = document.getElementById('sidebar-recents-list');
  const sect = document.getElementById('sidebar-recents-section');
  if (!el || !sect) return;
  const recs = JSON.parse(localStorage.getItem('fm_recs') || '[]');
  if (recs.length === 0) {
    sect.style.display = 'none';
    return;
  }
  sect.style.display = 'block';
  el.innerHTML = recs.map(r => `
    <li>
      <a class="sidebar__link sidebar__link--child" href="#${r.route}" data-route="${r.route}">
        <span class="sidebar__icon">${r.icon}</span>
        <span class="sidebar__label">${escHtml(r.label)}</span>
      </a>
    </li>
  `).join('');
}

export function initSidebar(onNavigate) {
  const sidebar = document.getElementById('fm-sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar__header">
      <div class="sidebar__logo">
        <span class="sidebar__logo-icon">🍃</span>
        <span class="sidebar__logo-text">Flavourmax</span>
      </div>
      <button class="sidebar__toggle" id="sidebar-toggle" aria-label="Toggle sidebar">◀</button>
    </div>

    <!-- Sidebar Search -->
    <div class="sidebar__search-wrap">
      <div class="sidebar__search-inner">
        <span class="sidebar__search-icon">🔍</span>
        <input type="text" id="fm-sidebar-search" class="sidebar__search-input" placeholder="Quick find page..." autocomplete="off">
      </div>
    </div>

    <nav class="sidebar__nav" aria-label="Main navigation">
      <!-- Favorites Section -->
      <div class="sidebar__section" id="sidebar-favorites-section" style="display:none">
        <div class="sidebar__section-title">⭐ Pinned Favorites</div>
        <ul class="sidebar__sub-list" id="sidebar-favorites-list"></ul>
      </div>

      <!-- Recents Section -->
      <div class="sidebar__section" id="sidebar-recents-section" style="display:none">
        <div class="sidebar__section-title">⏱ Recents</div>
        <ul class="sidebar__sub-list" id="sidebar-recents-list"></ul>
      </div>

      <!-- Main Navigation Section -->
      <div class="sidebar__section-title">📦 Application Modules</div>
      <div id="sidebar-main-nav">
        ${buildNavItems(onNavigate)}
      </div>
    </nav>

    <div class="sidebar__footer">
      <div class="sidebar__user">
        <div class="sidebar__avatar">${getUserInitials()}</div>
        <div class="sidebar__user-info">
          <div class="sidebar__user-name">${escHtml(getCurrentUser()?.full_name || '')}</div>
          <div class="sidebar__user-role">${escHtml(getCurrentUser()?.role || '')}</div>
        </div>
      </div>
      <div style="display:flex;gap:.25rem">
        <button class="btn btn--ghost btn--sm" id="sidebar-chgpwd" title="Change Password">🔑</button>
        <button class="btn btn--ghost btn--sm sidebar__logout" id="sidebar-logout" title="Logout">⏻</button>
      </div>
    </div>
  `;

  // Render sub lists
  renderFavoritesList();
  renderRecentsList();

  // Toggle collapse (desktop only)
  const toggleBtn = document.getElementById('sidebar-toggle');
  toggleBtn?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar--collapsed');
    const collapsed = document.body.classList.contains('sidebar--collapsed');
    toggleBtn.textContent = collapsed ? '▶' : '◀';
    localStorage.setItem('fm_sidebar_collapsed', collapsed ? '1' : '0');
  });

  // Restore collapse state
  if (localStorage.getItem('fm_sidebar_collapsed') === '1') {
    document.body.classList.add('sidebar--collapsed');
    toggleBtn && (toggleBtn.textContent = '▶');
  }

  // Mobile hamburger
  const hamburger = document.getElementById('fm-hamburger');
  hamburger?.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('sidebar--open');
    hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    hamburger.innerHTML = isOpen ? '✕' : '☰';
  });

  // Close on overlay click (mobile)
  document.getElementById('fm-overlay')?.addEventListener('click', () => {
    closeMobileSidebar();
  });

  // Swipe-to-close gesture on sidebar
  _initSwipeClose(sidebar);

  // Close sidebar when any nav link is clicked on mobile
  sidebar.addEventListener('click', e => {
    if (e.target.closest('[data-route]') && window.innerWidth <= 768) {
      closeMobileSidebar();
    }
  });

  // Change Password
  document.getElementById('sidebar-chgpwd')?.addEventListener('click', () => {
    showChangePasswordModal();
  });

  // Logout
  document.getElementById('sidebar-logout')?.addEventListener('click', () => {
    logout();
    window.location.reload();
  });

  // Pinned/Favorites star action triggers
  sidebar.addEventListener('click', e => {
    const starBtn = e.target.closest('.sidebar__star-btn');
    if (!starBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const route = starBtn.dataset.starRoute;
    const label = starBtn.dataset.starLabel;
    const icon = starBtn.dataset.starIcon;
    toggleFavorite(route, label, icon);
    // update stars visually
    const isFavNow = getFavorites().some(f => f.route === route);
    starBtn.classList.toggle('sidebar__star-btn--active', isFavNow);
    starBtn.innerHTML = isFavNow ? '★' : '☆';
  });

  // Sidebar link filtering (Live Search)
  const searchInput = document.getElementById('fm-sidebar-search');
  searchInput?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const links = sidebar.querySelectorAll('#sidebar-main-nav .sidebar__link');
    const details = sidebar.querySelectorAll('#sidebar-main-nav details');

    if (!query) {
      // restore all
      links.forEach(l => {
        l.style.display = 'flex';
        const li = l.closest('li');
        if (li) li.style.display = 'block';
      });
      details.forEach(d => {
        d.style.display = 'block';
        d.open = false;
      });
      return;
    }

    details.forEach(d => {
      let groupHasMatch = false;
      const subLinks = d.querySelectorAll('.sidebar__link');
      subLinks.forEach(l => {
        const text = l.querySelector('.sidebar__label')?.textContent.toLowerCase() || '';
        const match = text.includes(query);
        l.style.display = match ? 'flex' : 'none';
        const li = l.closest('li');
        if (li) li.style.display = match ? 'block' : 'none';
        if (match) groupHasMatch = true;
      });
      d.style.display = groupHasMatch ? 'block' : 'none';
      if (groupHasMatch) d.open = true;
    });

    // Handle root links that do not have submenus
    const rootLinks = sidebar.querySelectorAll('#sidebar-main-nav > .sidebar__link');
    rootLinks.forEach(l => {
      const text = l.querySelector('.sidebar__label')?.textContent.toLowerCase() || '';
      const match = text.includes(query);
      l.style.display = match ? 'flex' : 'none';
    });
  });

  // Inject bottom nav bar (mobile only)
  _initBottomNav();
}

function closeMobileSidebar() {
  document.body.classList.remove('sidebar--open');
  const hamburger = document.getElementById('fm-hamburger');
  if (hamburger) {
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.innerHTML = '☰';
  }
}

function _initSwipeClose(sidebar) {
  let startX = 0, startY = 0;
  sidebar.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  sidebar.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (dx < -50 && dy < 60) closeMobileSidebar(); // swipe left
  }, { passive: true });
}

function _initBottomNav() {
  if (document.getElementById('fm-bottom-nav')) return; // already injected

  const user = getCurrentUser();
  const items = BOTTOM_NAV.filter(i => hasPermission(i.perm));
  if (items.length === 0) return;

  const nav = document.createElement('nav');
  nav.id = 'fm-bottom-nav';
  nav.className = 'fm-bottom-nav';
  nav.setAttribute('aria-label', 'Quick navigation');

  nav.innerHTML = items.map(item => `
    <button
      class="fm-bottom-nav__item"
      data-bnav-route="${item.route || ''}"
      aria-label="${escHtml(item.label)}"
    >
      <span class="fm-bottom-nav__icon">${item.icon}</span>
      <span class="fm-bottom-nav__label">${escHtml(item.label)}</span>
    </button>
  `).join('');

  document.body.appendChild(nav);

  nav.addEventListener('click', e => {
    const btn = e.target.closest('[data-bnav-route]');
    if (!btn) return;
    const route = btn.dataset.bnavRoute;
    if (!route) {
      // "More" → open sidebar
      document.body.classList.add('sidebar--open');
      const hamburger = document.getElementById('fm-hamburger');
      if (hamburger) { hamburger.setAttribute('aria-expanded', 'true'); hamburger.innerHTML = '✕'; }
    } else {
      window.location.hash = '#' + route;
    }
  });
}

function buildNavItems(onNavigate) {
  const favs = getFavorites();
  return NAV_ITEMS.filter(item => hasPermission(item.perm)).map(item => {
    if (item.children) {
      const visibleChildren = item.children.filter(c => hasPermission(c.perm));
      if (visibleChildren.length === 0) return '';
      const childItems = visibleChildren.map(c => {
        const isFav = favs.some(f => f.route === c.route);
        return `
          <li style="position:relative">
            <a class="sidebar__link sidebar__link--child" href="#${c.route}" data-route="${c.route}">
              <span class="sidebar__icon">${c.icon}</span>
              <span class="sidebar__label">${escHtml(c.label)}</span>
            </a>
            <button class="sidebar__star-btn ${isFav ? 'sidebar__star-btn--active' : ''}" 
                    data-star-route="${c.route}" data-star-label="${escHtml(c.label)}" data-star-icon="${c.icon}" 
                    title="Pin to Favorites" aria-label="Favorite">${isFav ? '★' : '☆'}</button>
          </li>
        `;
      }).join('');

      return `
        <details class="sidebar__group" name="nav-group">
          <summary class="sidebar__group-header">
            <span class="sidebar__icon">${item.icon}</span>
            <span class="sidebar__label">${escHtml(item.label)}</span>
            <span class="sidebar__chevron" aria-hidden="true">▾</span>
          </summary>
          <ul class="sidebar__sub-list">${childItems}</ul>
        </details>`;
    } else {
      const isFav = favs.some(f => f.route === item.route);
      return `
        <div style="position:relative">
          <a class="sidebar__link" href="#${item.route}" data-route="${item.route}">
            <span class="sidebar__icon">${item.icon}</span>
            <span class="sidebar__label">${escHtml(item.label)}</span>
          </a>
          <button class="sidebar__star-btn ${isFav ? 'sidebar__star-btn--active' : ''}" 
                  data-star-route="${item.route}" data-star-label="${escHtml(item.label)}" data-star-icon="${item.icon}" 
                  title="Pin to Favorites" aria-label="Favorite">${isFav ? '★' : '☆'}</button>
        </div>`;
    }
  }).join('');
}

export function setActiveRoute(route) {
  // Find item details from route
  let matchedItem = null;
  for (const item of NAV_ITEMS) {
    if (item.route === route) { matchedItem = item; break; }
    if (item.children) {
      const found = item.children.find(c => c.route === route);
      if (found) { matchedItem = found; break; }
    }
  }
  if (matchedItem) {
    addRecentPage(route, matchedItem.label, matchedItem.icon);
  }

  // Sidebar links
  document.querySelectorAll('.sidebar__link').forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('sidebar__link--active', isActive);
    if (isActive) {
      const group = link.closest('details');
      if (group) group.open = true;
    }
  });

  // Bottom nav highlight
  document.querySelectorAll('.fm-bottom-nav__item').forEach(btn => {
    const r = btn.dataset.bnavRoute;
    // Exact match OR section match (e.g. inventory/* → inventory nav item)
    const section = route.split('/')[0];
    const isActive = r && (r === route || r.startsWith(section + '/'));
    btn.classList.toggle('fm-bottom-nav__item--active', isActive);
  });
}

function getUserInitials() {
  const name = getCurrentUser()?.full_name || '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function showChangePasswordModal() {
  const dialog = document.createElement('dialog');
  dialog.className = 'fm-modal';
  dialog.innerHTML = `
    <div class="fm-modal__header">
      <h2 class="fm-modal__title">Change Password</h2>
    </div>
    <form class="fm-modal__body" id="chgpwd-form" method="dialog" novalidate>
      <div class="form-group">
        <label for="chgpwd-current">Current Password</label>
        <input type="password" id="chgpwd-current" autocomplete="current-password" required placeholder="••••••••">
      </div>
      <div class="form-group">
        <label for="chgpwd-new">New Password</label>
        <input type="password" id="chgpwd-new" autocomplete="new-password" required placeholder="Min. 6 characters">
      </div>
      <div class="form-group">
        <label for="chgpwd-confirm">Confirm New Password</label>
        <input type="password" id="chgpwd-confirm" autocomplete="new-password" required placeholder="Re-enter new password">
      </div>
      <p id="chgpwd-error" style="color:var(--color-danger);font-size:0.85rem;min-height:1.2em"></p>
    </form>
    <div class="fm-modal__footer">
      <button class="btn btn--ghost" id="chgpwd-cancel">Cancel</button>
      <button class="btn btn--primary" id="chgpwd-submit">Update Password</button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();

  const errEl = dialog.querySelector('#chgpwd-error');

  dialog.querySelector('#chgpwd-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 300));

  dialog.querySelector('#chgpwd-submit').addEventListener('click', async () => {
    const current = dialog.querySelector('#chgpwd-current').value;
    const newPwd  = dialog.querySelector('#chgpwd-new').value;
    const confirm = dialog.querySelector('#chgpwd-confirm').value;
    errEl.textContent = '';

    if (!current || !newPwd || !confirm) { errEl.textContent = 'All fields are required.'; return; }
    if (newPwd !== confirm) { errEl.textContent = 'New passwords do not match.'; return; }
    if (newPwd.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

    const btn = dialog.querySelector('#chgpwd-submit');
    btn.disabled = true; btn.textContent = 'Updating…';
    try {
      await changePassword(current, newPwd);
      dialog.close();
      toast.success('Password updated successfully.');
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = 'Update Password';
    }
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
