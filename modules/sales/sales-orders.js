// ============================================================
// modules/sales/sales-orders.js — Sales Order Management
// Pre-production orders: Create → Link to Batch → Dispatch
// ============================================================
import {
  readAllRows, sheetsAppend, findRowById, updateFullRow,
  generateId, sheetsBatchRead, parseSheetRows, activeOnly
} from '../../supabase-api.js';
import { SHEETS } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(n) { return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

// ─── New Sales Order (shortcut route) ───────────────────────
export async function renderNewSalesOrder(container) {
  // Render the list first, then auto-open the form
  await renderSalesOrderList(container);
  // Small delay to let DOM settle, then trigger the new-order button
  setTimeout(() => {
    container.querySelector('#new-so-btn')?.click();
  }, 100);
}

// ─── Sales Orders List ───────────────────────────────────────
export async function renderSalesOrderList(container) {
  const canEdit = hasPermission('sales_edit');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Sales Orders</h1>
        <p class="page-subtitle">Pre-production customer orders</p>
      </div>
      ${canEdit ? `<button class="btn btn--primary" id="new-so-btn">+ New Sales Order</button>` : ''}
    </div>

    <div class="filter-bar card">
      <div class="card__body filter-bar__inner">
        <div class="form-group">
          <label>Status</label>
          <select id="so-filter-status">
            <option value="">All Status</option>
            <option value="Pending">Pending</option>
            <option value="In Production">In Production</option>
            <option value="Dispatched">Dispatched</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <div class="form-group">
          <label>Company</label>
          <select id="so-filter-company"><option value="">All Companies</option></select>
        </div>
        <div class="form-group">
          <label>From Date</label>
          <input type="date" id="so-filter-from" value="${new Date(Date.now() - 30*86400000).toISOString().slice(0,10)}">
        </div>
        <div class="form-group">
          <label>To Date</label>
          <input type="date" id="so-filter-to" value="${todayStr()}">
        </div>
        <button class="btn btn--primary" id="so-filter-run">Apply Filter</button>
      </div>
    </div>

    <div class="card"><div class="card__body" id="so-table"></div></div>
  `;

  // Load reference data
  const bd = await sheetsBatchRead([
    `${SHEETS.COMPANIES}!A:J`,
    `${SHEETS.PRODUCTS}!A:H`,
    `${SHEETS.UNITS}!A:E`,
  ]);
  if (!document.body.contains(container)) return;

  const companies = activeOnly(parseSheetRows(SHEETS.COMPANIES, bd[0].values || []));
  const products  = activeOnly(parseSheetRows(SHEETS.PRODUCTS,  bd[1].values || []));
  const units     = activeOnly(parseSheetRows(SHEETS.UNITS,     bd[2].values || []));
  const compMap   = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
  const prodMap   = Object.fromEntries(products.map(p  => [p.product_id,  p.product_name]));
  const unitMap   = Object.fromEntries(units.map(u    => [u.unit_id,      u.abbreviation]));
  const priceMap  = Object.fromEntries(products.map(p  => [p.product_id,  p.default_price || '']));

  // Populate company filter
  const compFilterSel = container.querySelector('#so-filter-company');
  companies.forEach(c => compFilterSel.insertAdjacentHTML('beforeend',
    `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`));

  async function loadTable() {
    const statusVal = container.querySelector('#so-filter-status')?.value || '';
    const compVal   = container.querySelector('#so-filter-company')?.value || '';
    const fromVal   = container.querySelector('#so-filter-from')?.value || '';
    const toVal     = container.querySelector('#so-filter-to')?.value || '';

    const orders = await readAllRows(SHEETS.SALES_ORDERS);
    if (!document.body.contains(container)) return;

    let filtered = orders;
    if (statusVal) filtered = filtered.filter(o => o.status === statusVal);
    if (compVal)   filtered = filtered.filter(o => o.company_id === compVal);
    if (fromVal)   filtered = filtered.filter(o => o.order_date >= fromVal);
    if (toVal)     filtered = filtered.filter(o => o.order_date <= toVal);

    const tableEl = container.querySelector('#so-table');
    if (!tableEl) return;

    new DataTable(tableEl, {
      columns: [
        { key: 'order_no',           label: 'Order No',    sortable: true },
        { key: 'order_date',         label: 'Date',        sortable: true },
        { key: 'company_id',         label: 'Company',     sortable: true, render: (v) => escHtml(compMap[v] || v) },
        { key: 'product_id',         label: 'Product',     render: (v) => escHtml(prodMap[v] || v) },
        { key: 'quantity',           label: 'Qty',         render: (v, r) => `${fmt(v)} ${unitMap[r.unit_id] || ''}` },
        { key: 'price',              label: 'Price/Unit',  render: (v) => v ? `₹${fmt(v)}` : '—' },
        { key: 'total_amount',       label: 'Total ₹',     render: (v) => v ? `<strong>₹${fmt(v)}</strong>` : '—' },
        { key: 'expected_delivery',  label: 'Delivery By' },
        { key: 'batch_id',           label: 'Batch',       render: (v) => v
            ? `<a href="#production/process-log?batch=${escHtml(v)}" style="color:var(--color-primary)">${escHtml(v)}</a>`
            : '<span style="color:var(--color-text-muted)">—</span>' },
        { key: 'status',             label: 'Status',      render: (v) => {
          const map = { Pending:'gray', 'In Production':'blue', Dispatched:'green', Cancelled:'red' };
          return `<span class="badge badge--${map[v]||'gray'}">${escHtml(v)}</span>`;
        }},
      ],
      data: [...filtered].reverse(),
      actions: canEdit ? [
        { key: 'edit',   label: 'Edit',   icon: '✏', class: 'btn--ghost',
          handler: (row) => openSalesOrderForm(row, companies, products, units, loadTable) },
        { key: 'cancel', label: 'Cancel', icon: '✖', class: 'btn--ghost',
          handler: (row) => cancelOrder(row, loadTable) },
      ] : [],
    });
  }

  container.querySelector('#so-filter-run')?.addEventListener('click', loadTable);
  if (canEdit) {
    container.querySelector('#new-so-btn')?.addEventListener('click', () =>
      openSalesOrderForm(null, companies, products, units, loadTable));
  }

  await loadTable();
}

// ─── New Sales Order Form ────────────────────────────────────
async function openSalesOrderForm(data, companies, products, units, onSave) {
  // Build a modal-style inline form using the native dialog + fm-modal styles
  const isEdit = !!data;

  // Create a native dialog element using the modal CSS architecture
  const dialog = document.createElement('dialog');
  dialog.className = 'fm-modal fm-modal--md';

  const compOptions = companies.map(c =>
    `<option value="${escHtml(c.company_id)}" ${data?.company_id === c.company_id ? 'selected':''}>
      ${escHtml(c.company_name)}</option>`).join('');
  const prodOptions = products.map(p =>
    `<option value="${escHtml(p.product_id)}" data-price="${escHtml(p.default_price||'')}" ${data?.product_id === p.product_id ? 'selected':''}>
      ${escHtml(p.product_name)}</option>`).join('');
  const unitOptions = units.map(u =>
    `<option value="${escHtml(u.unit_id)}" ${data?.unit_id === u.unit_id ? 'selected':''}>
      ${escHtml(u.unit_name)} (${escHtml(u.abbreviation)})</option>`).join('');

  dialog.innerHTML = `
    <div class="fm-modal__header">
      <h2 class="fm-modal__title">${isEdit ? '📋 Edit Sales Order' : '📋 New Sales Order'}</h2>
      <button class="fm-modal__close" id="so-modal-close" aria-label="Close">×</button>
    </div>
    <div class="fm-modal__body">
      <form id="so-form" class="form-grid" novalidate>
        <div class="form-group">
          <label>Order Date <span class="req">*</span></label>
          <input type="date" name="order_date" required value="${data?.order_date || todayStr()}">
        </div>
        <div class="form-group">
          <label>Company <span class="req">*</span></label>
          <select name="company_id" required>
            <option value="">-- Select Company --</option>
            ${compOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Product <span class="req">*</span></label>
          <select name="product_id" required>
            <option value="">-- Select Product --</option>
            ${prodOptions}
          </select>
        </div>
        <div class="form-group form-group--row">
          <div class="form-group__half">
            <label>Quantity <span class="req">*</span></label>
            <input type="number" id="so-qty" name="quantity" min="0.01" step="0.01" required value="${data?.quantity || ''}">
          </div>
          <div class="form-group__half">
            <label>Unit <span class="req">*</span></label>
            <select name="unit_id" required>
              <option value="">-- Unit --</option>
              ${unitOptions}
            </select>
          </div>
        </div>
        <div class="form-group form-group--row">
          <div class="form-group__half">
            <label>Price / Unit (₹) <span class="req">*</span></label>
            <input type="number" id="so-price" name="price" min="0" step="0.01" required
              placeholder="Auto-filled from product"
              value="${data?.price || ''}">
            <small style="color:var(--color-text-muted);font-size:0.75rem">Default from product — you can adjust</small>
          </div>
          <div class="form-group__half">
            <label>Total Amount (₹)</label>
            <input type="text" id="so-total" readonly class="input--readonly" placeholder="Auto-calculated" value="${data?.total_amount ? '₹' + fmt(data.total_amount) : ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Expected Delivery Date</label>
          <input type="date" name="expected_delivery" value="${data?.expected_delivery || ''}">
        </div>
        <div class="form-group form-group--full">
          <label>Notes</label>
          <textarea name="notes" rows="2" style="width:100%">${escHtml(data?.notes || '')}</textarea>
        </div>
        ${isEdit ? `
        <div class="form-group">
          <label>Status</label>
          <select name="status">
            <option value="Pending" ${data?.status==='Pending'?'selected':''}>Pending</option>
            <option value="In Production" ${data?.status==='In Production'?'selected':''}>In Production</option>
            <option value="Dispatched" ${data?.status==='Dispatched'?'selected':''}>Dispatched</option>
            <option value="Cancelled" ${data?.status==='Cancelled'?'selected':''}>Cancelled</option>
          </select>
        </div>` : ''}
      </form>
    </div>
    <div class="fm-modal__footer">
      <button type="button" class="btn btn--ghost" id="so-modal-cancel">Cancel</button>
      <button type="submit" form="so-form" class="btn btn--primary">${isEdit ? 'Update Order' : 'Create Sales Order'}</button>
    </div>
  `;

  document.body.appendChild(dialog);
  document.body.classList.add('modal-open');
  dialog.showModal();

  const close = () => {
    dialog.close();
    document.body.classList.remove('modal-open');
  };
  dialog.querySelector('#so-modal-close')?.addEventListener('click', close);
  dialog.querySelector('#so-modal-cancel')?.addEventListener('click', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    setTimeout(() => dialog.remove(), 300);
  });

  // ── Auto-fill price from product default + recalc total ──
  const prodSel   = dialog.querySelector('[name=product_id]');
  const qtyInput  = dialog.querySelector('#so-qty');
  const priceInput = dialog.querySelector('#so-price');
  const totalInput = dialog.querySelector('#so-total');

  function recalcTotal() {
    const qty   = parseFloat(qtyInput?.value || 0);
    const price = parseFloat(priceInput?.value || 0);
    const total = qty * price;
    if (totalInput) {
      totalInput.value = (qty > 0 && price > 0) ? '₹' + total.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
    }
  }

  prodSel?.addEventListener('change', () => {
    const selectedOpt = prodSel.selectedOptions[0];
    const defaultPrice = selectedOpt?.dataset.price || '';
    if (defaultPrice && priceInput && !priceInput.value) {
      priceInput.value = defaultPrice;
    } else if (defaultPrice && priceInput) {
      // Offer to update if product changed
      priceInput.value = defaultPrice;
    }
    recalcTotal();
  });

  qtyInput?.addEventListener('input', recalcTotal);
  priceInput?.addEventListener('input', recalcTotal);

  // Trigger recalc on load if editing
  if (data?.price) recalcTotal();

  dialog.querySelector('#so-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const vals = Object.fromEntries(fd.entries());

    if (!vals.company_id || !vals.product_id || !vals.quantity || !vals.unit_id) {
      toast.error('Please fill all required fields.');
      return;
    }

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const now = new Date().toISOString();
      const user = getCurrentUser()?.user_id || '';

      if (isEdit) {
        const rowNum = await findRowById(SHEETS.SALES_ORDERS, data.order_id);
        if (!rowNum) throw new Error('Order not found');
        const total = (parseFloat(vals.quantity || 0) * parseFloat(vals.price || 0)) || '';
        await updateFullRow(SHEETS.SALES_ORDERS, rowNum, {
          ...data,
          order_date:        vals.order_date,
          company_id:        vals.company_id,
          product_id:        vals.product_id,
          quantity:          vals.quantity,
          unit_id:           vals.unit_id,
          price:             vals.price || '',
          total_amount:      total,
          expected_delivery: vals.expected_delivery || '',
          notes:             vals.notes || '',
          status:            vals.status || data.status,
        });
        toast.success('Sales Order updated.');
      } else {
        const orderId  = await generateId(SHEETS.SALES_ORDERS);
        // Generate order number: SO-YYYYMMDD-XXX
        const datePart = vals.order_date.replace(/-/g, '');
        const orders   = await readAllRows(SHEETS.SALES_ORDERS);
        const todayOrders = orders.filter(o => o.order_date === vals.order_date);
        const seq      = String(todayOrders.length + 1).padStart(3, '0');
        const orderNo  = `SO-${datePart}-${seq}`;

        await sheetsAppend(SHEETS.SALES_ORDERS, [[
          orderId,
          orderNo,
          vals.order_date,
          vals.company_id,
          vals.product_id,
          vals.quantity,
          vals.unit_id,
          vals.price || '',
          (parseFloat(vals.quantity || 0) * parseFloat(vals.price || 0)) || '',
          vals.expected_delivery || '',
          vals.notes || '',
          'Pending',
          '',        // batch_id — empty until production starts
          user,
          now,
        ]]);
        toast.success(`Sales Order ${orderNo} created.`);
      }

      close();
      await onSave();
    } catch (err) {
      toast.error('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = isEdit ? 'Update Order' : 'Create Sales Order';
    }
  });
}

// ─── Cancel Order ─────────────────────────────────────────────
async function cancelOrder(row, onSave) {
  if (row.status === 'Dispatched') {
    toast.info('Cannot cancel a dispatched order.'); return;
  }
  if (!confirm(`Cancel order ${row.order_no || row.order_id}?`)) return;
  try {
    const rowNum = await findRowById(SHEETS.SALES_ORDERS, row.order_id);
    await updateFullRow(SHEETS.SALES_ORDERS, rowNum, { ...row, status: 'Cancelled' });
    toast.success('Order cancelled.');
    await onSave();
  } catch (err) {
    toast.error('Error: ' + err.message);
  }
}
