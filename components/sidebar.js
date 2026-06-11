// ============================================================
// components/sidebar.js — Collapsible Sidebar Navigation
// Role-aware nav, active route highlighting, mobile drawer
// ============================================================

import { getCurrentUser, hasPermission, logout } from '../auth.js';

const NAV_ITEMS = [
  {
    label: 'Dashboard', icon: '▦', route: 'dashboard', perm: 'dashboard',
  },
  {
    label: 'Master Data', icon: '⚙', perm: 'master_view',
    children: [
      { label: 'Companies',       icon: '🏢', route: 'master/companies',   perm: 'master_view' },
      { label: 'Products',        icon: '📦', route: 'master/products',    perm: 'master_view' },
      { label: 'Ingredients',     icon: '🧪', route: 'master/ingredients', perm: 'master_view' },
      { label: 'Processes & Fields', icon: '🔧', route: 'master/processes', perm: 'master_view' },
      { label: 'Recipes',         icon: '📋', route: 'master/recipes',     perm: 'master_view' },
      { label: 'Units',            icon: '⚖', route: 'master/units',       perm: 'master_view' },
      { label: 'Suppliers',       icon: '🚛', route: 'master/suppliers',   perm: 'master_view' },
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
    label: 'Corrections', icon: '✏', route: 'corrections/inbox', perm: 'corrections_raise',
  },
  {
    label: 'Reports', icon: '📈', perm: 'reports_view',
    children: [
      { label: 'Production',        icon: '⚗', route: 'reports/production',       perm: 'reports_view' },
      { label: 'Inventory',         icon: '📦', route: 'reports/inventory',        perm: 'reports_view' },
      { label: 'Sales',             icon: '💰', route: 'reports/sales',            perm: 'reports_view' },
      { label: 'Ingredient Usage',  icon: '🧪', route: 'reports/ingredient-usage', perm: 'reports_view' },
    ]
  },
  {
    label: 'Settings', icon: '⚙', perm: 'settings_edit',
    children: [
      { label: 'User Management', icon: '👥', route: 'settings/users', perm: 'users_manage' },
    ]
  },
];

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
    <nav class="sidebar__nav" aria-label="Main navigation">
      ${buildNavItems(onNavigate)}
    </nav>
    <div class="sidebar__footer">
      <div class="sidebar__user">
        <div class="sidebar__avatar">${getUserInitials()}</div>
        <div class="sidebar__user-info">
          <div class="sidebar__user-name">${escHtml(getCurrentUser()?.full_name || '')}</div>
          <div class="sidebar__user-role">${escHtml(getCurrentUser()?.role || '')}</div>
        </div>
      </div>
      <button class="btn btn--ghost btn--sm sidebar__logout" id="sidebar-logout" title="Logout">⏻</button>
    </div>
  `;

  // Toggle collapse
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
    document.body.classList.toggle('sidebar--open');
  });

  // Close on overlay click (mobile)
  document.getElementById('fm-overlay')?.addEventListener('click', () => {
    document.body.classList.remove('sidebar--open');
  });

  // Logout
  document.getElementById('sidebar-logout')?.addEventListener('click', () => {
    logout();
    window.location.reload();
  });
}

function buildNavItems(onNavigate) {
  return NAV_ITEMS.filter(item => hasPermission(item.perm)).map(item => {
    if (item.children) {
      const visibleChildren = item.children.filter(c => hasPermission(c.perm));
      if (visibleChildren.length === 0) return '';
      const childItems = visibleChildren.map(c => `
        <li><a class="sidebar__link sidebar__link--child" href="#${c.route}" data-route="${c.route}">
          <span class="sidebar__icon">${c.icon}</span>
          <span class="sidebar__label">${escHtml(c.label)}</span>
        </a></li>
      `).join('');

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
      return `
        <a class="sidebar__link" href="#${item.route}" data-route="${item.route}">
          <span class="sidebar__icon">${item.icon}</span>
          <span class="sidebar__label">${escHtml(item.label)}</span>
        </a>`;
    }
  }).join('');
}

export function setActiveRoute(route) {
  document.querySelectorAll('.sidebar__link').forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('sidebar__link--active', isActive);
    if (isActive) {
      const group = link.closest('details');
      if (group) group.open = true;
    }
  });
}

function getUserInitials() {
  const name = getCurrentUser()?.full_name || '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
