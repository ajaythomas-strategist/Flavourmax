// ============================================================
// modules/sales/sales.js — Sales, Sales List, Sales Returns
// ============================================================
import { readAllRows, sheetsAppend, generateId, generateInvoiceNo, sheetsBatchRead, parseSheetRows, updateInventoryBalance, activeOnly } from '../supabase-api.js?v=2';
import { SHEETS, GST_RATES } from '../config.js?v=2';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../auth.js?v=2';

// ─── New Sale ─────────────────────────────────────────────────
export async function renderNewSale(container) {
  if (!hasPermission('sales_edit')) { container.innerHTML = '<div class="page-header"><h1>Access Denied</h1></div>'; return; }

  const invoiceNo = await generateInvoiceNo();
  if (!document.body.contains(container)) return; // navigated away before render

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">New Sale</h1><p class="page-subtitle">Create sales invoice</p></div>
    </div>
    <div class="card" style="max-width:750px">
      <div class="card__body">
        <form id="sale-form" class="form-grid" novalidate>
          <div class="form-group">
            <label>Invoice No</label>
            <input type="text" name="invoice_no" value="${escHtml(invoiceNo)}" readonly class="input--readonly">
          </div>
          <div class="form-group">
            <label>Sale Date <span class="req">*</span></label>
            <input type="date" name="sale_date" required value="${todayStr()}">
          </div>
          <div class="form-group">
            <label>Company <span class="req">*</span></label>
            <select name="company_id" id="sale-company" required><option value="">-- Select --</option></select>
          </div>
          <div class="form-group">
            <label>Product <span class="req">*</span></label>
            <select name="product_id" id="sale-product" required><option value="">-- Select --</option></select>
          </div>
          <div class="form-group">
            <label>Batch Reference</label>
            <select name="batch_id" id="sale-batch"><option value="">-- None --</option></select>
          </div>
          <div class="form-group form-group--row">
            <div class="form-group__half">
              <label>Quantity <span class="req">*</span></label>
              <input type="number" name="quantity" id="sale-qty" min="0.01" step="0.01" required>
            </div>
            <div class="form-group__half">
              <label>Unit <span class="req">*</span></label>
              <select name="unit_id" id="sale-unit" required><option value="">--</option></select>
            </div>
          </div>
          <div class="form-group form-group--row">
            <div class="form-group__half">
              <label>Rate per Unit (₹) <span class="req">*</span></label>
              <input type="number" name="rate" id="sale-rate" min="0" step="0.01" required>
            </div>
            <div class="form-group__half">
              <label>GST %</label>
              <select name="gst_percent" id="sale-gst">
                ${GST_RATES.map(r => `<option value="${r}" ${r === 5 ? 'selected' : ''}>${r}%</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="invoice-summary form-group--full">
            <div class="invoice-summary__row"><span>Amount</span><strong id="calc-amount">₹0.00</strong></div>
            <div class="invoice-summary__row"><span>GST</span><strong id="calc-gst">₹0.00</strong></div>
            <div class="invoice-summary__row invoice-summary__total"><span>Total</span><strong id="calc-total">₹0.00</strong></div>
          </div>
          <div class="form-actions form-group--full">
            <button type="submit" class="btn btn--primary">Save Sale</button>
            <button type="reset" class="btn btn--ghost">Clear</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const bd = await sheetsBatchRead([`${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`, `${SHEETS.PRODUCTION_BATCHES}!A:L`, `${SHEETS.UNITS}!A:E`]);
  if (!document.body.contains(container)) return; // navigated away during fetch

  const companies = activeOnly(parseSheetRows(SHEETS.COMPANIES, bd[0].values || []));
  const products  = activeOnly(parseSheetRows(SHEETS.PRODUCTS, bd[1].values || []));
  const batches   = parseSheetRows(SHEETS.PRODUCTION_BATCHES, bd[2].values || []).filter(b => b.status === 'Completed');
  const units     = activeOnly(parseSheetRows(SHEETS.UNITS, bd[3].values || []));

  const compSel  = container.querySelector('#sale-company');
  const prodSel  = container.querySelector('#sale-product');
  const unitSel  = container.querySelector('#sale-unit');
  const batchSel = container.querySelector('#sale-batch');
  if (!compSel || !prodSel || !unitSel || !batchSel) return;

  companies.forEach(c => compSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`));
  products.forEach(p => prodSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`));
  units.forEach(u => unitSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`));
  batches.forEach(b => batchSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(b.batch_id)}">${escHtml(b.batch_id)}</option>`));

  function recalc() {
    const qty  = parseFloat(container.querySelector('#sale-qty')?.value || 0);
    const rate = parseFloat(container.querySelector('#sale-rate')?.value || 0);
    const gst  = parseFloat(container.querySelector('#sale-gst')?.value || 0);
    const amt  = qty * rate;
    const gstAmt = amt * gst / 100;
    const amtEl = container.querySelector('#calc-amount');
    const gstEl = container.querySelector('#calc-gst');
    const totEl = container.querySelector('#calc-total');
    if (amtEl) amtEl.textContent = '₹' + fmt(amt);
    if (gstEl) gstEl.textContent = '₹' + fmt(gstAmt);
    if (totEl) totEl.textContent = '₹' + fmt(amt + gstAmt);
  }

  ['sale-qty','sale-rate','sale-gst'].forEach(id => container.querySelector(`#${id}`)?.addEventListener('input', recalc));

  container.querySelector('#sale-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qty  = parseFloat(fd.get('quantity') || 0);
    const rate = parseFloat(fd.get('rate') || 0);
    const gst  = parseFloat(fd.get('gst_percent') || 0);
    const amt  = qty * rate;
    const gstAmt = amt * gst / 100;
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const id = await generateId(SHEETS.SALES);
      await sheetsAppend(SHEETS.SALES, [[id, fd.get('invoice_no'), fd.get('sale_date'), fd.get('company_id'), fd.get('product_id'), fd.get('batch_id'), qty, fd.get('unit_id'), rate, amt.toFixed(2), gst, gstAmt.toFixed(2), (amt+gstAmt).toFixed(2), 'Active', getCurrentUser()?.user_id, new Date().toISOString()]]);
      toast.success(`Sale ${id} saved. Invoice: ${fd.get('invoice_no')}`);
      window.location.hash = '#sales/sales-list';
    } catch (err) { toast.error(err.message); btn.disabled = false; btn.textContent = 'Save Sale'; }
  });
}

// ─── Sales List ───────────────────────────────────────────────
export async function renderSalesList(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Sales</h1></div>
      ${hasPermission('sales_edit') ? `<a href="#sales/new-sale" class="btn btn--primary">+ New Sale</a>` : ''}
    </div>
    <div class="card"><div class="card__body" id="sales-table"></div></div>
  `;

  const bd = await sheetsBatchRead([`${SHEETS.SALES}!A:P`, `${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`]);
  if (!document.body.contains(container)) return; // navigated away during fetch

  const sales     = parseSheetRows(SHEETS.SALES, bd[0].values || []);
  const companies = parseSheetRows(SHEETS.COMPANIES, bd[1].values || []);
  const products  = parseSheetRows(SHEETS.PRODUCTS, bd[2].values || []);
  const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
  const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));

  const totalSales = sales.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  container.insertAdjacentHTML('beforeend', `<div class="summary-bar"><span>Total Revenue: <strong>₹${fmt(totalSales)}</strong></span></div>`);

  const salesTableEl = container.querySelector('#sales-table');
  if (!salesTableEl) return;
  new DataTable(salesTableEl, {
    columns: [
      { key: 'sale_id',      label: 'ID' },
      { key: 'invoice_no',   label: 'Invoice' },
      { key: 'sale_date',    label: 'Date', sortable: true },
      { key: 'company_id',   label: 'Company',  render: (v) => escHtml(compMap[v] || v) },
      { key: 'product_id',   label: 'Product',  render: (v) => escHtml(prodMap[v] || v) },
      { key: 'quantity',     label: 'Qty' },
      { key: 'rate',         label: 'Rate (₹)' },
      { key: 'total_amount', label: 'Total',    render: (v) => `<strong>₹${fmt(v)}</strong>` },
      { key: 'gst_percent',  label: 'GST%' },
      { key: 'status',       label: 'Status',   render: (v) => statusBadge(v) },
    ],
    data: [...sales].reverse(),
  });
}

// ─── Sales Returns ────────────────────────────────────────────
export async function renderSalesReturns(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Sales Returns</h1></div>
      ${hasPermission('sales_edit') ? `<button class="btn btn--primary" id="new-return-btn">+ New Return</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="returns-table"></div></div>
  `;

  container.querySelector('#new-return-btn')?.addEventListener('click', () => openReturnForm());

  async function loadReturns() {
    const bd = await sheetsBatchRead([`${SHEETS.SALES_RETURN}!A:J`, `${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`]);
    if (!document.body.contains(container)) return; // navigated away during fetch

    const returns   = parseSheetRows(SHEETS.SALES_RETURN, bd[0].values || []);
    const companies = parseSheetRows(SHEETS.COMPANIES, bd[1].values || []);
    const products  = parseSheetRows(SHEETS.PRODUCTS, bd[2].values || []);
    const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
    const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));

    const returnsTableEl = container.querySelector('#returns-table');
    if (!returnsTableEl) return;
    new DataTable(returnsTableEl, {
      columns: [
        { key: 'return_id',   label: 'ID' },
        { key: 'return_date', label: 'Date', sortable: true },
        { key: 'sale_id',     label: 'Sale Ref' },
        { key: 'company_id',  label: 'Company',  render: (v) => escHtml(compMap[v] || v) },
        { key: 'product_id',  label: 'Product',  render: (v) => escHtml(prodMap[v] || v) },
        { key: 'quantity',    label: 'Return Qty' },
        { key: 'reason',      label: 'Reason' },
        { key: 'status',      label: 'Status',   render: (v) => statusBadge(v) },
      ],
      data: [...returns].reverse(),
    });
  }
  await loadReturns();

  async function openReturnForm() {
    const sales = await readAllRows(SHEETS.SALES);
    const result = await formModal({
      title: 'New Sales Return',
      fields: [
        { name: 'sale_id',     label: 'Original Sale ID', type: 'select', required: true,
          options: sales.map(s => ({ value: s.sale_id, label: `${s.invoice_no} — ${s.sale_id}` })) },
        { name: 'return_date', label: 'Return Date',      type: 'date', required: true },
        { name: 'quantity',    label: 'Return Quantity',  type: 'number', required: true, min: 0.01, step: '0.01' },
        { name: 'reason',      label: 'Reason',           type: 'textarea', required: true },
      ],
      data: { return_date: todayStr() }, submitText: 'Submit Return',
    });
    if (!result) return;
    try {
      const sale = sales.find(s => s.sale_id === result.sale_id);
      const id = await generateId(SHEETS.SALES_RETURN);
      await sheetsAppend(SHEETS.SALES_RETURN, [[id, result.return_date, result.sale_id, sale?.company_id || '', sale?.product_id || '', result.quantity, result.reason, 'Pending', getCurrentUser()?.user_id, new Date().toISOString()]]);
      toast.success('Sales return submitted.');
      await loadReturns();
    } catch (err) { toast.error(err.message); }
  }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmt(n) { return parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
