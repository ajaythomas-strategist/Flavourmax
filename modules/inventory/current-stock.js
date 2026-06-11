// ============================================================
// modules/inventory/current-stock.js — Current Stock Dashboard
// ============================================================
import { readAllRows, sheetsBatchRead, parseSheetRows } from '../../sheets-api.js';
import { SHEETS } from '../../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';

export async function renderCurrentStock(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Current Stock</h1><p class="page-subtitle">Live inventory balance per ingredient</p></div>
      <button class="btn btn--ghost" id="refresh-stock-btn">↻ Refresh</button>
    </div>
    <div class="stock-summary" id="stock-summary"></div>
    <div class="card"><div class="card__body" id="stock-table"></div></div>
  `;

  container.querySelector('#refresh-stock-btn')?.addEventListener('click', loadStock);
  await loadStock();

  async function loadStock() {
    try {
      const batchData = await sheetsBatchRead([`${SHEETS.INVENTORY_BALANCE}!A:F`, `${SHEETS.INGREDIENTS}!A:H`, `${SHEETS.UNITS}!A:E`]);

      // Bail out if user navigated away during the fetch
      if (!document.body.contains(container)) return;

      const balances    = parseSheetRows(SHEETS.INVENTORY_BALANCE, batchData[0].values || []);
      const ingredients = parseSheetRows(SHEETS.INGREDIENTS, batchData[1].values || []);
      const units       = parseSheetRows(SHEETS.UNITS, batchData[2].values || []);

      const ingMap  = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i]));
      const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u]));

      const enriched = balances.map(b => {
        const ing = ingMap[b.ingredient_id];
        const unit = ing ? unitMap[ing.unit_id] : null;
        const balance = parseFloat(b.current_balance || 0);
        const minAlert = parseFloat(ing?.min_stock_alert || 0);
        return {
          ...b,
          ingredient_name: ing?.ingredient_name || b.ingredient_id,
          unit_abbr: unit?.abbreviation || '',
          balance_num: balance,
          min_alert_num: minAlert,
          is_low: balance < minAlert && minAlert > 0,
          category: ing?.category || '',
        };
      }).sort((a,b) => a.ingredient_name.localeCompare(b.ingredient_name));

      const lowCount  = enriched.filter(e => e.is_low).length;
      const totalItems = enriched.length;

      const summaryEl = container.querySelector('#stock-summary');
      if (summaryEl) summaryEl.innerHTML = `
        <div class="stock-kpis">
          <div class="kpi-card kpi--blue"><div class="kpi-card__icon">📦</div><div class="kpi-card__body"><div class="kpi-card__value">${totalItems}</div><div class="kpi-card__label">Total Ingredients</div></div></div>
          <div class="kpi-card ${lowCount > 0 ? 'kpi--red' : 'kpi--green'}"><div class="kpi-card__icon">⚠</div><div class="kpi-card__body"><div class="kpi-card__value">${lowCount}</div><div class="kpi-card__label">Low Stock Alerts</div></div></div>
        </div>
      `;

      const tableEl = container.querySelector('#stock-table');
      if (!tableEl) return;
      new DataTable(tableEl, {
        columns: [
          { key: 'ingredient_name', label: 'Ingredient',    sortable: true },
          { key: 'category',        label: 'Category' },
          { key: 'unit_abbr',       label: 'Unit' },
          { key: 'total_in',        label: 'Total In',  render: (v) => fmtNum(v) },
          { key: 'total_out',       label: 'Total Out', render: (v) => fmtNum(v) },
          { key: 'current_balance', label: 'Balance',   render: (v, row) => {
            const cls = row.is_low ? 'stock-balance--low' : 'stock-balance--ok';
            const icon = row.is_low ? ' ⚠' : '';
            return `<span class="${cls}"><strong>${fmtNum(v)}</strong>${icon}</span>`;
          }},
          { key: 'min_alert_num',   label: 'Min Alert', render: (v) => fmtNum(v) },
          { key: 'last_updated',    label: 'Updated',   render: (v) => v ? new Date(v).toLocaleString('en-IN') : '' },
        ],
        data: enriched,
        emptyMessage: 'No stock data. Start by recording stock receipts.',
      });
    } catch (err) {
      toast.error('Failed to load stock: ' + err.message);
    }
  }
}

function fmtNum(n) { return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 }); }
