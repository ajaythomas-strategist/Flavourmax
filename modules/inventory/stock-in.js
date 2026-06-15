// ============================================================
// modules/inventory/stock-in.js — Inventory In (Stock Receipt)
// Desktop: horizontal table  |  Mobile: vertical card form
// ============================================================
import { sheetsAppend, generateId, updateInventoryBalance, sheetsBatchRead, parseSheetRows, activeOnly } from '../supabase-api.js';
import { SHEETS } from '../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../auth.js';

const isMobile = () => window.innerWidth <= 768;

export async function renderStockIn(container) {
  const canEdit = hasPermission('inventory_edit');

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Stock In</h1><p class="page-subtitle">Record raw material receipts</p></div>
    </div>

    ${canEdit ? `<div id="si-entry-section"></div>` : ''}

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

  // ── Load data ─────────────────────────────────────────────
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

  const ingMap  = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i.ingredient_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation || u.unit_name]));
  const whMap   = Object.fromEntries(warehouses.map(w => [w.warehouse_id, w.warehouse_name]));

  const ingOpts = ingredients.map(i =>
    `<option value="${escHtml(i.ingredient_id)}">${escHtml(i.ingredient_name)}</option>`).join('');
  const unitOpts = units.map(u =>
    `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`).join('');
  const whOpts = warehouses.map(w =>
    `<option value="${escHtml(w.warehouse_id)}">${escHtml(w.warehouse_name)}</option>`).join('');
  const supOpts = suppliers.map(s =>
    `<option value="${escHtml(s.supplier_name)}">${escHtml(s.supplier_name)}</option>`).join('');

  if (!document.body.contains(container)) return; // navigated away during fetch

  if (!canEdit) { renderHistory(); return; }

  // ── Shared save logic ─────────────────────────────────────
  async function saveEntry({ ingId, qty, unitId, date, supplier, rate, total, whId, invoice }) {
    const id  = await generateId(SHEETS.INVENTORY_IN);
    const now = new Date().toISOString();
    await sheetsAppend(SHEETS.INVENTORY_IN, [[
      id, date, ingId, supplier, qty, unitId,
      rate || '', total || '', whId, invoice || '',
      '', getCurrentUser()?.user_id, now
    ]]);
    await updateInventoryBalance(ingId, qty, 0);
    allStockIn.push({ in_id: id, in_date: date, ingredient_id: ingId, supplier,
      quantity: qty, unit_id: unitId, rate, total_cost: total, warehouse_id: whId,
      invoice_no: invoice || '', created_by: getCurrentUser()?.user_id });
    renderHistory();
    return id;
  }

  // ── Render: choose layout based on device ─────────────────
  if (isMobile()) {
    renderMobileEntry();
  } else {
    renderDesktopEntry();
  }

  // ─────────────────────────────────────────────────────────
  // MOBILE: Vertical card form
  // ─────────────────────────────────────────────────────────
  function renderMobileEntry() {
    const section = container.querySelector('#si-entry-section');
    section.innerHTML = `
      <div class="m-entry-form" style="margin-bottom:1.25rem">
        <div class="m-entry-form__title">📥 New Stock Entry</div>

        <div class="form-group">
          <label>Date <span class="req">*</span></label>
          <input type="date" id="m-date" value="${todayStr()}">
        </div>

        <div class="form-group">
          <label>Ingredient <span class="req">*</span></label>
          <select id="m-ing">
            <option value="">Select ingredient…</option>
            ${ingOpts}
          </select>
        </div>

        <div class="form-group">
          <label>Supplier</label>
          <select id="m-supplier">
            <option value="">Select supplier…</option>
            ${supOpts}
          </select>
        </div>

        <div class="form-row-2col">
          <div class="form-group">
            <label>Quantity <span class="req">*</span></label>
            <input type="number" id="m-qty" min="0.01" step="0.01" placeholder="0" inputmode="decimal">
          </div>
          <div class="form-group">
            <label>Unit</label>
            <select id="m-unit">
              <option value="">—</option>
              ${unitOpts}
            </select>
          </div>
        </div>

        <div class="form-row-2col">
          <div class="form-group">
            <label>Rate (₹)</label>
            <input type="number" id="m-rate" min="0" step="0.01" placeholder="0" inputmode="decimal">
          </div>
          <div class="form-group">
            <label>Total (₹)</label>
            <input type="number" id="m-total" readonly placeholder="0.00" tabindex="-1">
          </div>
        </div>

        <div class="form-group">
          <label>Warehouse / Godown</label>
          <select id="m-wh">
            <option value="">Select godown…</option>
            ${whOpts}
          </select>
        </div>

        <div class="form-group">
          <label>Invoice No</label>
          <input type="text" id="m-invoice" placeholder="e.g. INV-001" autocapitalize="characters">
        </div>

        <button class="btn btn--primary" id="m-save-btn" style="width:100%;min-height:52px;font-size:1rem">
          ✓ Save Entry
        </button>
      </div>

      <div id="m-saved-section" style="display:none;margin-bottom:1.25rem">
        <div class="m-saved-list__header">
          <span class="m-saved-list__title">✅ Saved Entries (<span id="m-saved-count">0</span>)</span>
        </div>
        <div class="m-saved-list" id="m-saved-list"></div>
      </div>
    `;

    const ingEl  = section.querySelector('#m-ing');
    const unitEl = section.querySelector('#m-unit');
    const qtyEl  = section.querySelector('#m-qty');
    const rateEl = section.querySelector('#m-rate');
    const totEl  = section.querySelector('#m-total');

    // Auto-fill unit from ingredient
    ingEl.addEventListener('change', () => {
      const ing = ingredients.find(i => i.ingredient_id === ingEl.value);
      if (ing?.unit_id) unitEl.value = ing.unit_id;
    });

    // Auto-calc total
    const recalc = () => {
      const t = (parseFloat(qtyEl.value) || 0) * (parseFloat(rateEl.value) || 0);
      totEl.value = t > 0 ? t.toFixed(2) : '';
    };
    qtyEl.addEventListener('input', recalc);
    rateEl.addEventListener('input', recalc);

    // Save button
    section.querySelector('#m-save-btn').addEventListener('click', async () => {
      const ingId   = ingEl.value;
      const qty     = parseFloat(qtyEl.value || 0);
      const unitId  = unitEl.value;
      const date    = section.querySelector('#m-date').value;
      const supplier= section.querySelector('#m-supplier').value;
      const rate    = parseFloat(rateEl.value || 0);
      const total   = parseFloat(totEl.value || 0);
      const whId    = section.querySelector('#m-wh').value;
      const invoice = section.querySelector('#m-invoice').value.trim();

      if (!ingId)       { toast.warning('Select an ingredient.'); ingEl.focus(); return; }
      if (!qty || qty <= 0) { toast.warning('Enter a valid quantity.'); qtyEl.focus(); return; }
      if (!date)        { toast.warning('Select a date.'); return; }

      const btn = section.querySelector('#m-save-btn');
      btn.disabled = true; btn.textContent = 'Saving…';

      try {
        const id = await saveEntry({ ingId, qty, unitId, date, supplier, rate, total, whId, invoice });

        if (!document.body.contains(container)) return; // navigated away during save
        // Show saved card
        const savedSection = section.querySelector('#m-saved-section');
        const savedList    = section.querySelector('#m-saved-list');
        const countEl      = section.querySelector('#m-saved-count');
        if (savedSection) savedSection.style.display = '';
        if (countEl) countEl.textContent = parseInt(countEl.textContent || 0) + 1;

        const card = document.createElement('div');
        card.className = 'm-entry-card';
        card.innerHTML = `
          <span class="m-entry-card__icon">✅</span>
          <div class="m-entry-card__main">
            <div class="m-entry-card__name">${escHtml(ingMap[ingId] || ingId)}</div>
            <div class="m-entry-card__detail">
              ${qty} ${escHtml(unitMap[unitId] || '')}
              ${rate ? ` · ₹${rate}/unit · Total ₹${parseFloat(total).toLocaleString('en-IN')}` : ''}
              ${supplier ? ` · ${escHtml(supplier)}` : ''}
              · ${escHtml(date)}
            </div>
            <div class="m-entry-card__id">${escHtml(id)}</div>
          </div>
        `;
        if (savedList) savedList.insertBefore(card, savedList.firstChild);

        // Reset form for next entry
        qtyEl.value = ''; rateEl.value = ''; totEl.value = '';
        const invoiceEl = section.querySelector('#m-invoice');
        const whEl = section.querySelector('#m-wh');
        if (invoiceEl) invoiceEl.value = '';
        ingEl.value = ''; unitEl.value = '';
        if (whEl) whEl.value = '';
        ingEl.focus();

        toast.success(`Saved — ${ingMap[ingId] || ingId}`);
      } catch (err) {
        toast.error(err.message);
      } finally {
        btn.disabled = false; btn.textContent = '✓ Save Entry';
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // DESKTOP: Horizontal table entry (unchanged)
  // ─────────────────────────────────────────────────────────
  function renderDesktopEntry() {
    const section = container.querySelector('#si-entry-section');
    section.innerHTML = `
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
              <tr style="background:var(--color-surface);border-bottom:2px solid var(--color-border)">
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
      </div>
    `;

    section.querySelector('#si-add-row')?.addEventListener('click', addDesktopRow);
    section.querySelector('#si-save-all')?.addEventListener('click', async () => {
      const rows = [...section.querySelectorAll('#si-entry-body .si-entry-row')];
      if (!rows.length) { toast.warning('No rows to save.'); return; }
      for (const tr of rows) await saveDesktopRow(tr);
    });
    addDesktopRow();
  }

  function addDesktopRow() {
    const tbody = container.querySelector('#si-entry-body');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'si-entry-row';
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="${TD}"><input type="date" class="r-date input--sm" value="${todayStr()}" style="width:120px"></td>
      <td style="${TD}"><select class="r-ing input--sm" style="min-width:160px"><option value="">-- Select --</option>${ingOpts}</select></td>
      <td style="${TD}"><select class="r-supplier input--sm" style="min-width:130px"><option value="">-- Supplier --</option>${supOpts}</select></td>
      <td style="${TD}"><input type="number" class="r-qty input--sm" min="0.01" step="0.01" placeholder="0" style="width:80px"></td>
      <td style="${TD}"><select class="r-unit input--sm" style="width:80px"><option value="">--</option>${unitOpts}</select></td>
      <td style="${TD}"><input type="number" class="r-rate input--sm" min="0" step="0.01" placeholder="0" style="width:80px"></td>
      <td style="${TD}"><input type="number" class="r-total input--sm" readonly placeholder="0.00" style="width:90px;background:var(--color-surface)"></td>
      <td style="${TD}"><select class="r-wh input--sm" style="min-width:120px"><option value="">-- Godown --</option>${whOpts}</select></td>
      <td style="${TD}"><input type="text" class="r-invoice input--sm" placeholder="Invoice #" style="width:100px"></td>
      <td style="${TD};text-align:center">
        <button type="button" class="btn btn--sm btn--success r-save-btn">✓ Save</button>
        <button type="button" class="btn btn--sm btn--ghost r-remove-btn" style="margin-left:2px">×</button>
      </td>
    `;

    const ingS = tr.querySelector('.r-ing'), unitS = tr.querySelector('.r-unit');
    const qtyI = tr.querySelector('.r-qty'), rateI = tr.querySelector('.r-rate');
    const totI = tr.querySelector('.r-total');

    ingS.addEventListener('change', () => {
      const ing = ingredients.find(i => i.ingredient_id === ingS.value);
      if (ing?.unit_id) unitS.value = ing.unit_id;
    });
    const recalc = () => {
      const t = (parseFloat(qtyI.value) || 0) * (parseFloat(rateI.value) || 0);
      totI.value = t > 0 ? t.toFixed(2) : '';
    };
    qtyI.addEventListener('input', recalc);
    rateI.addEventListener('input', recalc);
    tr.querySelector('.r-remove-btn').addEventListener('click', () => {
      tr.remove();
      if (!container.querySelector('#si-entry-body .si-entry-row')) addDesktopRow();
    });
    tr.querySelector('.r-save-btn').addEventListener('click', () => saveDesktopRow(tr));
    tbody.appendChild(tr);
  }

  async function saveDesktopRow(tr) {
    const ingId  = tr.querySelector('.r-ing').value;
    const qty    = parseFloat(tr.querySelector('.r-qty').value || 0);
    const unitId = tr.querySelector('.r-unit').value;
    const date   = tr.querySelector('.r-date').value;
    const supplier = tr.querySelector('.r-supplier').value;
    const rate   = parseFloat(tr.querySelector('.r-rate').value || 0);
    const total  = parseFloat(tr.querySelector('.r-total').value || 0);
    const whId   = tr.querySelector('.r-wh').value;
    const invoice= tr.querySelector('.r-invoice').value.trim();

    if (!ingId)       { toast.warning('Select an ingredient.'); return; }
    if (!qty || qty <= 0) { toast.warning('Enter a valid quantity.'); return; }
    if (!date)        { toast.warning('Enter a date.'); return; }

    const btn = tr.querySelector('.r-save-btn');
    btn.disabled = true; btn.textContent = '…';

    try {
      const id = await saveEntry({ ingId, qty, unitId, date, supplier, rate, total, whId, invoice });
      tr.classList.remove('si-entry-row');
      tr.style.background = 'color-mix(in srgb, var(--color-success) 8%, transparent)';
      tr.innerHTML = `
        <td style="${TD}">${escHtml(date)}</td>
        <td style="${TD}"><strong>${escHtml(ingMap[ingId] || ingId)}</strong></td>
        <td style="${TD}">${escHtml(supplier || '—')}</td>
        <td style="${TD}">${qty}</td>
        <td style="${TD}">${escHtml(unitMap[unitId] || unitId)}</td>
        <td style="${TD}">₹${rate || 0}</td>
        <td style="${TD}">₹${parseFloat(total || 0).toLocaleString('en-IN')}</td>
        <td style="${TD}">${escHtml(whMap[whId] || whId || '—')}</td>
        <td style="${TD}">${escHtml(invoice || '—')}</td>
        <td style="${TD};text-align:center"><span style="color:var(--color-success);font-weight:600">✓ Saved</span><br><small>${escHtml(id)}</small></td>
      `;
      if (!container.querySelector('#si-entry-body .si-entry-row')) addDesktopRow();
      toast.success(`Saved — ${ingMap[ingId] || ingId} (${id})`);
    } catch (err) {
      btn.disabled = false; btn.textContent = '✓ Save';
      toast.error(err.message);
    }
  }

  // ── History ───────────────────────────────────────────────
  container.querySelector('#si-apply-filter')?.addEventListener('click', renderHistory);

  function renderHistory() {
    const from = container.querySelector('#si-filter-from')?.value || '';
    const to   = container.querySelector('#si-filter-to')?.value   || '';
    let rows = [...allStockIn];
    if (from) rows = rows.filter(r => r.in_date >= from);
    if (to)   rows = rows.filter(r => r.in_date <= to);
    rows.reverse();

    const histTableEl = container.querySelector('#si-history-table');
    if (!histTableEl) return;
    new DataTable(histTableEl, {
      columns: [
        { key: 'in_id',         label: 'ID' },
        { key: 'in_date',       label: 'Date', sortable: true },
        { key: 'ingredient_id', label: 'Ingredient', render: v => escHtml(ingMap[v] || v) },
        { key: 'supplier',      label: 'Supplier',   render: v => escHtml(v || '—') },
        { key: 'quantity',      label: 'Qty',        render: (v, r) => `${v} ${escHtml(unitMap[r.unit_id] || '')}` },
        { key: 'rate',          label: 'Rate (₹)' },
        { key: 'total_cost',    label: 'Total (₹)', render: v => `₹${parseFloat(v || 0).toLocaleString('en-IN')}` },
        { key: 'invoice_no',    label: 'Invoice No' },
        { key: 'warehouse_id',  label: 'Warehouse',  render: v => escHtml(whMap[v] || v) },
      ],
      data: rows,
      emptyMessage: 'No stock receipts recorded yet.',
    });
  }

  renderHistory();
}

const TH = 'padding:0.5rem 0.6rem;text-align:left;font-size:0.8rem;font-weight:600;white-space:nowrap';
const TD = 'padding:0.35rem 0.4rem;vertical-align:middle';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
