// ============================================================
// modules/inventory/stock-out.js — Stock Out / Adjustments
// Desktop: horizontal table  |  Mobile: vertical card form
// ============================================================
import { sheetsAppend, generateId, updateInventoryBalance, sheetsBatchRead, parseSheetRows, activeOnly } from '../../supabase-api.js';
import { SHEETS } from '../../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';

const REASONS = ['Production Consumption', 'Wastage', 'Damaged', 'Quality Rejection', 'Other'];
const isMobile = () => window.innerWidth <= 768;

export async function renderStockOut(container) {
  const canEdit = hasPermission('inventory_edit');

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Stock Out</h1><p class="page-subtitle">Manual stock adjustments and consumption records</p></div>
    </div>

    ${canEdit ? `<div id="so-entry-section"></div>` : ''}

    <div class="card">
      <div class="card__header"><h3 class="card__title">Stock Out History</h3></div>
      <div class="card__body" id="so-history-table"></div>
    </div>
  `;

  // ── Load data ─────────────────────────────────────────────
  const batchData = await sheetsBatchRead([
    `${SHEETS.INGREDIENTS}!A:H`,
    `${SHEETS.UNITS}!A:E`,
    `${SHEETS.PRODUCTION_BATCHES}!A:L`,
    `${SHEETS.INVENTORY_OUT}!A:K`,
    `${SHEETS.WAREHOUSES}!A:E`,
    `${SHEETS.INVENTORY_IN}!A:N`,
  ]);

  if (!document.body.contains(container)) return; // navigated away during fetch

  const ingredients = activeOnly(parseSheetRows(SHEETS.INGREDIENTS,       batchData[0].values || []));
  const units       = activeOnly(parseSheetRows(SHEETS.UNITS,             batchData[1].values || []));
  const batches     = parseSheetRows(SHEETS.PRODUCTION_BATCHES,           batchData[2].values || [])
    .filter(b => b.status !== 'Cancelled');
  let allStockOut   = parseSheetRows(SHEETS.INVENTORY_OUT,                batchData[3].values || []);
  const warehouses  = activeOnly(parseSheetRows(SHEETS.WAREHOUSES,        batchData[4].values || []));
  const allStockIn  = parseSheetRows(SHEETS.INVENTORY_IN,                 batchData[5].values || []);

  const ingMap  = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i.ingredient_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation || u.unit_name]));
  const whMap   = Object.fromEntries(warehouses.map(w => [w.warehouse_id, w.warehouse_name]));

  const ingOpts    = ingredients.map(i => `<option value="${escHtml(i.ingredient_id)}">${escHtml(i.ingredient_name)}</option>`).join('');
  const unitOpts   = units.map(u => `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`).join('');
  const reasonOpts = REASONS.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
  const batchOpts  = batches.map(b => `<option value="${escHtml(b.batch_id)}">${escHtml(b.batch_id)}</option>`).join('');

  if (!canEdit) { renderHistory(); return; }

  // ── Compute available lots logic ──────────────────────────
  function getAvailableLotsForIng(ingId) {
    const stock = {};
    // Stock In
    allStockIn.filter(item => item.ingredient_id === ingId).forEach(item => {
      const lot = item.lot_no || 'No-Lot';
      const whId = item.warehouse_id || 'No-Wh';
      const key = `${lot}||${whId}`;
      if (!stock[key]) {
        stock[key] = {
          lot_no: item.lot_no || '',
          warehouse_id: item.warehouse_id || '',
          total_in: 0,
          total_out: 0
        };
      }
      stock[key].total_in += parseFloat(item.quantity || 0);
    });

    // Stock Out
    allStockOut.filter(item => item.ingredient_id === ingId).forEach(item => {
      const lot = item.lot_no || 'No-Lot';
      const whId = item.warehouse_id || 'No-Wh';
      const key = `${lot}||${whId}`;
      if (stock[key]) {
        stock[key].total_out += parseFloat(item.quantity || 0);
      }
    });

    const list = [];
    for (const key in stock) {
      const bal = stock[key].total_in - stock[key].total_out;
      if (bal > 0) {
        list.push({
          lot_no: stock[key].lot_no,
          warehouse_id: stock[key].warehouse_id,
          balance: bal
        });
      }
    }
    return list;
  }

  // ── Shared save logic ─────────────────────────────────────
  async function saveEntry({ ingId, qty, unitId, date, reason, batchId, whId, lotNo }) {
    const id  = await generateId(SHEETS.INVENTORY_OUT);
    const now = new Date().toISOString();
    await sheetsAppend(SHEETS.INVENTORY_OUT, [[
      id, date, ingId, batchId || '', qty, unitId, reason,
      getCurrentUser()?.user_id, now, lotNo || '', whId || ''
    ]]);
    await updateInventoryBalance(ingId, 0, qty);
    allStockOut.push({ out_id: id, out_date: date, ingredient_id: ingId, batch_id: batchId,
      quantity: qty, unit_id: unitId, reason, lot_no: lotNo || '', warehouse_id: whId || '' });
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
    const section = container.querySelector('#so-entry-section');
    if (!section) return;
    section.innerHTML = `
      <div class="m-entry-form" style="margin-bottom:1.25rem">
        <div class="m-entry-form__title">📤 New Stock Out Entry</div>

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
          <label>Lot No</label>
          <select id="m-lot"><option value="">-- No Lot --</option></select>
        </div>

        <div class="form-group">
          <label>Warehouse / Godown</label>
          <select id="m-wh">
            <option value="">-- Select Godown --</option>
            ${warehouses.map(w => `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`).join('')}
          </select>
          <p id="m-lot-bal-msg" style="font-size:0.75rem;margin-top:0.25rem;color:var(--color-primary);display:none"></p>
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

        <div class="form-group">
          <label>Reason <span class="req">*</span></label>
          <select id="m-reason">
            <option value="">Select reason…</option>
            ${reasonOpts}
          </select>
        </div>

        <div class="form-group">
          <label>Linked Batch (optional)</label>
          <select id="m-batch">
            <option value="">None</option>
            ${batchOpts}
          </select>
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
    const lotSelect = section.querySelector('#m-lot');
    const whSelect = section.querySelector('#m-wh');
    const balMsg = section.querySelector('#m-lot-bal-msg');
 
    // Auto-fill unit from ingredient & load available lots
    ingEl.addEventListener('change', () => {
      const ingId = ingEl.value;
      const ing = ingredients.find(i => i.ingredient_id === ingId);
      if (ing?.unit_id) unitEl.value = ing.unit_id;

      if (!ingId) {
        lotSelect.innerHTML = '<option value="">-- No Lot / Custom --</option>';
        whSelect.value = '';
        if (balMsg) balMsg.style.display = 'none';
        return;
      }

      const lots = getAvailableLotsForIng(ingId);
      lotSelect.innerHTML = '<option value="">-- No Lot / Custom --</option>' +
        lots.map(l => `<option value="${escHtml(l.lot_no)}" data-wh="${escHtml(l.warehouse_id)}" data-bal="${l.balance}">
          Lot: ${escHtml(l.lot_no)} (Godown: ${escHtml(whMap[l.warehouse_id] || l.warehouse_id)}, Stock: ${l.balance})
        </option>`).join('');
      
      whSelect.value = '';
      if (balMsg) balMsg.style.display = 'none';
    });

    lotSelect.addEventListener('change', () => {
      const opt = lotSelect.selectedOptions[0];
      if (opt && opt.value) {
        whSelect.value = opt.dataset.wh;
        if (balMsg) {
          balMsg.style.display = '';
          balMsg.textContent = `Available Stock: ${opt.dataset.bal} ${escHtml(unitMap[unitEl.value] || '')}`;
        }
      } else {
        if (balMsg) balMsg.style.display = 'none';
      }
    });
 
    section.querySelector('#m-save-btn').addEventListener('click', async () => {
      const ingId   = ingEl.value;
      const qty     = parseFloat(qtyEl.value || 0);
      const unitId  = unitEl.value;
      const date    = section.querySelector('#m-date').value;
      const reason  = section.querySelector('#m-reason').value;
      const batchId = section.querySelector('#m-batch').value;
      const whId    = whSelect.value;
      const lotNo   = lotSelect.value;
 
      if (!ingId)          { toast.warning('Select an ingredient.'); ingEl.focus(); return; }
      if (!qty || qty <= 0){ toast.warning('Enter a valid quantity.'); qtyEl.focus(); return; }
      if (!reason)         { toast.warning('Select a reason.'); section.querySelector('#m-reason').focus(); return; }
      if (!date)           { toast.warning('Select a date.'); return; }
 
      const btn = section.querySelector('#m-save-btn');
      btn.disabled = true; btn.textContent = 'Saving…';
 
      try {
        const id = await saveEntry({ ingId, qty, unitId, date, reason, batchId, whId, lotNo });
 
        if (!document.body.contains(container)) return; // navigated away during save
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
              ${qty} ${escHtml(unitMap[unitId] || '')} · ${escHtml(reason)} · ${escHtml(date)}
              ${batchId ? ` · Batch: ${escHtml(batchId)}` : ''}
              ${lotNo ? ` · Lot: ${escHtml(lotNo)}` : ''}
              ${whId ? ` · Godown: ${escHtml(whMap[whId] || whId)}` : ''}
            </div>
            <div class="m-entry-card__id">${escHtml(id)}</div>
          </div>
        `;
        if (savedList) savedList.insertBefore(card, savedList.firstChild);
 
        // Reset form for next entry
        qtyEl.value = '';
        ingEl.value = ''; unitEl.value = '';
        lotSelect.innerHTML = '<option value="">-- No Lot / Custom --</option>';
        whSelect.value = '';
        if (balMsg) balMsg.style.display = 'none';
        const reasonEl = section.querySelector('#m-reason');
        const batchElF = section.querySelector('#m-batch');
        if (reasonEl) reasonEl.value = '';
        if (batchElF) batchElF.value = '';
        ingEl.focus();
 
        toast.success(`Saved — ${ingMap[ingId] || ingId}`);
      } catch (err) {
        toast.error(err.message);
      } finally {
        const btnEl = section.querySelector('#m-save-btn');
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✓ Save Entry'; }
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // DESKTOP: Horizontal table entry
  // ─────────────────────────────────────────────────────────
  function renderDesktopEntry() {
    const section = container.querySelector('#so-entry-section');
    if (!section) return;
    section.innerHTML = `
      <div class="card" style="margin-bottom:1.5rem">
        <div class="card__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
          <h3 class="card__title" style="margin:0">New Stock Out Entries</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <button class="btn btn--ghost btn--sm" id="so-add-row">+ Add Row</button>
            <button class="btn btn--primary btn--sm" id="so-save-all">Save All</button>
          </div>
        </div>
        <div class="card__body" style="padding:0;overflow-x:auto">
          <table id="so-entry-table" style="width:100%;border-collapse:collapse;min-width:950px">
            <thead>
              <tr style="background:var(--color-surface);border-bottom:2px solid var(--color-border)">
                <th style="${TH}">Date</th>
                <th style="${TH}">Ingredient <span class="req">*</span></th>
                <th style="${TH}">Lot No</th>
                <th style="${TH}">Godown</th>
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
      </div>
    `;

    section.querySelector('#so-add-row').addEventListener('click', addDesktopRow);
    section.querySelector('#so-save-all').addEventListener('click', async () => {
      const rows = [...section.querySelectorAll('#so-entry-body .so-entry-row')];
      if (!rows.length) { toast.warning('No rows to save.'); return; }
      for (const tr of rows) await saveDesktopRow(tr);
    });
    addDesktopRow();
  }

  function addDesktopRow() {
    const tbody = container.querySelector('#so-entry-body');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'so-entry-row';
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="${TD}"><input type="date" class="r-date input--sm" value="${todayStr()}" style="width:120px"></td>
      <td style="${TD}"><select class="r-ing input--sm" style="min-width:150px"><option value="">-- Select --</option>${ingOpts}</select></td>
      <td style="${TD}"><select class="r-lot input--sm" style="min-width:120px"><option value="">-- No Lot --</option></select></td>
      <td style="${TD}">
        <select class="r-wh input--sm" style="min-width:130px">
          <option value="">-- Select Godown --</option>
          ${warehouses.map(w => `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`).join('')}
        </select>
      </td>
      <td style="${TD}"><input type="number" class="r-qty input--sm" min="0.01" step="0.01" placeholder="0" style="width:80px"></td>
      <td style="${TD}"><select class="r-unit input--sm" style="width:80px"><option value="">--</option>${unitOpts}</select></td>
      <td style="${TD}"><select class="r-reason input--sm" style="min-width:130px"><option value="">-- Reason --</option>${reasonOpts}</select></td>
      <td style="${TD}"><select class="r-batch input--sm" style="min-width:120px"><option value="">-- None --</option>${batchOpts}</select></td>
      <td style="${TD};text-align:center">
        <button type="button" class="btn btn--sm btn--success r-save-btn">✓ Save</button>
        <button type="button" class="btn btn--sm btn--ghost r-remove-btn" style="margin-left:2px">×</button>
      </td>
    `;

    const ingS = tr.querySelector('.r-ing'), unitS = tr.querySelector('.r-unit');
    const lotS = tr.querySelector('.r-lot'), whS = tr.querySelector('.r-wh');

    ingS.addEventListener('change', () => {
      const ingId = ingS.value;
      const ing = ingredients.find(i => i.ingredient_id === ingId);
      if (ing?.unit_id) unitS.value = ing.unit_id;

      if (!ingId) {
        lotS.innerHTML = '<option value="">-- No Lot --</option>';
        whS.value = '';
        return;
      }

      const lots = getAvailableLotsForIng(ingId);
      lotS.innerHTML = '<option value="">-- No Lot --</option>' +
        lots.map(l => `<option value="${escHtml(l.lot_no)}" data-wh="${escHtml(l.warehouse_id)}" data-bal="${l.balance}">
          ${escHtml(l.lot_no)} (${l.balance})
        </option>`).join('');
      whS.value = '';
    });

    lotS.addEventListener('change', () => {
      const opt = lotS.selectedOptions[0];
      if (opt && opt.value) {
        whS.value = opt.dataset.wh;
      }
    });

    tr.querySelector('.r-remove-btn').addEventListener('click', () => {
      tr.remove();
      if (!container.querySelector('#so-entry-body .so-entry-row')) addDesktopRow();
    });
    tr.querySelector('.r-save-btn').addEventListener('click', () => saveDesktopRow(tr));
    tbody.appendChild(tr);
  }

  async function saveDesktopRow(tr) {
    const ingId  = tr.querySelector('.r-ing').value;
    const qty    = parseFloat(tr.querySelector('.r-qty').value || 0);
    const unitId = tr.querySelector('.r-unit').value;
    const date   = tr.querySelector('.r-date').value;
    const reason = tr.querySelector('.r-reason').value;
    const batchId= tr.querySelector('.r-batch').value;
    const lotNo  = tr.querySelector('.r-lot').value;
    const whId   = tr.querySelector('.r-wh').value;

    if (!ingId)       { toast.warning('Select an ingredient.'); return; }
    if (!qty || qty <= 0) { toast.warning('Enter a valid quantity.'); return; }
    if (!reason)      { toast.warning('Select a reason.'); return; }
    if (!date)        { toast.warning('Enter a date.'); return; }

    const btn = tr.querySelector('.r-save-btn');
    btn.disabled = true; btn.textContent = '…';

    try {
      const id = await saveEntry({ ingId, qty, unitId, date, reason, batchId, whId, lotNo });
      tr.classList.remove('so-entry-row');
      tr.style.background = 'color-mix(in srgb, var(--color-success) 8%, transparent)';
      tr.innerHTML = `
        <td style="${TD}">${escHtml(date)}</td>
        <td style="${TD}"><strong>${escHtml(ingMap[ingId] || ingId)}</strong></td>
        <td style="${TD}">${escHtml(lotNo || '—')}</td>
        <td style="${TD}">${escHtml(whMap[whId] || whId || '—')}</td>
        <td style="${TD}">${qty}</td>
        <td style="${TD}">${escHtml(unitMap[unitId] || unitId)}</td>
        <td style="${TD}">${escHtml(reason)}</td>
        <td style="${TD}">${escHtml(batchId || '—')}</td>
        <td style="${TD};text-align:center"><span style="color:var(--color-success);font-weight:600">✓ Saved</span><br><small>${escHtml(id)}</small></td>
      `;
      if (!container.querySelector('#so-entry-body .so-entry-row')) addDesktopRow();
      toast.success(`Saved — ${ingMap[ingId] || ingId} (${id})`);
    } catch (err) {
      btn.disabled = false; btn.textContent = '✓ Save';
      toast.error(err.message);
    }
  }

  // ── History ───────────────────────────────────────────────
  function renderHistory() {
    const histTableEl = container.querySelector('#so-history-table');
    if (!histTableEl) return;
    new DataTable(histTableEl, {
      columns: [
        { key: 'out_id',        label: 'ID' },
        { key: 'out_date',      label: 'Date', sortable: true },
        { key: 'ingredient_id', label: 'Ingredient', render: v => escHtml(ingMap[v] || v) },
        { key: 'lot_no',        label: 'Lot No',     render: v => escHtml(v || '—') },
        { key: 'warehouse_id',  label: 'Godown',     render: v => escHtml(whMap[v] || v || '—') },
        { key: 'quantity',      label: 'Qty',        render: (v, r) => `${v} ${escHtml(unitMap[r.unit_id] || '')}` },
        { key: 'reason',        label: 'Reason' },
        { key: 'batch_id',      label: 'Batch',      render: v => escHtml(v || '—') },
      ],
      data: [...allStockOut].reverse(),
      emptyMessage: 'No stock-out records yet.',
    });
  }

  renderHistory();
}

const TH = 'padding:0.5rem 0.6rem;text-align:left;font-size:0.8rem;font-weight:600;white-space:nowrap';
const TD = 'padding:0.35rem 0.4rem;vertical-align:middle';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
