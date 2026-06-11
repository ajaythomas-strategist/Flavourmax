// ============================================================
// modules/inventory/stock-out.js — Stock Out / Adjustments
// Row-based multi-entry table UI
// ============================================================
import { readAllRows, sheetsAppend, generateId, updateInventoryBalance, sheetsBatchRead, parseSheetRows, activeOnly } from '../../sheets-api.js';
import { SHEETS } from '../../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';

const REASONS = ['Production Consumption', 'Wastage', 'Damaged', 'Quality Rejection', 'Other'];

export async function renderStockOut(container) {
  const canEdit = hasPermission('inventory_edit');

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Stock Out</h1><p class="page-subtitle">Manual stock adjustments and consumption records</p></div>
    </div>

    ${canEdit ? `
    <div class="card" style="margin-bottom:1.5rem">
      <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
        <h3 class="card__title" style="margin:0">New Stock Out Entries</h3>
        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn btn--ghost btn--sm" id="so-add-row">+ Add Row</button>
          <button class="btn btn--primary btn--sm" id="so-save-all">Save All</button>
        </div>
      </div>
      <div class="card__body" style="padding:0;overflow-x:auto">
        <table id="so-entry-table" style="width:100%;border-collapse:collapse;min-width:750px">
          <thead>
            <tr style="background:var(--color-bg-light);border-bottom:2px solid var(--color-border)">
              <th style="${TH}">Date</th>
              <th style="${TH}">Ingredient <span class="req">*</span></th>
              <th style="${TH}">Qty <span class="req">*</span></th>
              <th style="${TH}">Unit</th>
              <th style="${TH}">Reason <span class="req">*</span></th>
              <th style="${TH}">Linked Batch</th>
              <th style="${TH};width:80px"></th>
            </tr>
          </thead>
          <tbody id="so-entry-body"></tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card__header"><h3 class="card__title">Stock Out History</h3></div>
      <div class="card__body" id="so-history-table"></div>
    </div>
  `;

  // ── Load data (single HTTP call) ──────────────────────────
  const batchData = await sheetsBatchRead([
    `${SHEETS.INGREDIENTS}!A:H`,
    `${SHEETS.UNITS}!A:E`,
    `${SHEETS.PRODUCTION_BATCHES}!A:L`,
    `${SHEETS.INVENTORY_OUT}!A:I`,
  ]);
  const ingredients = activeOnly(parseSheetRows(SHEETS.INGREDIENTS, batchData[0].values || []));
  const units       = activeOnly(parseSheetRows(SHEETS.UNITS,       batchData[1].values || []));
  const batches     = parseSheetRows(SHEETS.PRODUCTION_BATCHES,     batchData[2].values || [])
    .filter(b => b.status !== 'Cancelled');
  let allStockOut   = parseSheetRows(SHEETS.INVENTORY_OUT,          batchData[3].values || []);

  if (!canEdit) { renderHistory(); return; }

  const ingMap  = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i.ingredient_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));

  // ── Option HTML helpers ───────────────────────────────────
  const ingOpts = ingredients.map(i =>
    `<option value="${escHtml(i.ingredient_id)}">${escHtml(i.ingredient_name)}</option>`).join('');
  const unitOpts = units.map(u =>
    `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`).join('');
  const reasonOpts = REASONS.map(r =>
    `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
  const batchOpts = batches.map(b =>
    `<option value="${escHtml(b.batch_id)}">${escHtml(b.batch_id)}</option>`).join('');

  // ── Add entry row ─────────────────────────────────────────
  function addEntryRow() {
    const tbody = document.getElementById('so-entry-body');
    const tr = document.createElement('tr');
    tr.className = 'so-entry-row';
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="${TD}"><input type="date" class="r-date input--sm" value="${todayStr()}" style="width:120px"></td>
      <td style="${TD}">
        <select class="r-ing input--sm" style="min-width:160px">
          <option value="">-- Select --</option>
          ${ingOpts}
        </select>
      </td>
      <td style="${TD}"><input type="number" class="r-qty input--sm" min="0.01" step="0.01" placeholder="0" style="width:80px"></td>
      <td style="${TD}">
        <select class="r-unit input--sm" style="width:80px">
          <option value="">--</option>
          ${unitOpts}
        </select>
      </td>
      <td style="${TD}">
        <select class="r-reason input--sm" style="min-width:160px">
          <option value="">-- Reason --</option>
          ${reasonOpts}
        </select>
      </td>
      <td style="${TD}">
        <select class="r-batch input--sm" style="min-width:120px">
          <option value="">-- None --</option>
          ${batchOpts}
        </select>
      </td>
      <td style="${TD};text-align:center">
        <button type="button" class="btn btn--sm btn--success r-save-btn" title="Save this row">✓ Save</button>
        <button type="button" class="btn btn--sm btn--ghost r-remove-btn" title="Remove row" style="margin-left:2px">×</button>
      </td>
    `;

    // Auto-fill unit from ingredient
    const ingSelect  = tr.querySelector('.r-ing');
    const unitSelect = tr.querySelector('.r-unit');
    ingSelect.addEventListener('change', () => {
      const ing = ingredients.find(i => i.ingredient_id === ingSelect.value);
      if (ing) unitSelect.value = ing.unit_id;
    });

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
    const tbody = document.getElementById('so-entry-body');
    if (!tbody.querySelector('.so-entry-row')) addEntryRow();
  }

  // ── Save a single row ─────────────────────────────────────
  async function saveRow(tr) {
    const ingId   = tr.querySelector('.r-ing').value;
    const qty     = parseFloat(tr.querySelector('.r-qty').value || 0);
    const unitId  = tr.querySelector('.r-unit').value;
    const date    = tr.querySelector('.r-date').value;
    const reason  = tr.querySelector('.r-reason').value;
    const batchId = tr.querySelector('.r-batch').value;

    if (!ingId)           { toast.warning('Select an ingredient.'); tr.querySelector('.r-ing').focus(); return; }
    if (!qty || qty <= 0) { toast.warning('Enter a valid quantity.'); tr.querySelector('.r-qty').focus(); return; }
    if (!reason)          { toast.warning('Select a reason.'); tr.querySelector('.r-reason').focus(); return; }
    if (!date)            { toast.warning('Enter a date.'); return; }

    const saveBtn = tr.querySelector('.r-save-btn');
    saveBtn.disabled = true; saveBtn.textContent = '…';

    try {
      const id  = await generateId(SHEETS.INVENTORY_OUT);
      const now = new Date().toISOString();
      await sheetsAppend(SHEETS.INVENTORY_OUT, [[
        id, date, ingId, batchId || '', qty, unitId, reason,
        getCurrentUser()?.user_id, now
      ]]);
      await updateInventoryBalance(ingId, 0, qty);

      // Mark row as saved
      lockRow(tr, id, ingId, qty, unitId, date, reason, batchId);

      // Update local cache
      allStockOut.push({ out_id: id, out_date: date, ingredient_id: ingId, batch_id: batchId, quantity: qty, unit_id: unitId, reason });
      renderHistory();

      const tbody = document.getElementById('so-entry-body');
      const hasPending = tbody.querySelectorAll('.so-entry-row').length > 0;
      if (!hasPending) addEntryRow();

      toast.success(`Saved — ${escHtml(ingMap[ingId] || ingId)} (${id})`);
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = '✓ Save';
      toast.error(err.message);
    }
  }

  function lockRow(tr, id, ingId, qty, unitId, date, reason, batchId) {
    tr.classList.remove('so-entry-row');
    tr.style.background = 'color-mix(in srgb, var(--color-success) 8%, transparent)';
    tr.style.color = 'var(--color-text-muted)';
    tr.innerHTML = `
      <td style="${TD}">${escHtml(date)}</td>
      <td style="${TD}"><strong>${escHtml(ingMap[ingId] || ingId)}</strong></td>
      <td style="${TD}">${qty}</td>
      <td style="${TD}">${escHtml(unitMap[unitId] || unitId)}</td>
      <td style="${TD}">${escHtml(reason)}</td>
      <td style="${TD}">${escHtml(batchId || '—')}</td>
      <td style="${TD};text-align:center"><span style="color:var(--color-success);font-weight:600">✓ Saved</span><br><small style="font-size:0.7rem">${escHtml(id)}</small></td>
    `;
  }

  // ── Save All button ───────────────────────────────────────
  document.getElementById('so-save-all')?.addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('#so-entry-body .so-entry-row')];
    if (rows.length === 0) { toast.warning('No rows to save.'); return; }
    for (const tr of rows) await saveRow(tr);
  });

  // ── Add Row button ────────────────────────────────────────
  document.getElementById('so-add-row')?.addEventListener('click', addEntryRow);

  // ── History ───────────────────────────────────────────────
  function renderHistory() {
    const rows = [...allStockOut].reverse();
    new DataTable(document.getElementById('so-history-table'), {
      columns: [
        { key: 'out_id',        label: 'ID' },
        { key: 'out_date',      label: 'Date', sortable: true },
        { key: 'ingredient_id', label: 'Ingredient', render: (v) => escHtml(ingMap[v] || v) },
        { key: 'quantity',      label: 'Qty', render: (v, r) => `${v} ${escHtml(unitMap[r.unit_id] || '')}` },
        { key: 'reason',        label: 'Reason' },
        { key: 'batch_id',      label: 'Batch' },
      ],
      data: rows,
      emptyMessage: 'No stock-out records yet.',
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
