// ============================================================
// modules/reports/reports.js — All Reports
// Production, Inventory, Sales, Ingredient Usage
// ============================================================
import { sheetsBatchRead, parseSheetRows } from '../../supabase-api.js';
import { SHEETS } from '../../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmt(n) { return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Safe scoped setter — avoids null crashes when user navigates away
function qset(container, sel, html) {
  const el = container.querySelector(sel);
  if (el) el.innerHTML = html;
}

function reportHeader(title, subtitle = '') {
  return `
    <div class="page-header">
      <div><h1 class="page-title">${escHtml(title)}</h1>${subtitle ? `<p class="page-subtitle">${escHtml(subtitle)}</p>` : ''}</div>
    </div>
    <div class="filter-bar card">
      <div class="card__body filter-bar__inner">
        <div class="form-group"><label>From Date</label><input type="date" id="rpt-from" value="${new Date(Date.now() - 30*86400000).toISOString().slice(0,10)}"></div>
        <div class="form-group"><label>To Date</label><input type="date" id="rpt-to" value="${todayStr()}"></div>
        <div class="form-group" id="rpt-extra-filters"></div>
        <button class="btn btn--primary" id="rpt-run">Run Report</button>
      </div>
    </div>
    <div id="rpt-summary" class="report-summary" style="display:none"></div>
    <div class="card"><div class="card__body" id="rpt-table"></div></div>
  `;
}

// ─── Production Report ───────────────────────────────────────
export async function renderProductionReport(container) {
  container.innerHTML = reportHeader('Production Report', 'Batch summary by date range');

  const bd = await sheetsBatchRead([`${SHEETS.PRODUCTS}!A:H`, `${SHEETS.COMPANIES}!A:J`, `${SHEETS.UNITS}!A:E`]);
  if (!document.body.contains(container)) return; // navigated away

  const products  = parseSheetRows(SHEETS.PRODUCTS,  bd[0].values || []);
  const companies = parseSheetRows(SHEETS.COMPANIES, bd[1].values || []);
  const units     = parseSheetRows(SHEETS.UNITS,     bd[2].values || []);
  const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));
  const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));

  // Add product filter
  qset(container, '#rpt-extra-filters', `
    <label>Product</label>
    <select id="rpt-product"><option value="">All Products</option>
      ${products.map(p => `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`).join('')}
    </select>`);

  container.querySelector('#rpt-run')?.addEventListener('click', async () => {
    const from = container.querySelector('#rpt-from')?.value;
    const to   = container.querySelector('#rpt-to')?.value;
    const prod = container.querySelector('#rpt-product')?.value;

    const batches = parseSheetRows(SHEETS.PRODUCTION_BATCHES, (await sheetsBatchRead([`${SHEETS.PRODUCTION_BATCHES}!A:L`]))[0].values || []);
    if (!document.body.contains(container)) return;
    let filtered = batches.filter(b => b.batch_date >= from && b.batch_date <= to);
    if (prod) filtered = filtered.filter(b => b.product_id === prod);

    const total = filtered.reduce((s,b) => s + parseFloat(b.actual_qty || b.planned_qty || 0), 0);
    const summaryEl = container.querySelector('#rpt-summary');
    if (summaryEl) {
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<div class="summary-pills">
        <span class="pill">Total Batches: <strong>${filtered.length}</strong></span>
        <span class="pill">Completed: <strong>${filtered.filter(b=>b.status==='Completed').length}</strong></span>
        <span class="pill">Total Output: <strong>${fmt(total)}</strong></span>
      </div>`;
    }
    const tableEl = container.querySelector('#rpt-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'batch_id',    label: 'Batch ID' },
        { key: 'batch_date',  label: 'Date', sortable: true },
        { key: 'product_id',  label: 'Product',  render: (v) => escHtml(prodMap[v] || v) },
        { key: 'company_id',  label: 'Company',  render: (v) => escHtml(compMap[v] || v) },
        { key: 'planned_qty', label: 'Planned Qty' },
        { key: 'actual_qty',  label: 'Actual Qty' },
        { key: 'status',      label: 'Status' },
      ],
      data: filtered.reverse(),
    });
  });
}

// ─── Inventory Report ─────────────────────────────────────────
export async function renderInventoryReport(container) {
  container.innerHTML = reportHeader('Inventory Report', 'Stock movement by ingredient and date');

  const bd = await sheetsBatchRead([`${SHEETS.INGREDIENTS}!A:H`, `${SHEETS.UNITS}!A:E`]);
  if (!document.body.contains(container)) return;

  const ingredients = parseSheetRows(SHEETS.INGREDIENTS, bd[0].values || []);
  const units       = parseSheetRows(SHEETS.UNITS, bd[1].values || []);
  const ingMap = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i.ingredient_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));

  qset(container, '#rpt-extra-filters', `
    <label>Ingredient</label>
    <select id="rpt-ing"><option value="">All Ingredients</option>
      ${ingredients.map(i => `<option value="${escHtml(i.ingredient_id)}">${escHtml(i.ingredient_name)}</option>`).join('')}
    </select>`);

  container.querySelector('#rpt-run')?.addEventListener('click', async () => {
    const from = container.querySelector('#rpt-from')?.value;
    const to   = container.querySelector('#rpt-to')?.value;
    const ing  = container.querySelector('#rpt-ing')?.value;

    const bd2 = await sheetsBatchRead([`${SHEETS.INVENTORY_IN}!A:M`, `${SHEETS.INVENTORY_OUT}!A:I`]);
    if (!document.body.contains(container)) return;
    let ins  = parseSheetRows(SHEETS.INVENTORY_IN,  bd2[0].values || []).filter(r => r.in_date >= from && r.in_date <= to);
    let outs = parseSheetRows(SHEETS.INVENTORY_OUT, bd2[1].values || []).filter(r => r.out_date >= from && r.out_date <= to);
    if (ing) { ins = ins.filter(r => r.ingredient_id === ing); outs = outs.filter(r => r.ingredient_id === ing); }

    const totalIn  = ins.reduce((s,r) => s + parseFloat(r.quantity || 0), 0);
    const totalOut = outs.reduce((s,r) => s + parseFloat(r.quantity || 0), 0);
    const summaryEl = container.querySelector('#rpt-summary');
    if (summaryEl) {
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<div class="summary-pills">
        <span class="pill pill--green">Total In: <strong>${fmt(totalIn)}</strong></span>
        <span class="pill pill--red">Total Out: <strong>${fmt(totalOut)}</strong></span>
        <span class="pill">Net: <strong>${fmt(totalIn - totalOut)}</strong></span>
      </div>`;
    }
    const combined = [
      ...ins.map(r  => ({ ...r, date: r.in_date,  direction: 'IN',  qty: r.quantity, ingredient: ingMap[r.ingredient_id] || r.ingredient_id })),
      ...outs.map(r => ({ ...r, date: r.out_date, direction: 'OUT', qty: r.quantity, ingredient: ingMap[r.ingredient_id] || r.ingredient_id })),
    ].sort((a,b) => b.date.localeCompare(a.date));

    const tableEl = container.querySelector('#rpt-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'date',       label: 'Date', sortable: true },
        { key: 'ingredient', label: 'Ingredient' },
        { key: 'direction',  label: 'Type', render: (v) => v === 'IN' ? '<span class="badge badge--green">IN</span>' : '<span class="badge badge--red">OUT</span>' },
        { key: 'qty',        label: 'Quantity', render: (v) => fmt(v) },
      ],
      data: combined,
    });
  });
}

// ─── Sales Report ─────────────────────────────────────────────
export async function renderSalesReport(container) {
  container.innerHTML = reportHeader('Sales Report', 'Revenue by company and product');

  const bd = await sheetsBatchRead([`${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`]);
  if (!document.body.contains(container)) return;

  const companies = parseSheetRows(SHEETS.COMPANIES, bd[0].values || []);
  const products  = parseSheetRows(SHEETS.PRODUCTS,  bd[1].values || []);
  const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
  const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));

  qset(container, '#rpt-extra-filters', `
    <label>Company</label>
    <select id="rpt-company"><option value="">All Companies</option>
      ${companies.map(c => `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`).join('')}
    </select>`);

  container.querySelector('#rpt-run')?.addEventListener('click', async () => {
    const from = container.querySelector('#rpt-from')?.value;
    const to   = container.querySelector('#rpt-to')?.value;
    const comp = container.querySelector('#rpt-company')?.value;

    let sales = parseSheetRows(SHEETS.SALES, (await sheetsBatchRead([`${SHEETS.SALES}!A:P`]))[0].values || []);
    if (!document.body.contains(container)) return;
    sales = sales.filter(s => s.sale_date >= from && s.sale_date <= to);
    if (comp) sales = sales.filter(s => s.company_id === comp);

    const totalRev = sales.reduce((s,r) => s + parseFloat(r.total_amount || 0), 0);
    const totalGST = sales.reduce((s,r) => s + parseFloat(r.gst_amount || 0), 0);
    const summaryEl = container.querySelector('#rpt-summary');
    if (summaryEl) {
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<div class="summary-pills">
        <span class="pill">Invoices: <strong>${sales.length}</strong></span>
        <span class="pill pill--green">Revenue: <strong>₹${fmt(totalRev)}</strong></span>
        <span class="pill">GST Collected: <strong>₹${fmt(totalGST)}</strong></span>
      </div>`;
    }
    const tableEl = container.querySelector('#rpt-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'invoice_no',   label: 'Invoice' },
        { key: 'sale_date',    label: 'Date', sortable: true },
        { key: 'company_id',   label: 'Company',  render: (v) => escHtml(compMap[v] || v) },
        { key: 'product_id',   label: 'Product',  render: (v) => escHtml(prodMap[v] || v) },
        { key: 'quantity',     label: 'Qty' },
        { key: 'amount',       label: 'Amount',   render: (v) => '₹' + fmt(v) },
        { key: 'gst_amount',   label: 'GST',      render: (v) => '₹' + fmt(v) },
        { key: 'total_amount', label: 'Total',    render: (v) => `<strong>₹${fmt(v)}</strong>` },
      ],
      data: sales.reverse(),
    });
  });
}

// ─── Ingredient Usage Report ──────────────────────────────────
export async function renderIngredientUsage(container) {
  container.innerHTML = reportHeader('Ingredient Usage', 'How much of each ingredient was consumed per product');

  container.querySelector('#rpt-run')?.addEventListener('click', async () => {
    const from = container.querySelector('#rpt-from')?.value;
    const to   = container.querySelector('#rpt-to')?.value;

    const bd = await sheetsBatchRead([`${SHEETS.INVENTORY_OUT}!A:I`, `${SHEETS.INGREDIENTS}!A:H`, `${SHEETS.PRODUCTION_BATCHES}!A:L`, `${SHEETS.PRODUCTS}!A:H`, `${SHEETS.UNITS}!A:E`]);
    if (!document.body.contains(container)) return;

    const outs        = parseSheetRows(SHEETS.INVENTORY_OUT, bd[0].values || []).filter(r => r.out_date >= from && r.out_date <= to);
    const ingredients = parseSheetRows(SHEETS.INGREDIENTS, bd[1].values || []);
    const batches     = parseSheetRows(SHEETS.PRODUCTION_BATCHES, bd[2].values || []);
    const products    = parseSheetRows(SHEETS.PRODUCTS, bd[3].values || []);
    const units       = parseSheetRows(SHEETS.UNITS, bd[4].values || []);
    const ingMap  = Object.fromEntries(ingredients.map(i => [i.ingredient_id, i]));
    const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));

    const grouped = {};
    outs.forEach(r => {
      const ing = ingMap[r.ingredient_id];
      const key = r.ingredient_id;
      if (!grouped[key]) grouped[key] = { ingredient: ing?.ingredient_name || r.ingredient_id, unit: unitMap[ing?.unit_id || ''] || '', total: 0 };
      grouped[key].total += parseFloat(r.quantity || 0);
    });

    const data = Object.values(grouped).sort((a,b) => b.total - a.total);
    const summaryEl = container.querySelector('#rpt-summary');
    if (summaryEl) {
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<div class="summary-pills"><span class="pill">Ingredients Used: <strong>${data.length}</strong></span></div>`;
    }
    const tableEl = container.querySelector('#rpt-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'ingredient', label: 'Ingredient', sortable: true },
        { key: 'total',      label: 'Total Consumed', render: (v,r) => `<strong>${fmt(v)}</strong> ${escHtml(r.unit)}` },
        { key: 'unit',       label: 'Unit' },
      ],
      data,
    });
  });
}

// ─── Order Lifecycle Report ──────────────────────────────────
export async function renderLifecycleReport(container) {
  container.innerHTML = reportHeader('Order Process Lifecycle Report', 'Tracking sales orders through production and dispatch');

  const bd = await sheetsBatchRead([
    `${SHEETS.PRODUCTS}!A:H`,
    `${SHEETS.COMPANIES}!A:J`,
    `${SHEETS.UNITS}!A:E`
  ]);
  if (!document.body.contains(container)) return;

  const products  = parseSheetRows(SHEETS.PRODUCTS,  bd[0].values || []);
  const companies = parseSheetRows(SHEETS.COMPANIES, bd[1].values || []);
  const units     = parseSheetRows(SHEETS.UNITS,     bd[2].values || []);
  const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));
  const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));

  qset(container, '#rpt-extra-filters', `
    <div style="display:flex;gap:0.5rem">
      <div class="form-group" style="margin-bottom:0">
        <label>Company</label>
        <select id="rpt-company" style="width:140px"><option value="">All Companies</option>
          ${companies.map(c => `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>Product</label>
        <select id="rpt-product" style="width:140px"><option value="">All Products</option>
          ${products.map(p => `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`).join('')}
        </select>
      </div>
    </div>
  `);

  container.querySelector('#rpt-run')?.addEventListener('click', async () => {
    const from = container.querySelector('#rpt-from')?.value;
    const to   = container.querySelector('#rpt-to')?.value;
    const comp = container.querySelector('#rpt-company')?.value;
    const prod = container.querySelector('#rpt-product')?.value;

    const bd2 = await sheetsBatchRead([
      `${SHEETS.SALES}!A:P`,
      `${SHEETS.PRODUCTION_BATCHES}!A:L`,
      `${SHEETS.DISPATCH}!A:M`
    ]);
    if (!document.body.contains(container)) return;

    const sales       = parseSheetRows(SHEETS.SALES,              bd2[0].values || []);
    const batches     = parseSheetRows(SHEETS.PRODUCTION_BATCHES,  bd2[1].values || []);
    const dispatches  = parseSheetRows(SHEETS.DISPATCH,            bd2[2].values || []);

    let filtered = sales.filter(s => s.sale_date >= from && s.sale_date <= to);
    if (comp) filtered = filtered.filter(s => s.company_id === comp);
    if (prod) filtered = filtered.filter(s => s.product_id === prod);

    const reportData = filtered.map(s => {
      // Find linked production batch
      const batch = batches.find(b => b.batch_id === s.batch_id);
      
      // Calculate production qty
      let prodQty = 0;
      if (batch) {
        prodQty = parseFloat(batch.actual_qty || batch.planned_qty || 0);
      }

      // Calculate dispatch qty for this batch/sale
      const orderDispatches = dispatches.filter(d => d.batch_id === s.batch_id || (d.company_id === s.company_id && d.product_id === s.product_id && s.batch_id === ''));
      const dispQty = orderDispatches.reduce((sum, d) => sum + parseFloat(d.quantity || 0), 0);

      const qtyVal = parseFloat(s.quantity || 0);
      const amtVal = parseFloat(s.total_amount || 0);
      const rateVal = qtyVal > 0 ? (amtVal / qtyVal) : 0;

      return {
        ...s,
        company_name: compMap[s.company_id] || s.company_id,
        product_name: prodMap[s.product_id] || s.product_id,
        unit: unitMap[s.unit_id] || '',
        rate_val: rateVal,
        prod_qty: prodQty,
        disp_qty: dispQty
      };
    });

    const totalQty = reportData.reduce((sum, r) => sum + parseFloat(r.quantity || 0), 0);
    const totalAmt = reportData.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);
    const totalProd = reportData.reduce((sum, r) => sum + r.prod_qty, 0);
    const totalDisp = reportData.reduce((sum, r) => sum + r.disp_qty, 0);

    const summaryEl = container.querySelector('#rpt-summary');
    if (summaryEl) {
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<div class="summary-pills">
        <span class="pill">Orders: <strong>${reportData.length}</strong></span>
        <span class="pill pill--blue">Order Qty: <strong>${fmt(totalQty)}</strong></span>
        <span class="pill pill--green">Order Value: <strong>₹${fmt(totalAmt)}</strong></span>
        <span class="pill pill--amber">In Production Qty: <strong>${fmt(totalProd)}</strong></span>
        <span class="pill pill--green">Dispatched Qty: <strong>${fmt(totalDisp)}</strong></span>
      </div>`;
    }

    const tableEl = container.querySelector('#rpt-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'invoice_no',   label: 'Invoice No / Order ID' },
        { key: 'sale_date',    label: 'Order Date', sortable: true },
        { key: 'company_name', label: 'Company', sortable: true },
        { key: 'product_name', label: 'Product', sortable: true },
        { key: 'quantity',     label: 'Order Qty', render: (v, r) => `${v} ${r.unit}` },
        { key: 'rate_val',     label: 'Rate / Unit', render: (v) => '₹' + fmt(v) },
        { key: 'total_amount', label: 'Total Value', render: (v) => '₹' + fmt(v) },
        { key: 'prod_qty',     label: 'Production Qty', render: (v, r) => `${fmt(v)} ${r.unit}` },
        { key: 'disp_qty',     label: 'Dispatched Qty', render: (v, r) => `${fmt(v)} ${r.unit}` },
        { key: 'status',       label: 'Status', render: (v) => {
          let badgeClass = 'gray';
          if (v === 'Dispatched' || v === 'Completed') badgeClass = 'green';
          else if (v === 'In Production' || v === 'Active') badgeClass = 'amber';
          return `<span class="badge badge--${badgeClass}">${escHtml(v)}</span>`;
        }},
      ],
      data: reportData.reverse(),
    });
  });
}
