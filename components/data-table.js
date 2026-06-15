// ============================================================
// components/data-table.js — Reusable DataTable Component
// Client-side sort, search, filter, pagination, CSV export
// ============================================================

import { CONFIG } from '../config.js?v=4';

export class DataTable {
  constructor(container, { columns, data = [], actions = [], onRowClick, emptyMessage = 'No records found.' }) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.columns = columns;
    this.allData = data;
    this.filteredData = [...data];
    this.actions = actions;
    this.onRowClick = onRowClick;
    this.emptyMessage = emptyMessage;
    this.currentPage = 1;
    this.pageSize = CONFIG.ROWS_PER_PAGE;
    this.sortCol = null;
    this.sortDir = 'asc';
    this.searchQuery = '';
    this._render();
  }

  setData(data) {
    this.allData = data;
    this.currentPage = 1;
    this._applyFilters();
  }

  _applyFilters() {
    const q = this.searchQuery.toLowerCase().trim();
    this.filteredData = this.allData.filter(row => {
      if (!q) return true;
      return this.columns.some(col => {
        const val = row[col.key] ?? '';
        return String(val).toLowerCase().includes(q);
      });
    });
    if (this.sortCol) this._sort(this.sortCol, false);
    this._renderBody();
    this._renderPagination();
  }

  _sort(colKey, toggle = true) {
    if (toggle) {
      if (this.sortCol === colKey) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortCol = colKey; this.sortDir = 'asc';
      }
    }
    this.filteredData.sort((a, b) => {
      const va = a[colKey] ?? ''; const vb = b[colKey] ?? '';
      const na = parseFloat(va); const nb = parseFloat(vb);
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb));
      return this.sortDir === 'asc' ? cmp : -cmp;
    });
    this._renderBody();
    this._updateSortIcons();
  }

  _render() {
    this.container.innerHTML = `
      <div class="dt-toolbar">
        <div class="dt-search">
          <span class="dt-search__icon">🔍</span>
          <input type="search" class="dt-search__input" placeholder="Search…" aria-label="Search table">
        </div>
        <div class="dt-toolbar__right">
          <button class="btn btn--ghost btn--sm dt-export" title="Export CSV">⬇ CSV</button>
        </div>
      </div>
      <div class="dt-scroll-wrap">
        <table class="dt" role="grid">
          <thead class="dt__head"><tr>${this._renderHeaders()}</tr></thead>
          <tbody class="dt__body"></tbody>
        </table>
      </div>
      <div class="dt-pagination"></div>
    `;
    this._bindToolbar();
    this._renderBody();
    this._renderPagination();
  }

  _renderHeaders() {
    const cols = this.columns.map(col => {
      const sortable = col.sortable !== false ? 'dt__th--sortable' : '';
      return `<th class="dt__th ${sortable}" data-col="${col.key}" scope="col" tabindex="0">
        ${escHtml(col.label)}<span class="dt__sort-icon" aria-hidden="true"></span>
      </th>`;
    });
    if (this.actions.length) cols.push('<th class="dt__th dt__th--actions" scope="col">Actions</th>');
    return cols.join('');
  }

  _renderBody() {
    const tbody = this.container.querySelector('.dt__body');
    if (!tbody) return;
    const start = (this.currentPage - 1) * this.pageSize;
    const page  = this.filteredData.slice(start, start + this.pageSize);

    if (page.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${this.columns.length + (this.actions.length ? 1 : 0)}" class="dt__empty">${this.emptyMessage}</td></tr>`;
      return;
    }

    tbody.innerHTML = page.map((row, idx) => {
      const cells = this.columns.map(col => {
        let val = row[col.key] ?? '';
        if (col.render) val = col.render(val, row);
        else val = escHtml(val);
        return `<td class="dt__td">${val}</td>`;
      }).join('');

      const actionBtns = this.actions.map(a => {
        if (a.visible && !a.visible(row)) return '';
        if (a.show && !a.show(row)) return '';
        return `<button class="btn btn--xs ${a.class || 'btn--ghost'}" data-action="${escHtml(a.key)}" title="${escHtml(a.label)}">${escHtml(a.icon || a.label)}</button>`;
      }).join('');
      const actCell = this.actions.length ? `<td class="dt__td dt__td--actions">${actionBtns}</td>` : '';

      const clickable = this.onRowClick ? 'dt__tr--clickable' : '';
      return `<tr class="dt__tr ${clickable}" data-idx="${start + idx}">${cells}${actCell}</tr>`;
    }).join('');

    // Bind events
    tbody.querySelectorAll('.dt__tr--clickable').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const row = this.filteredData[parseInt(tr.dataset.idx)];
        if (row) this.onRowClick(row);
      });
    });

    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actionKey = btn.dataset.action;
        const tr = btn.closest('tr');
        const row = this.filteredData[parseInt(tr.dataset.idx)];
        const action = this.actions.find(a => a.key === actionKey);
        if (action?.handler) action.handler(row);
      });
    });
  }

  _renderPagination() {
    const pg = this.container.querySelector('.dt-pagination');
    if (!pg) return;
    const total = this.filteredData.length;
    const pages = Math.ceil(total / this.pageSize);
    const from = total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    const to   = Math.min(this.currentPage * this.pageSize, total);

    if (pages <= 1) {
      pg.innerHTML = `<span class="dt-pg__info">${total} record${total !== 1 ? 's' : ''}</span>`;
      return;
    }

    const prevDisabled = this.currentPage <= 1 ? 'disabled' : '';
    const nextDisabled = this.currentPage >= pages ? 'disabled' : '';

    pg.innerHTML = `
      <span class="dt-pg__info">${from}–${to} of ${total}</span>
      <div class="dt-pg__buttons">
        <button class="btn btn--ghost btn--sm" data-pg="prev" ${prevDisabled}>‹ Prev</button>
        <span class="dt-pg__num">Page ${this.currentPage} / ${pages}</span>
        <button class="btn btn--ghost btn--sm" data-pg="next" ${nextDisabled}>Next ›</button>
      </div>
    `;

    pg.querySelector('[data-pg="prev"]')?.addEventListener('click', () => { this.currentPage--; this._renderBody(); this._renderPagination(); });
    pg.querySelector('[data-pg="next"]')?.addEventListener('click', () => { this.currentPage++; this._renderBody(); this._renderPagination(); });
  }

  _bindToolbar() {
    const searchInput = this.container.querySelector('.dt-search__input');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.currentPage = 1;
      this._applyFilters();
    });

    this.container.querySelector('.dt-export')?.addEventListener('click', () => this._exportCSV());

    this.container.querySelectorAll('.dt__th--sortable').forEach(th => {
      th.addEventListener('click', () => this._sort(th.dataset.col));
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this._sort(th.dataset.col); });
    });
  }

  _updateSortIcons() {
    this.container.querySelectorAll('.dt__th').forEach(th => {
      const icon = th.querySelector('.dt__sort-icon');
      if (!icon) return;
      if (th.dataset.col === this.sortCol) {
        icon.textContent = this.sortDir === 'asc' ? ' ▲' : ' ▼';
        th.setAttribute('aria-sort', this.sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        icon.textContent = '';
        th.removeAttribute('aria-sort');
      }
    });
  }

  _exportCSV() {
    const headers = this.columns.map(c => `"${c.label}"`).join(',');
    const rows = this.filteredData.map(row =>
      this.columns.map(c => {
        const val = row[c.key] ?? '';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// ─── Loading Skeleton ─────────────────────────────────────────
export function renderTableSkeleton(container, cols = 5, rows = 8) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return;
  const cells = Array(cols).fill('<td><div class="skeleton skeleton--line"></div></td>').join('');
  const trs   = Array(rows).fill(`<tr>${cells}</tr>`).join('');
  el.innerHTML = `
    <div class="dt-scroll-wrap">
      <table class="dt"><thead><tr>${Array(cols).fill('<th><div class="skeleton skeleton--line"></div></th>').join('')}</tr></thead>
      <tbody>${trs}</tbody></table>
    </div>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Badge / Status Renderer Helpers ─────────────────────────
export function statusBadge(status) {
  const map = {
    'Draft':        'badge--gray',
    'In Progress':  'badge--blue',
    'Completed':    'badge--green',
    'Cancelled':    'badge--red',
    'Pending':      'badge--amber',
    'Processed':    'badge--green',
    'Approved':     'badge--green',
    'Rejected':     'badge--red',
    'Delivered':    'badge--green',
    'Returned':     'badge--red',
    'TRUE':         'badge--green',
    'FALSE':        'badge--gray',
    'Active':       'badge--green',
    'Inactive':     'badge--gray',
  };
  const cls = map[status] || 'badge--gray';
  return `<span class="badge ${cls}">${escHtml(status)}</span>`;
}

export function boolBadge(val) {
  const yes = val === true || val === 'TRUE' || val === '1';
  return yes ? '<span class="badge badge--green">Active</span>' : '<span class="badge badge--gray">Inactive</span>';
}
