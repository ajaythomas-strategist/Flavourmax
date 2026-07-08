// ============================================================
// modules/dispatch/new-dispatch.js
// ============================================================
import { readAllRows, sheetsAppend, generateId, sheetsBatchRead, parseSheetRows, activeOnly, updateFullRow } from '../../supabase-api.js';
import { SHEETS, BATCH_STATUS } from '../../config.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';

export async function renderNewDispatch(container) {
  if (!hasPermission('dispatch_edit')) { container.innerHTML = '<div class="page-header"><h1>Access Denied</h1></div>'; return; }
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">New Dispatch</h1><p class="page-subtitle">Create a dispatch record</p></div>
    </div>
    <div class="card" style="max-width:700px">
      <div class="card__body">
        <form id="dispatch-form" class="form-grid" novalidate>
          <div class="form-group">
            <label>Dispatch Date <span class="req">*</span></label>
            <input type="date" name="dispatch_date" required value="${todayStr()}">
          </div>
          <div class="form-group">
            <label>Company <span class="req">*</span></label>
            <select name="company_id" id="disp-company" required><option value="">-- Select --</option></select>
          </div>
          <div class="form-group">
            <label>Product <span class="req">*</span></label>
            <select name="product_id" id="disp-product" required><option value="">-- Select --</option></select>
          </div>
          <div class="form-group">
            <label>Completed Batch <span class="req">*</span></label>
            <select name="batch_id" id="disp-batch" required><option value="">-- Select Batch --</option></select>
          </div>
          <div class="form-group form-group--row">
            <div class="form-group__half">
              <label>Quantity <span class="req">*</span></label>
              <input type="number" name="quantity" min="0.01" step="0.01" required>
            </div>
            <div class="form-group__half">
              <label>Unit <span class="req">*</span></label>
              <select name="unit_id" required><option value="">--</option></select>
            </div>
          </div>
          <div class="form-group"><label>Vehicle No</label><input type="text" name="vehicle_no"></div>
          <div class="form-group"><label>Driver Name</label><input type="text" name="driver_name"></div>
          <div class="form-group form-group--full"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
          <div class="form-actions form-group--full">
            <button type="submit" class="btn btn--primary">Save Dispatch</button>
            <button type="reset" class="btn btn--ghost">Clear</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const batchData = await sheetsBatchRead([
    `${SHEETS.COMPANIES}!A:J`,
    `${SHEETS.PRODUCTS}!A:H`,
    `${SHEETS.PRODUCTION_BATCHES}!A:L`,
    `${SHEETS.UNITS}!A:E`,
    `${SHEETS.SALES}!A:P`
  ]);
  if (!document.body.contains(container)) return; // navigated away during fetch

  const companies = activeOnly(parseSheetRows(SHEETS.COMPANIES, batchData[0].values || []));
  const products  = activeOnly(parseSheetRows(SHEETS.PRODUCTS, batchData[1].values || []));
  const batches   = parseSheetRows(SHEETS.PRODUCTION_BATCHES, batchData[2].values || []).filter(b => b.status === BATCH_STATUS.COMPLETED);
  const units     = activeOnly(parseSheetRows(SHEETS.UNITS, batchData[3].values || []));
  const sales     = parseSheetRows(SHEETS.SALES, batchData[4].values || []);

  const compSel   = container.querySelector('#disp-company');
  const prodSel   = container.querySelector('#disp-product');
  const batchSel  = container.querySelector('#disp-batch');
  const unitSel   = container.querySelector('[name="unit_id"]');
  if (!compSel || !prodSel || !batchSel) return;

  companies.forEach(c => compSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`));
  products.forEach(p => prodSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`));
  units.forEach(u => unitSel?.insertAdjacentHTML('beforeend', `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`));

  function filterBatches() {
    const cId = compSel.value; const pId = prodSel.value;
    batchSel.innerHTML = '<option value="">-- Select Batch --</option>';
    batches.filter(b => (!cId || b.company_id === cId) && (!pId || b.product_id === pId))
      .forEach(b => batchSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(b.batch_id)}">${escHtml(b.batch_id)} (${escHtml(b.actual_qty || b.planned_qty)} units)</option>`));
  }
  compSel.addEventListener('change', filterBatches);
  prodSel.addEventListener('change', filterBatches);

  container.querySelector('#dispatch-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (!data.company_id || !data.product_id || !data.batch_id || !data.quantity) { toast.warning('Fill all required fields.'); return; }
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const id = await generateId(SHEETS.DISPATCH);
      await sheetsAppend(SHEETS.DISPATCH, [[id, data.dispatch_date, data.company_id, data.product_id, data.batch_id, data.quantity, data.unit_id, data.vehicle_no, data.driver_name, data.notes, 'Dispatched', getCurrentUser()?.user_id, new Date().toISOString()]]);
      
      // Look up and update status of matching Sales Order reference
      const matchedOrder = sales.find(s => s.batch_id === data.batch_id);
      if (matchedOrder) {
        await updateFullRow(SHEETS.SALES, matchedOrder.sale_id, {
          status: 'Dispatched',
          updated_at: new Date().toISOString()
        });
      }

      toast.success(`Dispatch ${id} saved.`);
      e.target.reset(); e.target.querySelector('[name=dispatch_date]').value = todayStr();
    } catch (err) { toast.error(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Save Dispatch'; }
  });
}

// ============================================================
// modules/dispatch/dispatch-list.js
// ============================================================
export async function renderDispatchList(container) {
  const { DataTable, statusBadge } = await import('../../components/data-table.js');
  const { readAllRows: _readAll, sheetsBatchRead: _batch, parseSheetRows: _parse } = await import('../../supabase-api.js');

  container.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Dispatch List</h1></div>
      ${hasPermission('dispatch_edit') ? `<a href="#dispatch/new-dispatch" class="btn btn--primary">+ New Dispatch</a>` : ''}</div>
    <div class="card"><div class="card__body" id="dispatch-table"></div></div>
  `;

  const bd = await _batch([`${SHEETS.DISPATCH}!A:M`, `${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`]);
  if (!document.body.contains(container)) return; // navigated away during fetch

  const dispatches = _parse(SHEETS.DISPATCH, bd[0].values || []);
  const companies  = _parse(SHEETS.COMPANIES, bd[1].values || []);
  const products   = _parse(SHEETS.PRODUCTS, bd[2].values || []);
  const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
  const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));

  const dispatchTableEl = container.querySelector('#dispatch-table');
  if (!dispatchTableEl) return;
  new DataTable(dispatchTableEl, {
    columns: [
      { key: 'dispatch_id',   label: 'ID' },
      { key: 'dispatch_date', label: 'Date', sortable: true },
      { key: 'company_id',    label: 'Company', render: (v) => escHtml(compMap[v] || v) },
      { key: 'product_id',    label: 'Product', render: (v) => escHtml(prodMap[v] || v) },
      { key: 'batch_id',      label: 'Batch' },
      { key: 'quantity',      label: 'Qty' },
      { key: 'vehicle_no',    label: 'Vehicle' },
      { key: 'driver_name',   label: 'Driver' },
      { key: 'status',        label: 'Status', render: (v) => statusBadge(v) },
    ],
    data: [...dispatches].reverse(),
  });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
