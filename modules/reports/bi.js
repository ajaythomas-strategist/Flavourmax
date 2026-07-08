// ============================================================
// modules/reports/bi.js — Advanced Business Intelligence Module
// Power BI / Tableau style dashboard portal for food manufacturing
// ============================================================
import { sheetsBatchRead, parseSheetRows, readAllRows, activeOnly } from '../../supabase-api.js';
import { SHEETS } from '../../config.js';
import { DataTable } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

let activeCharts = []; // Hold reference to active ChartJS instances for disposal

// ─── Theme & Layout Persistent State ────────────────────────
const STATE = {
  tab: 'executive',
  fromDate: '',
  toDate: '',
  datePreset: 'this-month',
  comparePreset: 'prior-period',
  companyId: '',
  productId: '',
  status: '',
  darkMode: localStorage.getItem('fm_bi_dark') === 'true',
  fullscreen: false,
};

// ─── Helper Functions ─────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(n) { return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function fmtVal(n) { return '₹' + fmt(n); }

// Load ChartJS dynamically
async function loadChartJS() {
  if (window.Chart) return window.Chart;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    script.onload = () => resolve(window.Chart);
    script.onerror = () => reject(new Error('Failed to load Chart.js'));
    document.head.appendChild(script);
  });
}

// Clear active charts to prevent memory leaks and canvas overlaps
function clearCharts() {
  activeCharts.forEach(chart => {
    try { chart.destroy(); } catch (e) { console.warn(e); }
  });
  activeCharts = [];
}

// Save active chart reference
function registerChart(chart) {
  activeCharts.push(chart);
}

// ─── Date Ranges & Time Intelligence Engine ───────────────────
function calculateDateRange(preset) {
  const now = new Date();
  let start = new Date();
  let end = new Date();
  let priorStart = new Date();
  let priorEnd = new Date();

  switch (preset) {
    case 'today':
      start.setHours(0,0,0,0);
      end.setHours(23,59,59,999);
      priorStart.setDate(start.getDate() - 1);
      priorEnd.setDate(end.getDate() - 1);
      break;
    case 'yesterday':
      start.setDate(now.getDate() - 1); start.setHours(0,0,0,0);
      end.setDate(now.getDate() - 1);   end.setHours(23,59,59,999);
      priorStart.setDate(start.getDate() - 1);
      priorEnd.setDate(end.getDate() - 1);
      break;
    case 'this-week':
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Start Monday
      start = new Date(now.setDate(diff)); start.setHours(0,0,0,0);
      end = new Date(start.getTime() + 6*24*60*60*1000); end.setHours(23,59,59,999);
      priorStart.setTime(start.getTime() - 7*24*60*60*1000);
      priorEnd.setTime(end.getTime() - 7*24*60*60*1000);
      break;
    case 'last-week':
      const lastWkDiff = now.getDate() - now.getDay() - 6;
      start = new Date(now.setDate(lastWkDiff)); start.setHours(0,0,0,0);
      end = new Date(start.getTime() + 6*24*60*60*1000); end.setHours(23,59,59,999);
      priorStart.setTime(start.getTime() - 7*24*60*60*1000);
      priorEnd.setTime(end.getTime() - 7*24*60*60*1000);
      break;
    case 'this-month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      priorStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      priorEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'last-month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      priorStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      priorEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0);
      break;
    case 'this-quarter':
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), qStartMonth, 1);
      end = new Date(now.getFullYear(), qStartMonth + 3, 0);
      priorStart = new Date(now.getFullYear(), qStartMonth - 3, 1);
      priorEnd = new Date(now.getFullYear(), qStartMonth, 0);
      break;
    case 'last-quarter':
      const pqStartMonth = Math.floor(now.getMonth() / 3) * 3 - 3;
      start = new Date(now.getFullYear(), pqStartMonth, 1);
      end = new Date(now.getFullYear(), pqStartMonth + 3, 0);
      priorStart = new Date(now.getFullYear(), pqStartMonth - 6, 1);
      priorEnd = new Date(now.getFullYear(), pqStartMonth - 3, 0);
      break;
    case 'this-year':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
      priorStart = new Date(now.getFullYear() - 1, 0, 1);
      priorEnd = new Date(now.getFullYear() - 1, 11, 31);
      break;
    case 'last-year':
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
      priorStart = new Date(now.getFullYear() - 2, 0, 1);
      priorEnd = new Date(now.getFullYear() - 2, 11, 31);
      break;
    case 'financial-year':
      const isFYNew = now.getMonth() >= 3; // April or later
      const fyStartYear = isFYNew ? now.getFullYear() : now.getFullYear() - 1;
      start = new Date(fyStartYear, 3, 1); // April 1st
      end = new Date(fyStartYear + 1, 2, 31); // March 31st
      priorStart = new Date(fyStartYear - 1, 3, 1);
      priorEnd = new Date(fyStartYear, 2, 31);
      break;
    case 'rolling-12':
    default:
      start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      end = now;
      priorStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      priorEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
  }

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    priorStart: priorStart.toISOString().slice(0, 10),
    priorEnd: priorEnd.toISOString().slice(0, 10),
  };
}

// Calculate Comparative Variance Details
function calculateVariance(current, prior) {
  const diff = current - prior;
  const pct = prior !== 0 ? (diff / prior) * 100 : 0;
  return {
    value: current,
    prior: prior,
    diff: diff,
    pct: pct,
    icon: diff > 0 ? '▲' : diff < 0 ? '▼' : '■',
    class: diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral'
  };
}

// Helper to render KPI Card
function renderKPICard(title, varianceObj, formatFn = fmt) {
  const formattedVal = formatFn(varianceObj.value);
  const formattedDiff = formatFn(Math.abs(varianceObj.diff));
  const trendClass = `bi-kpi-card__compare--${varianceObj.class}`;
  
  return `
    <div class="bi-kpi-card">
      <span class="bi-kpi-card__title">${escHtml(title)}</span>
      <span class="bi-kpi-card__value">${formattedVal}</span>
      <div class="bi-kpi-card__compare ${trendClass}">
        <span>${varianceObj.icon} ${fmt(Math.abs(varianceObj.pct))}%</span>
        <span style="color:var(--color-text-muted);margin-left:4px">
          (${varianceObj.diff >= 0 ? '+' : '-'}${formattedDiff} vs prior)
        </span>
      </div>
    </div>
  `;
}

// Export data to CSV helper
function downloadCSV(filename, columns, data) {
  const headers = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row => 
    columns.map(col => {
      let val = row[col.key] ?? '';
      if (col.render) {
        // Strip HTML if rendering format contains badges or formatting
        val = col.render(val, row).replace(/<[^>]*>/g, '');
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${filename}_${todayStr()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ─── Main View Controller ─────────────────────────────────────
export async function renderBIDashboard(container, params) {
  if (!hasPermission('reports_view')) {
    container.innerHTML = '<div class="page-header"><h1 class="page-title">Access Denied</h1></div>';
    return;
  }

  // Set active tab based on query parameters or state
  if (params?.tab) STATE.tab = params.tab;

  // Set Dark Mode if active on load
  if (STATE.darkMode) {
    document.documentElement.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
  }

  // Initial Date presets calculation
  if (!STATE.fromDate || !STATE.toDate) {
    const range = calculateDateRange(STATE.datePreset);
    STATE.fromDate = range.start;
    STATE.toDate = range.end;
  }

  // Render Skeleton Structure
  container.innerHTML = `
    <div class="bi-container ${STATE.fullscreen ? 'bi-fullscreen-mode' : ''}" id="bi-container">
      
      <!-- BI PORTAL TOOLBAR -->
      <div class="bi-toolbar">
        <div>
          <h2 style="font-size:var(--font-size-xl);font-weight:700;display:flex;align-items:center;gap:0.5rem">
            📊 BI &amp; Advanced Analytics
          </h2>
          <small style="color:var(--color-text-muted)">Executive Dashboard &amp; Manufacturing Intel</small>
        </div>
        <div class="bi-toolbar__actions">
          <button class="btn btn--ghost" id="bi-toggle-dark">${STATE.darkMode ? '☀️ Light' : '🌙 Dark'}</button>
          <button class="btn btn--ghost" id="bi-btn-fullscreen">${STATE.fullscreen ? '🗗 Window' : '🗖 Fullscreen'}</button>
          <button class="btn btn--ghost" id="bi-btn-print">🖨️ Print PDF</button>
          <button class="btn btn--primary" id="bi-btn-export">📥 Export Data</button>
        </div>
      </div>

      <!-- FILTER PANEL -->
      <div class="filter-bar card">
        <div class="card__body filter-bar__inner" style="gap:var(--space-3)">
          <div class="form-group" style="margin-bottom:0">
            <label>Date Preset</label>
            <select id="bi-preset-date" style="width:130px">
              <option value="today" ${STATE.datePreset==='today'?'selected':''}>Today</option>
              <option value="yesterday" ${STATE.datePreset==='yesterday'?'selected':''}>Yesterday</option>
              <option value="this-week" ${STATE.datePreset==='this-week'?'selected':''}>This Week</option>
              <option value="last-week" ${STATE.datePreset==='last-week'?'selected':''}>Last Week</option>
              <option value="this-month" ${STATE.datePreset==='this-month'?'selected':''}>This Month</option>
              <option value="last-month" ${STATE.datePreset==='last-month'?'selected':''}>Last Month</option>
              <option value="this-quarter" ${STATE.datePreset==='this-quarter'?'selected':''}>This Quarter</option>
              <option value="last-quarter" ${STATE.datePreset==='last-quarter'?'selected':''}>Last Quarter</option>
              <option value="this-year" ${STATE.datePreset==='this-year'?'selected':''}>This Year</option>
              <option value="last-year" ${STATE.datePreset==='last-year'?'selected':''}>Last Year</option>
              <option value="financial-year" ${STATE.datePreset==='financial-year'?'selected':''}>Financial Year</option>
              <option value="rolling-12" ${STATE.datePreset==='rolling-12'?'selected':''}>Rolling 12 Months</option>
              <option value="custom" ${STATE.datePreset==='custom'?'selected':''}>Custom Range</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>Start Date</label>
            <input type="date" id="bi-from-date" value="${STATE.fromDate}" style="width:135px">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>End Date</label>
            <input type="date" id="bi-to-date" value="${STATE.toDate}" style="width:135px">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>Customer</label>
            <select id="bi-company-filter" style="width:140px"><option value="">All Customers</option></select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>Product</label>
            <select id="bi-product-filter" style="width:140px"><option value="">All Products</option></select>
          </div>
          <button class="btn btn--primary" id="bi-run-filters" style="margin-top:auto">Run Dashboard</button>
        </div>
      </div>

      <!-- PORTAL CORE LAYOUT -->
      <div class="bi-layout">
        
        <!-- BI TAB SIDEBAR MENU -->
        <div class="bi-menu card" style="padding:var(--space-2)">
          ${renderTabButton('executive', '🏛 Executive Summary')}
          ${renderTabButton('orders', '📋 Order Analytics')}
          ${renderTabButton('production', '⚗ Production &amp; WIP')}
          ${renderTabButton('process', '⏱ Process Analytics')}
          ${renderTabButton('inventory', '🏬 Inventory &amp; Godowns')}
          ${renderTabButton('dispatch', '🚚 Dispatch Tracking')}
          ${renderTabButton('customer', '🏢 Customer Analytics')}
          ${renderTabButton('product', '🏷 Product Performance')}
          ${renderTabButton('reviews', '👥 Meeting Reviews')}
          ${renderTabButton('exceptions', '🚨 Exception Control')}
          <hr style="border:0;border-top:1px solid var(--color-border);margin:var(--space-2) 0">
          ${renderTabButton('labour', '👥 Labour &amp; Shifts')}
          ${renderTabButton('machines', '⚙ Machine Performance')}
        </div>

        <!-- ACTIVE DASHBOARD TAB CONTENT VIEWPORT -->
        <div class="bi-viewport" id="bi-viewport">
          <div class="page-loading"><div class="spinner"></div><p>Loading analytics…</p></div>
        </div>

      </div>
    </div>
  `;

  // Bind Toolbar actions
  const containerEl = container.querySelector('#bi-container');
  container.querySelector('#bi-toggle-dark')?.addEventListener('click', (e) => {
    STATE.darkMode = !STATE.darkMode;
    localStorage.setItem('fm_bi_dark', STATE.darkMode);
    document.documentElement.classList.toggle('dark-mode', STATE.darkMode);
    e.target.textContent = STATE.darkMode ? '☀️ Light' : '🌙 Dark';
  });

  container.querySelector('#bi-btn-fullscreen')?.addEventListener('click', (e) => {
    STATE.fullscreen = !STATE.fullscreen;
    containerEl?.classList.toggle('bi-fullscreen-mode', STATE.fullscreen);
    e.target.textContent = STATE.fullscreen ? '🗗 Window' : '🗖 Fullscreen';
  });

  container.querySelector('#bi-btn-print')?.addEventListener('click', () => {
    window.print();
  });

  // Bind Date presets selection
  const presetSel = container.querySelector('#bi-preset-date');
  const fromInput = container.querySelector('#bi-from-date');
  const toInput = container.querySelector('#bi-to-date');

  presetSel?.addEventListener('change', (e) => {
    STATE.datePreset = e.target.value;
    if (STATE.datePreset !== 'custom') {
      const range = calculateDateRange(STATE.datePreset);
      STATE.fromDate = range.start;
      STATE.toDate = range.end;
      if (fromInput) fromInput.value = range.start;
      if (toInput) toInput.value = range.end;
    }
  });

  // If user adjusts dates manually, change preset to "custom"
  const markCustomDate = () => {
    STATE.datePreset = 'custom';
    if (presetSel) presetSel.value = 'custom';
  };
  fromInput?.addEventListener('change', markCustomDate);
  toInput?.addEventListener('change', markCustomDate);

  // Populate dynamic reference filters
  const bd = await sheetsBatchRead([`${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`]);
  const companies = activeOnly(parseSheetRows(SHEETS.COMPANIES, bd[0].values || []));
  const products  = activeOnly(parseSheetRows(SHEETS.PRODUCTS,  bd[1].values || []));

  const compFilterSel = container.querySelector('#bi-company-filter');
  const prodFilterSel = container.querySelector('#bi-product-filter');
  
  companies.forEach(c => compFilterSel?.insertAdjacentHTML('beforeend', `<option value="${escHtml(c.company_id)}" ${STATE.companyId===c.company_id?'selected':''}>${escHtml(c.company_name)}</option>`));
  products.forEach(p => prodFilterSel?.insertAdjacentHTML('beforeend', `<option value="${escHtml(p.product_id)}" ${STATE.productId===p.product_id?'selected':''}>${escHtml(p.product_name)}</option>`));

  // Run Dashboard trigger
  container.querySelector('#bi-run-filters')?.addEventListener('click', () => {
    STATE.fromDate = fromInput?.value || '';
    STATE.toDate = toInput?.value || '';
    STATE.companyId = container.querySelector('#bi-company-filter')?.value || '';
    STATE.productId = container.querySelector('#bi-product-filter')?.value || '';
    renderActiveTab(container.querySelector('#bi-viewport'), companies, products);
  });

  // Load active tab initially
  renderActiveTab(container.querySelector('#bi-viewport'), companies, products);
}

function renderTabButton(tabName, label) {
  const activeClass = STATE.tab === tabName ? 'bi-menu-btn--active' : '';
  return `<a href="#reports/bi?tab=${tabName}" class="bi-menu-btn ${activeClass}" style="text-decoration:none">${label}</a>`;
}

// ─── Active Tab Rendering Dashboard Logic ───────────────────
async function renderActiveTab(viewport, companies, products) {
  clearCharts();
  viewport.innerHTML = `<div class="page-loading"><div class="spinner"></div><p>Calculating comparative analytics…</p></div>`;

  // Render Unavailable Reports immediately
  if (STATE.tab === 'labour' || STATE.tab === 'machines') {
    viewport.innerHTML = `
      <div class="bi-unavailable-alert card">
        <div class="bi-unavailable-alert__icon">⚠️</div>
        <div class="bi-unavailable-alert__text">
          This report is currently unavailable because the required data is not being captured.
        </div>
        <p style="font-size:var(--font-size-sm);color:var(--color-text-muted)">
          No tables or schemas detected for ${STATE.tab === 'labour' ? 'labour, operators, or shift tracking' : 'machine operation and maintenance logs'}.
        </p>
      </div>
    `;
    return;
  }

  try {
    // Determine prior period dates for Time Intelligence calculations
    const rangeObj = calculateDateRange(STATE.datePreset);
    // Overwrite with custom ranges if selected
    if (STATE.datePreset === 'custom') {
      rangeObj.start = STATE.fromDate;
      rangeObj.end = STATE.toDate;
      // Calculate prior period dynamically by offsetting the span
      const startD = new Date(STATE.fromDate);
      const endD = new Date(STATE.toDate);
      const diffMs = endD.getTime() - startD.getTime();
      const pStart = new Date(startD.getTime() - diffMs - 24*60*60*1000);
      const pEnd = new Date(startD.getTime() - 24*60*60*1000);
      rangeObj.priorStart = pStart.toISOString().slice(0, 10);
      rangeObj.priorEnd = pEnd.toISOString().slice(0, 10);
    }

    // Load transactional facts in batch
    const bd = await sheetsBatchRead([
      `${SHEETS.SALES_ORDERS}!A:M`,
      `${SHEETS.PRODUCTION_BATCHES}!A:L`,
      `${SHEETS.DISPATCH}!A:M`,
      `${SHEETS.PROCESS_LOG}!A:O`,
      `${SHEETS.INVENTORY_BALANCE}!A:F`,
      `${SHEETS.INVENTORY_IN}!A:N`,
      `${SHEETS.INVENTORY_OUT}!A:K`,
      `${SHEETS.UNITS}!A:E`
    ]);

    const allSalesOrders = parseSheetRows(SHEETS.SALES_ORDERS,       bd[0].values || []);
    const allBatches     = parseSheetRows(SHEETS.PRODUCTION_BATCHES,  bd[1].values || []);
    const allDispatches  = parseSheetRows(SHEETS.DISPATCH,            bd[2].values || []);
    const allProcessLogs = parseSheetRows(SHEETS.PROCESS_LOG,        bd[3].values || []);
    const allBalances    = parseSheetRows(SHEETS.INVENTORY_BALANCE,  bd[4].values || []);
    const allStockIn     = parseSheetRows(SHEETS.INVENTORY_IN,       bd[5].values || []);
    const allStockOut    = parseSheetRows(SHEETS.INVENTORY_OUT,      bd[6].values || []);
    const allUnits       = parseSheetRows(SHEETS.UNITS,              bd[7].values || []);

    const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
    const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));
    const unitMap = Object.fromEntries(allUnits.map(u => [u.unit_id, u.abbreviation]));

    // Apply global filters to CURRENT period dataset
    let orders     = allSalesOrders.filter(o => o.order_date >= rangeObj.start && o.order_date <= rangeObj.end);
    let batches    = allBatches.filter(b => b.batch_date >= rangeObj.start && b.batch_date <= rangeObj.end);
    let dispatches = allDispatches.filter(d => d.dispatch_date >= rangeObj.start && d.dispatch_date <= rangeObj.end);
    
    // Apply global filters to PRIOR period dataset
    let priorOrders     = allSalesOrders.filter(o => o.order_date >= rangeObj.priorStart && o.order_date <= rangeObj.priorEnd);
    let priorBatches    = allBatches.filter(b => b.batch_date >= rangeObj.priorStart && b.batch_date <= rangeObj.priorEnd);
    let priorDispatches = allDispatches.filter(d => d.dispatch_date >= rangeObj.priorStart && d.dispatch_date <= rangeObj.priorEnd);

    // Apply Business filters
    if (STATE.companyId) {
      orders = orders.filter(o => o.company_id === STATE.companyId);
      priorOrders = priorOrders.filter(o => o.company_id === STATE.companyId);
      batches = batches.filter(b => b.company_id === STATE.companyId);
      priorBatches = priorBatches.filter(b => b.company_id === STATE.companyId);
      dispatches = dispatches.filter(d => d.company_id === STATE.companyId);
      priorDispatches = priorDispatches.filter(d => d.company_id === STATE.companyId);
    }
    if (STATE.productId) {
      orders = orders.filter(o => o.product_id === STATE.productId);
      priorOrders = priorOrders.filter(o => o.product_id === STATE.productId);
      batches = batches.filter(b => b.product_id === STATE.productId);
      priorBatches = priorBatches.filter(b => b.product_id === STATE.productId);
      dispatches = dispatches.filter(d => d.product_id === STATE.productId);
      priorDispatches = priorDispatches.filter(d => d.product_id === STATE.productId);
    }

    // Connect export trigger to download current view's dataset
    document.getElementById('bi-btn-export').onclick = () => {
      exportViewCSV(STATE.tab, orders, batches, dispatches, allBalances, allProcessLogs, compMap, prodMap);
    };

    // Render tab template
    switch (STATE.tab) {
      case 'executive':
        await renderExecutiveTab(viewport, orders, batches, dispatches, priorOrders, priorBatches, priorDispatches, prodMap);
        break;
      case 'orders':
        await renderOrdersTab(viewport, orders, priorOrders, compMap, prodMap, unitMap);
        break;
      case 'production':
        await renderProductionTab(viewport, batches, priorBatches, allProcessLogs, prodMap, compMap, unitMap);
        break;
      case 'process':
        await renderProcessTab(viewport, allProcessLogs, batches, prodMap);
        break;
      case 'inventory':
        await renderInventoryTab(viewport, allBalances, allStockIn, allStockOut, allUnits);
        break;
      case 'dispatch':
        await renderDispatchTab(viewport, dispatches, priorDispatches, compMap, prodMap, unitMap);
        break;
      case 'customer':
        await renderCustomerTab(viewport, orders, priorOrders, compMap);
        break;
      case 'product':
        await renderProductTab(viewport, orders, batches, prodMap);
        break;
      case 'reviews':
        await renderReviewsTab(viewport, allSalesOrders, allBatches, allDispatches, compMap, prodMap);
        break;
      case 'exceptions':
        await renderExceptionsTab(viewport, allSalesOrders, allBatches, allBalances, allProcessLogs, compMap, prodMap);
        break;
    }
  } catch (err) {
    console.error('[bi_tab]', err);
    viewport.innerHTML = `<div class="bi-unavailable-alert card"><div class="bi-unavailable-alert__icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
  }
}

// ─── 1. EXECUTIVE SUMMARY VIEW ────────────────────────────────
async function renderExecutiveTab(viewport, orders, batches, dispatches, priorOrders, priorBatches, priorDispatches, prodMap) {
  // Compute Key variance indicators
  const valCurrent = orders.reduce((s,o) => s + parseFloat(o.total_amount || 0), 0);
  const valPrior = priorOrders.reduce((s,o) => s + parseFloat(o.total_amount || 0), 0);
  const orderValueVar = calculateVariance(valCurrent, valPrior);

  const prodQtyCurrent = batches.reduce((s,b) => s + parseFloat(b.actual_qty || b.planned_qty || 0), 0);
  const prodQtyPrior = priorBatches.reduce((s,b) => s + parseFloat(b.actual_qty || b.planned_qty || 0), 0);
  const prodQtyVar = calculateVariance(prodQtyCurrent, prodQtyPrior);

  const dispQtyCurrent = dispatches.reduce((s,d) => s + parseFloat(d.quantity || 0), 0);
  const dispQtyPrior = priorDispatches.reduce((s,d) => s + parseFloat(d.quantity || 0), 0);
  const dispQtyVar = calculateVariance(dispQtyCurrent, dispQtyPrior);

  viewport.innerHTML = `
    <!-- Executive KPIs -->
    <div class="bi-kpi-grid">
      ${renderKPICard('Revenue / Order Value', orderValueVar, fmtVal)}
      ${renderKPICard('Active Orders Received', calculateVariance(orders.length, priorOrders.length))}
      ${renderKPICard('Production Volume', prodQtyVar)}
      ${renderKPICard('Dispatched Volume', dispQtyVar)}
    </div>

    <!-- Executive Charts -->
    <div class="bi-charts-grid">
      <div class="card">
        <div class="card__header"><h3 class="card__title">📈 Sales vs Dispatch Timeline</h3></div>
        <div class="card__body" style="position:relative;height:280px"><canvas id="executiveTimelineChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><h3 class="card__title">🏆 Top Selling Products (by Revenue)</h3></div>
        <div class="card__body" style="position:relative;height:280px"><canvas id="executiveTopProdChart"></canvas></div>
      </div>
    </div>

    <!-- Overview Table -->
    <div class="card">
      <div class="card__header"><h3 class="card__title">📋 Recent Activity Digest</h3></div>
      <div class="card__body" id="executive-activity-table"></div>
    </div>
  `;

  // Draw Charts
  const Chart = await loadChartJS();
  
  // 1. Timeline Chart
  const ctx1 = viewport.querySelector('#executiveTimelineChart')?.getContext('2d');
  if (ctx1) {
    const dates = [...new Set(orders.map(o => o.order_date))].sort().slice(-10);
    const orderData = dates.map(d => orders.filter(o => o.order_date === d).reduce((s,o) => s + parseFloat(o.quantity || 0), 0));
    const dispData = dates.map(d => dispatches.filter(disp => disp.dispatch_date === d).reduce((s,disp) => s + parseFloat(disp.quantity || 0), 0));

    const chart1 = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          { label: 'Ordered Volume', data: orderData, borderColor: '#0284c7', tension: 0.3, fill: false },
          { label: 'Dispatched Volume', data: dispData, borderColor: '#16a34a', tension: 0.3, fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart1);
  }

  // 2. Top Products Chart
  const ctx2 = viewport.querySelector('#executiveTopProdChart')?.getContext('2d');
  if (ctx2) {
    const prodSums = {};
    orders.forEach(o => { prodSums[o.product_id] = (prodSums[o.product_id] || 0) + parseFloat(o.total_amount || 0); });
    const topProd = Object.entries(prodSums).map(([id, sum]) => ({ name: prodMap[id] || id, sum })).sort((a,b) => b.sum - a.sum).slice(0, 5);

    const chart2 = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: topProd.map(p => p.name),
        datasets: [{ label: 'Revenue (₹)', data: topProd.map(p => p.sum), backgroundColor: 'rgba(2, 132, 199, 0.8)' }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart2);
  }

  // Activity Table
  const tableEl = viewport.querySelector('#executive-activity-table');
  if (tableEl) {
    const recentOrders = [...orders].reverse().slice(0, 5);
    new DataTable(tableEl, {
      columns: [
        { key: 'order_no', label: 'Order No' },
        { key: 'order_date', label: 'Date' },
        { key: 'product_id', label: 'Product', render: (v) => escHtml(prodMap[v] || v) },
        { key: 'quantity', label: 'Qty' },
        { key: 'total_amount', label: 'Amount', render: (v) => fmtVal(v) },
        { key: 'status', label: 'Status', render: (v) => `<span class="badge badge--${v==='Dispatched'?'green':(v==='Pending'?'gray':'blue')}">${v}</span>` }
      ],
      data: recentOrders
    });
  }
}

// ─── 2. ORDER ANALYTICS VIEW ──────────────────────────────────
async function renderOrdersTab(viewport, orders, priorOrders, compMap, prodMap, unitMap) {
  const pendingOrders = orders.filter(o => o.status === 'Pending').length;
  const inProdOrders = orders.filter(o => o.status === 'In Production').length;
  const dispOrders = orders.filter(o => o.status === 'Dispatched').length;

  viewport.innerHTML = `
    <div class="bi-kpi-grid">
      ${renderKPICard('Total Orders', calculateVariance(orders.length, priorOrders.length))}
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Pending Orders</span>
        <span class="bi-kpi-card__value">${pendingOrders}</span>
        <small style="color:var(--color-text-muted)">Awaiting production</small>
      </div>
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">In Production</span>
        <span class="bi-kpi-card__value">${inProdOrders}</span>
        <small style="color:var(--color-text-muted)">Currently in process</small>
      </div>
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Completed &amp; Dispatched</span>
        <span class="bi-kpi-card__value">${dispOrders}</span>
        <small style="color:var(--color-text-muted)">Shipped to customers</small>
      </div>
    </div>

    <div class="bi-charts-grid">
      <div class="card">
        <div class="card__header"><h3 class="card__title">🍕 Status Breakdown</h3></div>
        <div class="card__body" style="position:relative;height:240px"><canvas id="orderStatusChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><h3 class="card__title">🏢 Customer Split (by Quantity)</h3></div>
        <div class="card__body" style="position:relative;height:240px"><canvas id="orderCustomerChart"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card__header">
        <h3 class="card__title">📋 Order Breakdown Ledger</h3>
      </div>
      <div class="card__body" id="orders-ledger-table"></div>
    </div>
  `;

  // Draw Charts
  const Chart = await loadChartJS();

  const ctx1 = viewport.querySelector('#orderStatusChart')?.getContext('2d');
  if (ctx1) {
    const chart1 = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: ['Pending', 'In Production', 'Dispatched', 'Cancelled'],
        datasets: [{
          data: [pendingOrders, inProdOrders, dispOrders, orders.filter(o => o.status === 'Cancelled').length],
          backgroundColor: ['#94a3b8', '#3b82f6', '#10b981', '#ef4444']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart1);
  }

  const ctx2 = viewport.querySelector('#orderCustomerChart')?.getContext('2d');
  if (ctx2) {
    const custData = {};
    orders.forEach(o => { custData[o.company_id] = (custData[o.company_id] || 0) + parseFloat(o.quantity || 0); });
    const sorted = Object.entries(custData).map(([id, sum]) => ({ name: compMap[id] || id, sum })).sort((a,b) => b.sum - a.sum).slice(0, 5);

    const chart2 = new Chart(ctx2, {
      type: 'pie',
      data: {
        labels: sorted.map(c => c.name),
        datasets: [{ data: sorted.map(c => c.sum), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'] }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart2);
  }

  const tableEl = viewport.querySelector('#orders-ledger-table');
  if (tableEl) {
    new DataTable(tableEl, {
      columns: [
        { key: 'order_no', label: 'Order No', sortable: true },
        { key: 'order_date', label: 'Date', sortable: true },
        { key: 'company_id', label: 'Customer', render: (v) => escHtml(compMap[v] || v) },
        { key: 'product_id', label: 'Product', render: (v) => escHtml(prodMap[v] || v) },
        { key: 'quantity', label: 'Quantity', render: (v,r) => `${fmt(v)} ${unitMap[r.unit_id] || ''}` },
        { key: 'price', label: 'Price/Unit', render: (v) => v ? fmtVal(v) : '—' },
        { key: 'total_amount', label: 'Total Value', render: (v) => v ? fmtVal(v) : '—' },
        { key: 'status', label: 'Status', render: (v) => `<span class="badge badge--${v==='Dispatched'?'green':(v==='Pending'?'gray':'blue')}">${v}</span>` }
      ],
      data: orders
    });
  }
}

// ─── 3. PRODUCTION & WIP VIEW ─────────────────────────────────
async function renderProductionTab(viewport, batches, priorBatches, allProcessLogs, prodMap, compMap, unitMap) {
  const activeBatches = batches.filter(b => b.status === 'In Progress').length;
  const completedBatches = batches.filter(b => b.status === 'Completed').length;
  const totalQty = batches.reduce((s,b) => s + parseFloat(b.actual_qty || b.planned_qty || 0), 0);

  viewport.innerHTML = `
    <div class="bi-kpi-grid">
      ${renderKPICard('Batches Initiated', calculateVariance(batches.length, priorBatches.length))}
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Active Batches (WIP)</span>
        <span class="bi-kpi-card__value">${activeBatches}</span>
        <small style="color:var(--color-text-muted)">Currently undergoing steps</small>
      </div>
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Completed Batches</span>
        <span class="bi-kpi-card__value">${completedBatches}</span>
        <small style="color:var(--color-text-muted)">Ready for dispatch</small>
      </div>
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Total Quantity Produced</span>
        <span class="bi-kpi-card__value">${fmt(totalQty)}</span>
        <small style="color:var(--color-text-muted)">Units of output</small>
      </div>
    </div>

    <!-- Active WIP Table -->
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">⚗️ Work In Progress (WIP) Active Batches</h3>
      </div>
      <div class="card__body" id="wip-batches-table"></div>
    </div>

    <!-- Production Volume chart -->
    <div class="card">
      <div class="card__header"><h3 class="card__title">📈 Production Volume Timeline</h3></div>
      <div class="card__body" style="position:relative;height:240px"><canvas id="prodTimelineChart"></canvas></div>
    </div>
  `;

  // Draw WIP Table
  const wipBatches = batches.filter(b => b.status === 'In Progress');
  const tableEl = viewport.querySelector('#wip-batches-table');
  if (tableEl) {
    new DataTable(tableEl, {
      columns: [
        { key: 'batch_id', label: 'Batch ID', render: (v) => `<a href="#production/process-log?batch=${escHtml(v)}" style="color:var(--color-primary);font-weight:600">${escHtml(v)}</a>` },
        { key: 'batch_date', label: 'Date Started', sortable: true },
        { key: 'product_id', label: 'Product', render: (v) => escHtml(prodMap[v] || v) },
        { key: 'company_id', label: 'Target Company', render: (v) => escHtml(compMap[v] || v) },
        { key: 'planned_qty', label: 'Planned Qty', render: (v,r) => `${fmt(v)} ${unitMap[r.unit_id] || ''}` },
        { key: 'batch_id', label: 'Current Active Step', render: (v) => {
          const activeStep = allProcessLogs.find(l => l.batch_id === v && l.step_status === 'Active');
          return activeStep ? `<span class="badge badge--blue">${escHtml(activeStep.process_name)}</span>` : '<span class="badge badge--gray">None</span>';
        }}
      ],
      data: wipBatches
    });
  }

  // Draw timeline chart
  const Chart = await loadChartJS();
  const ctx = viewport.querySelector('#prodTimelineChart')?.getContext('2d');
  if (ctx) {
    const dates = [...new Set(batches.map(b => b.batch_date))].sort().slice(-15);
    const data = dates.map(d => batches.filter(b => b.batch_date === d).reduce((s,b) => s + parseFloat(b.actual_qty || b.planned_qty || 0), 0));
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{ label: 'Produced Qty', data, borderColor: '#d97706', tension: 0.3 }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart);
  }
}

// ─── 4. PROCESS PERFORMANCE & TRACKING VIEW ──────────────────
async function renderProcessTab(viewport, allProcessLogs, batches, prodMap) {
  // Aggregate completed process steps cycle durations
  const processDurations = {};
  allProcessLogs.filter(l => l.step_status === 'Completed' && l.started_at && l.completed_at).forEach(l => {
    const start = new Date(l.started_at);
    const end = new Date(l.completed_at);
    const durationMins = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMins > 0) {
      if (!processDurations[l.process_name]) processDurations[l.process_name] = [];
      processDurations[l.process_name].push(durationMins);
    }
  });

  const processedAverages = Object.entries(processDurations).map(([name, durs]) => {
    const total = durs.reduce((s,d) => s + d, 0);
    const avg = total / durs.length;
    return { name, avg, count: durs.length, max: Math.max(...durs), min: Math.min(...durs) };
  }).sort((a,b) => b.avg - a.avg);

  viewport.innerHTML = `
    <div class="card">
      <div class="card__header"><h3 class="card__title">⏱️ Average Step Completion Time (in Minutes)</h3></div>
      <div class="card__body" style="position:relative;height:300px"><canvas id="processPerformanceChart"></canvas></div>
    </div>

    <div class="card">
      <div class="card__header">
        <h3 class="card__title">🚨 Bottleneck &amp; Stage Duration Analytics</h3>
      </div>
      <div class="card__body">
        <div class="data-table">
          <table>
            <thead>
              <tr>
                <th>Process Stage Name</th>
                <th>Batches Processed</th>
                <th>Average Duration</th>
                <th>Shortest Run</th>
                <th>Longest Run (Max)</th>
              </tr>
            </thead>
            <tbody>
              ${processedAverages.length === 0 ? '<tr><td colspan="5" style="text-align:center">No completed steps with timestamps found.</td></tr>' : 
                processedAverages.map(p => `
                  <tr>
                    <td><strong>${escHtml(p.name)}</strong></td>
                    <td>${p.count}</td>
                    <td>${fmt(p.avg)} mins</td>
                    <td>${fmt(p.min)} mins</td>
                    <td class="${p.max > p.avg * 2 ? 'text--red' : ''}">${fmt(p.max)} mins</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  if (processedAverages.length > 0) {
    const Chart = await loadChartJS();
    const ctx = viewport.querySelector('#processPerformanceChart')?.getContext('2d');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: processedAverages.map(p => p.name),
          datasets: [{ label: 'Avg Duration (Mins)', data: processedAverages.map(p => p.avg), backgroundColor: '#8b5cf6' }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false
        }
      });
      registerChart(chart);
    }
  }
}

// ─── 5. INVENTORY & WAREHOUSES VIEW ───────────────────────────
async function renderInventoryTab(viewport, allBalances, allStockIn, allStockOut, allUnits) {
  const lowStock = allBalances.filter(b => {
    return parseFloat(b.current_balance || 0) < 50; 
  }).length;

  const totalIngredients = allBalances.length;
  
  viewport.innerHTML = `
    <div class="bi-kpi-grid">
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Total Stock Ingredients</span>
        <span class="bi-kpi-card__value">${totalIngredients}</span>
        <small style="color:var(--color-text-muted)">In repository</small>
      </div>
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Low Stock Ingredients</span>
        <span class="bi-kpi-card__value" style="color:var(--color-danger)">${lowStock}</span>
        <small style="color:var(--color-text-muted)">Below standard levels</small>
      </div>
    </div>

    <div class="bi-charts-grid">
      <div class="card">
        <div class="card__header"><h3 class="card__title">🏢 Godown Stock Breakdown</h3></div>
        <div class="card__body" style="position:relative;height:240px"><canvas id="godownStockChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><h3 class="card__title">📈 Stock Transactions (In vs Out)</h3></div>
        <div class="card__body" style="position:relative;height:240px"><canvas id="stockMovementChart"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card__header"><h3 class="card__title">📊 Current Material Stock List</h3></div>
      <div class="card__body" id="inventory-stocks-table"></div>
    </div>
  `;

  const warehouseSums = {};
  allStockIn.forEach(item => {
    const whId = item.warehouse_id || 'Unknown Godown';
    warehouseSums[whId] = (warehouseSums[whId] || 0) + parseFloat(item.quantity || 0);
  });

  const Chart = await loadChartJS();
  const ctx1 = viewport.querySelector('#godownStockChart')?.getContext('2d');
  if (ctx1 && Object.keys(warehouseSums).length > 0) {
    const chart1 = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: Object.keys(warehouseSums),
        datasets: [{ data: Object.values(warehouseSums), backgroundColor: ['#0d9488', '#f59e0b', '#3b82f6', '#ec4899'] }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart1);
  }

  const ctx2 = viewport.querySelector('#stockMovementChart')?.getContext('2d');
  if (ctx2) {
    const totalIn = allStockIn.reduce((s,item) => s + parseFloat(item.quantity || 0), 0);
    const totalOut = allStockOut.reduce((s,item) => s + parseFloat(item.quantity || 0), 0);
    const chart2 = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: ['Material IN (Receipts)', 'Material OUT (Consumption)'],
        datasets: [{ label: 'Total Movement Qty', data: [totalIn, totalOut], backgroundColor: ['#10b981', '#ef4444'] }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart2);
  }

  const tableEl = viewport.querySelector('#inventory-stocks-table');
  if (tableEl) {
    new DataTable(tableEl, {
      columns: [
        { key: 'ingredient_id', label: 'Ingredient ID', sortable: true },
        { key: 'total_in', label: 'Total In', render: (v) => fmt(v) },
        { key: 'total_out', label: 'Total Out', render: (v) => fmt(v) },
        { key: 'current_balance', label: 'Current Balance', render: (v) => `<strong>${fmt(v)}</strong>` },
      ],
      data: allBalances
    });
  }
}

// ─── 6. DISPATCH TRACKING VIEW ────────────────────────────────
async function renderDispatchTab(viewport, dispatches, priorDispatches, compMap, prodMap, unitMap) {
  const completed = dispatches.filter(d => d.status === 'Delivered' || d.status === 'Completed').length;
  const pending = dispatches.filter(d => d.status !== 'Delivered' && d.status !== 'Completed').length;

  viewport.innerHTML = `
    <div class="bi-kpi-grid">
      ${renderKPICard('Dispatches Logged', calculateVariance(dispatches.length, priorDispatches.length))}
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Completed Deliveries</span>
        <span class="bi-kpi-card__value">${completed}</span>
        <small style="color:var(--color-text-muted)">Arrived at customer</small>
      </div>
      <div class="bi-kpi-card">
        <span class="bi-kpi-card__title">Pending Dispatches</span>
        <span class="bi-kpi-card__value" style="color:var(--color-warning)">${pending}</span>
        <small style="color:var(--color-text-muted)">In Transit / Scheduled</small>
      </div>
    </div>

    <div class="card">
      <div class="card__header"><h3 class="card__title">🚚 Dispatch Log Ledger</h3></div>
      <div class="card__body" id="dispatch-ledger-table"></div>
    </div>
  `;

  const tableEl = viewport.querySelector('#dispatch-ledger-table');
  if (tableEl) {
    new DataTable(tableEl, {
      columns: [
        { key: 'dispatch_id', label: 'Dispatch ID' },
        { key: 'dispatch_date', label: 'Date', sortable: true },
        { key: 'company_id', label: 'Customer', render: (v) => escHtml(compMap[v] || v) },
        { key: 'product_id', label: 'Product', render: (v) => escHtml(prodMap[v] || v) },
        { key: 'quantity', label: 'Quantity', render: (v,r) => `${fmt(v)} ${unitMap[r.unit_id] || ''}` },
        { key: 'driver_name', label: 'Driver Name' },
        { key: 'vehicle_no', label: 'Vehicle No' },
        { key: 'status', label: 'Status', render: (v) => `<span class="badge badge--${v==='Delivered'||v==='Completed'?'green':'amber'}">${v || 'In Transit'}</span>` }
      ],
      data: dispatches
    });
  }
}

// ─── 7. CUSTOMER ANALYTICS VIEW ──────────────────────────────
async function renderCustomerTab(viewport, orders, priorOrders, compMap) {
  const custSpending = {};
  orders.forEach(o => {
    custSpending[o.company_id] = (custSpending[o.company_id] || 0) + parseFloat(o.total_amount || 0);
  });

  const sortedCust = Object.entries(custSpending).map(([id, val]) => ({
    id, name: compMap[id] || id, revenue: val
  })).sort((a,b) => b.revenue - a.revenue);

  viewport.innerHTML = `
    <div class="card">
      <div class="card__header"><h3 class="card__title">🏢 Customer Value Contribution</h3></div>
      <div class="card__body" style="position:relative;height:300px"><canvas id="customerContribChart"></canvas></div>
    </div>

    <div class="card">
      <div class="card__header"><h3 class="card__title">📊 Customer Ordering Rankings</h3></div>
      <div class="card__body">
        <div class="data-table">
          <table>
            <thead>
              <tr>
                <th>Customer Company</th>
                <th>Total Orders Value (₹)</th>
                <th>Revenue Share</th>
              </tr>
            </thead>
            <tbody>
              ${sortedCust.length === 0 ? '<tr><td colspan="3" style="text-align:center">No order revenue details available.</td></tr>' : 
                sortedCust.map(c => {
                  const totalSum = orders.reduce((s,o) => s + parseFloat(o.total_amount || 0), 0);
                  const pct = totalSum > 0 ? (c.revenue / totalSum) * 100 : 0;
                  return `
                    <tr>
                      <td><strong>${escHtml(c.name)}</strong></td>
                      <td>${fmtVal(c.revenue)}</td>
                      <td>${fmt(pct)}%</td>
                    </tr>
                  `;
                }).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  if (sortedCust.length > 0) {
    const Chart = await loadChartJS();
    const ctx = viewport.querySelector('#customerContribChart')?.getContext('2d');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sortedCust.map(c => c.name),
          datasets: [{ label: 'Revenue Generated (₹)', data: sortedCust.map(c => c.revenue), backgroundColor: '#0ea5e9' }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
      registerChart(chart);
    }
  }
}

// ─── 8. PRODUCT PERFORMANCE VIEW ──────────────────────────────
async function renderProductTab(viewport, orders, batches, prodMap) {
  const prodRevenue = {};
  orders.forEach(o => {
    prodRevenue[o.product_id] = (prodRevenue[o.product_id] || 0) + parseFloat(o.total_amount || 0);
  });

  const sortedProd = Object.entries(prodRevenue).map(([id, rev]) => ({
    id, name: prodMap[id] || id, revenue: rev
  })).sort((a,b) => b.revenue - a.revenue);

  viewport.innerHTML = `
    <div class="bi-charts-grid">
      <div class="card">
        <div class="card__header"><h3 class="card__title">🏷️ Product Sales split</h3></div>
        <div class="card__body" style="position:relative;height:260px"><canvas id="productSalesSplitChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><h3 class="card__title">⚗️ Production Count by Product</h3></div>
        <div class="card__body" style="position:relative;height:260px"><canvas id="productBatchesChart"></canvas></div>
      </div>
    </div>
  `;

  const Chart = await loadChartJS();
  
  const ctx1 = viewport.querySelector('#productSalesSplitChart')?.getContext('2d');
  if (ctx1 && sortedProd.length > 0) {
    const chart1 = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: sortedProd.map(p => p.name),
        datasets: [{ data: sortedProd.map(p => p.revenue), backgroundColor: ['#ec4899', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6'] }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart1);
  }

  const ctx2 = viewport.querySelector('#productBatchesChart')?.getContext('2d');
  if (ctx2) {
    const prodBatches = {};
    batches.forEach(b => { prodBatches[b.product_id] = (prodBatches[b.product_id] || 0) + 1; });
    const sortedBatches = Object.entries(prodBatches).map(([id, cnt]) => ({ name: prodMap[id] || id, cnt }));

    const chart2 = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: sortedBatches.map(b => b.name),
        datasets: [{ label: 'Batches Made', data: sortedBatches.map(b => b.cnt), backgroundColor: '#d97706' }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    registerChart(chart2);
  }
}

// ─── 9. MEETING REVIEWS VIEW ─────────────────────────────────
async function renderReviewsTab(viewport, allSalesOrders, allBatches, allDispatches, compMap, prodMap) {
  const thisMonthRange = calculateDateRange('this-month');
  const lastMonthRange = calculateDateRange('last-month');

  const ordersThisMonth = allSalesOrders.filter(o => o.order_date >= thisMonthRange.start && o.order_date <= thisMonthRange.end);
  const ordersLastMonth = allSalesOrders.filter(o => o.order_date >= lastMonthRange.start && o.order_date <= lastMonthRange.end);

  const batchesThisMonth = allBatches.filter(b => b.batch_date >= thisMonthRange.start && b.batch_date <= thisMonthRange.end);
  const batchesLastMonth = allBatches.filter(b => b.batch_date >= lastMonthRange.start && b.batch_date <= lastMonthRange.end);

  const dispatchesThisMonth = allDispatches.filter(d => d.dispatch_date >= thisMonthRange.start && d.dispatch_date <= thisMonthRange.end);
  const dispatchesLastMonth = allDispatches.filter(d => d.dispatch_date >= lastMonthRange.start && d.dispatch_date <= lastMonthRange.end);

  const revThisMonth = ordersThisMonth.reduce((s,o) => s + parseFloat(o.total_amount || 0), 0);
  const revLastMonth = ordersLastMonth.reduce((s,o) => s + parseFloat(o.total_amount || 0), 0);

  viewport.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">👥 Executive Meeting Review Board (Month-Over-Month)</h3>
      </div>
      <div class="card__body">
        <div class="data-table">
          <table>
            <thead>
              <tr>
                <th>KPI Metric</th>
                <th>Last Month</th>
                <th>This Month (MTD)</th>
                <th>Growth / Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Sales Revenue (₹)</strong></td>
                <td>${fmtVal(revLastMonth)}</td>
                <td>${fmtVal(revThisMonth)}</td>
                <td>${renderGrowthLabel(calculateVariance(revThisMonth, revLastMonth))}</td>
              </tr>
              <tr>
                <td><strong>Sales Orders Placed</strong></td>
                <td>${ordersLastMonth.length}</td>
                <td>${ordersThisMonth.length}</td>
                <td>${renderGrowthLabel(calculateVariance(ordersThisMonth.length, ordersLastMonth.length))}</td>
              </tr>
              <tr>
                <td><strong>Production Batches Started</strong></td>
                <td>${batchesLastMonth.length}</td>
                <td>${batchesThisMonth.length}</td>
                <td>${renderGrowthLabel(calculateVariance(batchesThisMonth.length, batchesLastMonth.length))}</td>
              </tr>
              <tr>
                <td><strong>Dispatches Out</strong></td>
                <td>${dispatchesLastMonth.length}</td>
                <td>${dispatchesThisMonth.length}</td>
                <td>${renderGrowthLabel(calculateVariance(dispatchesThisMonth.length, dispatchesLastMonth.length))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderGrowthLabel(varianceObj) {
  const trend = varianceObj.diff >= 0 ? '+' : '';
  const cls = varianceObj.diff >= 0 ? 'text--green' : 'text--red';
  return `<span class="${cls}"><strong>${varianceObj.icon} ${trend}${fmt(varianceObj.pct)}%</strong></span>`;
}

// ─── 10. EXCEPTION CONTROL VIEW ──────────────────────────────
async function renderExceptionsTab(viewport, allSalesOrders, allBatches, allBalances, allProcessLogs, compMap, prodMap) {
  const delayedOrders = allSalesOrders.filter(o => {
    if (o.status === 'Dispatched' || o.status === 'Cancelled') return false;
    if (!o.expected_delivery) return false;
    return new Date(o.expected_delivery) < new Date();
  });

  const lowStock = allBalances.filter(b => parseFloat(b.current_balance || 0) < 50);
  const stepAnomalies = allProcessLogs.filter(l => l.quality_passed === 'FALSE');

  viewport.innerHTML = `
    <div class="page-header" style="padding-top:0">
      <h3 style="color:var(--color-danger);font-weight:700">🚨 Manager Exception Control Panel</h3>
      <p style="color:var(--color-text-muted)">Critical issues requiring prompt operational mitigation</p>
    </div>

    <div class="bi-charts-grid" style="grid-template-columns:1fr">
      
      <!-- Delayed Sales Orders -->
      <div class="card bi-exception-item">
        <div class="card__header" style="color:var(--color-danger)">
          <h4 class="card__title">⏳ Overdue Sales Orders (${delayedOrders.length})</h4>
        </div>
        <div class="card__body">
          ${delayedOrders.length === 0 ? '<p class="empty-msg">No overdue sales orders. Excellent! ✓</p>' : `
            <div class="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Order No</th>
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Expected Delivery</th>
                    <th>Days Delayed</th>
                  </tr>
                </thead>
                <tbody>
                  ${delayedOrders.map(o => {
                    const days = Math.round((new Date().getTime() - new Date(o.expected_delivery).getTime()) / (1000 * 60 * 60 * 24));
                    return `
                      <tr>
                        <td><strong>${escHtml(o.order_no)}</strong></td>
                        <td>${escHtml(compMap[o.company_id] || o.company_id)}</td>
                        <td>${escHtml(prodMap[o.product_id] || o.product_id)}</td>
                        <td><span class="text--red">${o.expected_delivery}</span></td>
                        <td><strong>${days} days</strong></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>

      <!-- Low Stock items -->
      <div class="card bi-exception-item bi-exception-item--warning">
        <div class="card__header" style="color:var(--color-warning)">
          <h4 class="card__title">⚠️ Low Raw Material Stock Alerts (${lowStock.length})</h4>
        </div>
        <div class="card__body">
          ${lowStock.length === 0 ? '<p class="empty-msg">All ingredients stock levels healthy. ✓</p>' : `
            <div class="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Ingredient Identifier</th>
                    <th>Available Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${lowStock.map(b => `
                    <tr>
                      <td><strong>${escHtml(b.ingredient_id)}</strong></td>
                      <td><span class="text--red"><strong>${fmt(b.current_balance)}</strong></span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>

      <!-- Failed Quality Checks -->
      <div class="card bi-exception-item">
        <div class="card__header" style="color:var(--color-danger)">
          <h4 class="card__title">❌ Failed Quality Control Checks (${stepAnomalies.length})</h4>
        </div>
        <div class="card__body">
          ${stepAnomalies.length === 0 ? '<p class="empty-msg">No failed QC checkpoints logged. ✓</p>' : `
            <div class="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Batch ID</th>
                    <th>Process Name</th>
                    <th>Completed At</th>
                  </tr>
                </thead>
                <tbody>
                  ${stepAnomalies.map(l => `
                    <tr>
                      <td><a href="#production/process-log?batch=${escHtml(l.batch_id)}" style="color:var(--color-primary);font-weight:600">${escHtml(l.batch_id)}</a></td>
                      <td><strong>${escHtml(l.process_name)}</strong></td>
                      <td>${l.completed_at ? new Date(l.completed_at).toLocaleString() : '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>

    </div>
  `;
}

// ─── CSV Export Handler ───────────────────────────────────────
function exportViewCSV(view, orders, batches, dispatches, allBalances, allProcessLogs, compMap, prodMap) {
  toast.info(`Generating export file for ${view}…`);
  try {
    switch (view) {
      case 'orders':
        downloadCSV('Sales_Orders', [
          { key: 'order_no', label: 'Order No' },
          { key: 'order_date', label: 'Date' },
          { key: 'company_id', label: 'Customer', render: (v) => compMap[v] || v },
          { key: 'product_id', label: 'Product', render: (v) => prodMap[v] || v },
          { key: 'quantity', label: 'Qty' },
          { key: 'price', label: 'Price' },
          { key: 'total_amount', label: 'Total ₹' },
          { key: 'status', label: 'Status' }
        ], orders);
        break;
      case 'production':
        downloadCSV('Production_Batches', [
          { key: 'batch_id', label: 'Batch ID' },
          { key: 'batch_date', label: 'Date' },
          { key: 'product_id', label: 'Product', render: (v) => prodMap[v] || v },
          { key: 'company_id', label: 'Company', render: (v) => compMap[v] || v },
          { key: 'planned_qty', label: 'Planned Qty' },
          { key: 'actual_qty', label: 'Actual Qty' },
          { key: 'status', label: 'Status' }
        ], batches);
        break;
      case 'dispatch':
        downloadCSV('Dispatches', [
          { key: 'dispatch_id', label: 'Dispatch ID' },
          { key: 'dispatch_date', label: 'Date' },
          { key: 'company_id', label: 'Customer', render: (v) => compMap[v] || v },
          { key: 'product_id', label: 'Product', render: (v) => prodMap[v] || v },
          { key: 'quantity', label: 'Quantity' },
          { key: 'driver_name', label: 'Driver' },
          { key: 'vehicle_no', label: 'Vehicle' },
          { key: 'status', label: 'Status' }
        ], dispatches);
        break;
      case 'inventory':
        downloadCSV('Inventory_Balances', [
          { key: 'ingredient_id', label: 'Ingredient' },
          { key: 'total_in', label: 'Stock In' },
          { key: 'total_out', label: 'Stock Out' },
          { key: 'current_balance', label: 'Balance' }
        ], allBalances);
        break;
      default:
        downloadCSV('BI_Report', [
          { key: 'order_no', label: 'Identifier' },
          { key: 'order_date', label: 'Date' },
          { key: 'total_amount', label: 'Amount' },
          { key: 'status', label: 'Status' }
        ], orders);
        break;
    }
  } catch (err) {
    toast.error('CSV Export failed: ' + err.message);
  }
}
