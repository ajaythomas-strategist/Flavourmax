// ============================================================
// modules/inventory/stock-in.js — Inventory In (Stock Receipt)
// Row-based multi-entry table UI
// ============================================================
import { readAllRows, sheetsAppend, generateId, updateInventoryBalance, sheetsBatchRead, parseSheetRows, activeOnly } from '../../sheets-api.js';
import { SHEETS } from '../../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';

export async function renderStockIn(container) {
  const canEdit = hasPermission('inventory_edit');

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Stock In</h1><p class="page-subtitle">Record raw material receipts</p></div>
    </div>

    ${canEdit ? `
    <div class="card" style="margin-bottom:1.5rem">
      <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
        <h3 class="card__title" style="margin:0">New Stock Entries</h3>
        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn btn--ghost btn--sm" id="si-add-row">+ Add Row</button>
          <button class="btn btn--primary btn--sm" id="si-save-all">Save All</button>
        </div>
      </div>
      <div class="card__body" style="padding:0;overflow-x:auto">
        <table id="si-entry-table" style="width:100%;border-collapse:collapse;min-width:900px">
          <thead>
            <tr style="background:var(--color-bg-light);border-bottom:2px solid var(--color-border)">
              <th style="${TH}">Date</th>
              <th style="${TH}">Ingredient <span class="req">*</span></th>
              <th style="${TH}">Supplier</th>
              <th style="${TH}">Qty <span class="req">*</span></th>
              <th style="${TH}">Unit</th>
              <th style="${TH}">Rate (₹)</th>
              <th style="${TH}">Total (₹)</th>
              <th style="${TH}">Warehouse</th>
              <th style="${TH}">Invoice No</th>
              <th style="${TH};width:80px"></th>
            </tr>
          </thead>
          <tbody id="si-entry-body"></tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Stock In History</h3>
        <div class="card__header-actions">
          <input type="date" id="si-filter-from" class="input--sm">
          <input type="date" id="si-filter-to" class="input--sm">
          <button class="btn btn--ghost btn--sm" id="si-apply-filter">Filter</button>
        </div>
      </div>
      <div class="card__body" id="si-history-table"></div>
    </div>
  `;

  // ── Load data (single HTTP call) ──────────────────────────
  const batchData = await sheetsBatchRead([
    `${SHEETS.INGREDIENTS}!A:H`,
    `${SHEETS.UNITS}!A:E`,
    `${SHEETS.WAREHOUSES}!A:E`,
    `${SHEETS.INVENTORY_IN}!A:M`,
    `${SHEETS.SUPPLIERS}!A:I`,
  ]);
  const ingredients = activeOnly(parseSheetRows(SHEETS.INGREDIENTS, batchData[0].values || []));
  const units       = activeOnly(parseSheetRows(SHEETS.UNITS,       batchData[1].values || []));
  const warehouses  = activeOnly(parseSheetRows(SHEETS.WAREHOUSES,  batchData[2].values || []));
  let   allStockIn  = parseSheetRows(SHEETS.INVENTORY_IN,           batchData[3].values || []);
  const suppliers   = activeOnly(parseSheetRows(SHEETS.SUPPLIERS,   batchData[4].values || []));

  if (!canEdit) { renderHistory(); return; }

  // ── Option HTML helpers ───────────────────────────────────
  const ingOpts = ingredients.map(i =>
    `<option value="${escHtml(i.ingredient_id)}">${escHtml(i.ingredient_name)}</option>`).join('');
  const unitOpts = units.map(u =>
    `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`).join('');
  const whOpts = warehouses.map(w =>
    `<option value="${escHtml(w.warehouse_id)}">${escHtml(w.warehouse_name)}</option>`).join('');
  const supOpts = suppliers.map(s =>
    `<option value="${escHtml(s.supplier_name)}">${escHtml(s.supplier_name)}</option>`).join('');
  const supMap  = Object.fromEntries(suppliers.map(s => [s.supplier_name, s.supplier_name]));

  const ingMap  = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i.ingredient_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));
  const whMap   = Object.fromEntries(warehouses.map(w => [w.warehouse_id, w.warehouse_name]));

  // ── Add entry row ─────────────────────────────────────────
  function addEntryRow() {
    const tbody = document.getElementById('si-entry-body');
    const tr = document.createElement('tr');
    tr.className = 'si-entry-row';
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="${TD}"><input type="date" class="r-date input--sm" value="${todayStr()}" style="width:120px"></td>
      <td style="${TD}">
        <select class="r-ing input--sm" style="min-width:160px">
          <option value="">-- Select --</option>
          ${ingOpts}
        </select>
      </td>
      <td style="${TD}">
        <select class="r-supplier input--sm" style="min-width:130px">
          <option value="">-- Supplier --</option>
          ${supOpts}
        </select>
      </td>
      <td style="${TD}"><input type="number" class="r-qty input--sm" min="0.01" step="0.01" placeholder="0" style="width:80px"></td>
      <td style="${TD}">
        <select class="r-unit input--sm" style="width:80px">
          <option value="">--</option>
          ${unitOpts}
        </select>
      </td>
      <td style="${TD}"><input type="number" class="r-rate input--sm" min="0" step="0.01" placeholder="0" style="width:80px"></td>
      <td style="${TD}"><input type="number" class="r-total input--sm" readonly placeholder="0.00" style="width:90px;background:var(--color-bg-light)"></td>
      <td style="${TD}">
        <select class="r-wh input--sm" style="min-width:120px">
          <option value="">-- Godown --</option>
          ${whOpts}
        </select>
      </td>
      <td style="${TD}"><input type="text" class="r-invoice input--sm" placeholder="Invoice #" style="width:100px"></td>
      <td style="${TD};text-align:center">
        <button type="button" class="btn btn--sm btn--success r-save-btn" title="Save this row">✓ Save</button>
        <button type="button" class="btn btn--sm btn--ghost r-remove-btn" title="Remove row" style="margin-left:2px">×</button>
      </td>
    `;

    // Auto-fill unit from ingredient
    const ingSelect  = tr.querySelector('.r-ing');
    const unitSelect = tr.querySelector('.r-unit');
    const qtyInput   = tr.querySelector('.r-qty');
    const rateInput  = tr.querySelector('.r-rate');
    const totalInput = tr.querySelector('.r-total');

    ingSelect.addEventListener('change', () => {
      const ing = ingredients.find(i => i.ingredient_id === ingSelect.value);
      if (ing) unitSelect.value = ing.unit_id;
    });

    // Auto-calc total
    const recalc = () => {
      const t = (parseFloat(qtyInput.value) || 0) * (parseFloat(rateInput.value) || 0);
      totalInput.value = t > 0 ? t.toFixed(2) : '';
    };
    qtyInput.addEventListener('input', recalc);
    rateInput.addEventListener('input', recalc);

    // Remove row
    tr.querySelector('.r-remove-btn').addEventListener('click', () => {
      tr.remove();
      ensureAtLeastOneRow();
    });

    // Save single row
    tr.querySelector('.r-save-btn').addEventListener('click', () => saveRow(tr));

    tbody.appendChild(tr);
    return tr;
  }

  function ensureAtLeastOneRow() {
    const tbody = document.getElementById('si-entry-body');
    if (!tbody.querySelector('.si-entry-row')) addEntryRow();
  }

  // ── Save a single row ─────────────────────────────────────
  async function saveRow(tr) {
    const ingId   = tr.querySelector('.r-ing').value;
    const qty     = parseFloat(tr.querySelector('.r-qty').value || 0);
    const unitId  = tr.querySelector('.r-unit').value;
    const date    = tr.querySelector('.r-date').value;
    const supplier= tr.querySelector('.r-supplier').value;
    const rate    = parseFloat(tr.querySelector('.r-rate').value || 0);
    const total   = parseFloat(tr.querySelector('.r-total').value || 0);
    const whId    = tr.querySelector('.r-wh').value;
    const invoice = tr.querySelector('.r-invoice').value.trim();

    if (!ingId)  { toast.warning('Select an ingredient.'); tr.querySelector('.r-ing').focus(); return; }
    if (!qty || qty <= 0) { toast.warning('Enter a valid quantity.'); tr.querySelector('.r-qty').focus(); return; }
    if (!date)   { toast.warning('Enter a date.'); return; }

    const saveBtn = tr.querySelector('.r-save-btn');
    saveBtn.disabled = true; saveBtn.textContent = '…';

    try {
      const id  = await generateId(SHEETS.INVENTORY_IN);
      const now = new Date().toISOString();
      await sheetsAppend(SHEETS.INVENTORY_IN, [[
        id, date, ingId, supplier, qty, unitId,
        rate || '', total || '', whId, invoice, '',
        getCurrentUser()?.user_id, now
      ]]);
      await updateInventoryBalance(ingId, qty, 0);

      // Mark row as saved — lock it with a green tint
      lockRow(tr, id, ingId, qty, unitId, date, rate, total, whId, supplier);

      // Update history cache
      allStockIn.push({ in_id: id, in_date: date, ingredient_id: ingId, supplier, quantity: qty, unit_id: unitId, rate, total_cost: total, warehouse_id: whId, invoice_no: invoice, created_by: getCurrentUser()?.user_id });
      renderHistory();

      // Add next empty row if no pending rows left
      const tbody = document.getElementById('si-entry-body');
      const hasPending = tbody.querySelectorAll('.si-entry-row').length > 0;
      if (!hasPending) addEntryRow();

      toast.success(`Saved — ${escHtml(ingMap[ingId] || ingId)} (${id})`);
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = '✓ Save';
      toast.error(err.message);
    }
  }

  function lockRow(tr, id, ingId, qty, unitId, date, rate, total, whId, supplier) {
    tr.classList.remove('si-entry-row');
    tr.style.background = 'color-mix(in srgb, var(--color-success) 8%, transparent)';
    tr.style.color = 'var(--color-text-muted)';
    tr.innerHTML = `
      <td style="${TD}">${escHtml(date)}</td>
      <td style="${TD}"><strong>${escHtml(ingMap[ingId] || ingId)}</strong></td>
      <td style="${TD}">${escHtml(supplier || '—')}</td>
      <td style="${TD}">${qty}</td>
      <td style="${TD}">${escHtml(unitMap[unitId] || unitId)}</td>
      <td style="${TD}">₹${rate || 0}</td>
      <td style="${TD}">₹${parseFloat(total || 0).toLocaleString('en-IN')}</td>
      <td style="${TD}">${escHtml(whId || '—')}</td>
      <td style="${TD}">—</td>
      <td style="${TD};text-align:center"><span style="color:var(--color-success);font-weight:600">✓ Saved</span><br><small style="font-size:0.7rem">${escHtml(id)}</small></td>
    `;
  }

  // ── Save All button ───────────────────────────────────────
  document.getElementById('si-save-all')?.addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('#si-entry-body .si-entry-row')];
    if (rows.length === 0) { toast.warning('No rows to save.'); return; }
    for (const tr of rows) await saveRow(tr);
  });

  // ── Add Row button ────────────────────────────────────────
  document.getElementById('si-add-row')?.addEventListener('click', addEntryRow);

  // ── History ───────────────────────────────────────────────
  document.getElementById('si-apply-filter')?.addEventListener('click', renderHistory);

  function renderHistory() {
    const from = document.getElementById('si-filter-from')?.value || '';
    const to   = document.getElementById('si-filter-to')?.value   || '';
    let rows = [...allStockIn];
    if (from) rows = rows.filter(r => r.in_date >= from);
    if (to)   rows = rows.filter(r => r.in_date <= to);
    rows.reverse();

    new DataTable(document.getElementById('si-history-table'), {
      columns: [
        { key: 'in_id',         label: 'ID' },
        { key: 'in_date',       label: 'Date', sortable: true },
        { key: 'ingredient_id', label: 'Ingredient', render: (v) => escHtml(ingMap[v] || v) },
        { key: 'supplier',      label: 'Supplier', render: (v) => escHtml(v || '—') },
        { key: 'quantity',      label: 'Qty', render: (v, r) => `${v} ${escHtml(unitMap[r.unit_id] || '')}` },
        { key: 'rate',          label: 'Rate (₹)' },
        { key: 'total_cost',    label: 'Total (₹)', render: (v) => `₹${parseFloat(v || 0).toLocaleString('en-IN')}` },
        { key: 'invoice_no',    label: 'Invoice No' },
        { key: 'warehouse_id',  label: 'Warehouse', render: (v) => escHtml(whMap[v] || v) },
      ],
      data: rows,
      emptyMessage: 'No stock receipts recorded yet.',
    });
  }

  // ── Init: start with one empty row ────────────────────────
  addEntryRow();
  renderHistory();
}

// ── Style constants ───────────────────────────────────────
const TH = 'padding:0.5rem 0.6rem;text-align:left;font-size:0.8rem;font-weight:600;white-space:nowrap';
const TD = 'padding:0.35rem 0.4rem;vertical-align:middle';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
