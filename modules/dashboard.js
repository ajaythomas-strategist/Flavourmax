// ============================================================
// modules/dashboard.js — KPI Dashboard with Chart.js Charts
// ============================================================
import { sheetsBatchRead, parseSheetRows, activeOnly } from '../supabase-api.js';
import { SHEETS } from '../config.js';
import { toast } from '../components/toast.js';

export async function renderDashboard(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <span class="page-subtitle">Overview — ${new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</span>
    </div>
    <div class="kpi-grid" id="kpi-grid">
      ${[1,2,3,4,5,6].map(() => `<div class="kpi-card kpi-card--loading"><div class="skeleton skeleton--kpi"></div></div>`).join('')}
    </div>
    
    <div class="dashboard-charts-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:1.5rem;margin-bottom:1.5rem">
      <div class="card">
        <div class="card__header"><h3 class="card__title">📈 Quantities Timeline (Last 30 Days)</h3></div>
        <div class="card__body" style="position:relative;height:260px"><canvas id="qtyTimelineChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card__header"><h3 class="card__title">⭐ Product Sales Performance</h3></div>
        <div class="card__body" style="position:relative;height:260px"><canvas id="productPerfChart"></canvas></div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="card" id="dash-recent-batches">
        <div class="card__header">
          <h3 class="card__title">⚗ Recent Batches</h3>
          <a href="#production/batch-list" class="btn btn--ghost btn--sm">View All</a>
        </div>
        <div class="card__body"><div class="skeleton skeleton--list"></div></div>
      </div>
      <div class="card" id="dash-low-stock">
        <div class="card__header"><h3 class="card__title">⚠ Low Stock Alerts</h3></div>
        <div class="card__body"><div class="skeleton skeleton--list"></div></div>
      </div>
      <div class="card" id="dash-pending-corrections">
        <div class="card__header">
          <h3 class="card__title">✏ Pending Corrections</h3>
          <a href="#corrections/inbox" class="btn btn--ghost btn--sm">Review</a>
        </div>
        <div class="card__body"><div class="skeleton skeleton--list"></div></div>
      </div>
    </div>
  `;

  // Helper: safely set innerHTML on a container-scoped element
  const $ = (sel) => container.querySelector(sel);
  const setHtml = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    // Fetch all data with a 20-second timeout to prevent infinite loading
    const _fetchTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Dashboard data timed out. Check your Supabase connection.')), 20_000));
    
    const dashData = await Promise.race([
      sheetsBatchRead([
        `${SHEETS.PRODUCTION_BATCHES}!A:L`,
        `${SHEETS.INVENTORY_BALANCE}!A:F`,
        `${SHEETS.INGREDIENTS}!A:H`,
        `${SHEETS.DISPATCH}!A:M`,
        `${SHEETS.CORRECTIONS}!A:N`,
        `${SHEETS.PROCESS_LOG}!A:O`,
        `${SHEETS.PROCESSES}!A:G`,
        `${SHEETS.SALES}!A:P`,
        `${SHEETS.PRODUCTS}!A:H`
      ]),
      _fetchTimeout,
    ]);

    const batches      = parseSheetRows(SHEETS.PRODUCTION_BATCHES, dashData[0].values || []);
    const balances     = parseSheetRows(SHEETS.INVENTORY_BALANCE,  dashData[1].values || []);
    const ingredients  = parseSheetRows(SHEETS.INGREDIENTS,        dashData[2].values || []);
    const dispatches   = parseSheetRows(SHEETS.DISPATCH,           dashData[3].values || []);
    const corrections  = parseSheetRows(SHEETS.CORRECTIONS,        dashData[4].values || []);
    const processLogs  = parseSheetRows(SHEETS.PROCESS_LOG,        dashData[5].values || []);
    const processesAll = parseSheetRows(SHEETS.PROCESSES,          dashData[6].values || []);
    const sales        = parseSheetRows(SHEETS.SALES,              dashData[7].values || []);
    const products     = parseSheetRows(SHEETS.PRODUCTS,           dashData[8].values || []);

    const processes  = activeOnly(processesAll);
    const totalSteps = processes.length;
    const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));

    // KPIs
    const activeBatches      = batches.filter(b => b.status === 'In Progress');
    const completedBatches   = batches.filter(b => b.status === 'Completed' && b.batch_date >= monthStart).length;
    const pendingDispatches  = dispatches.filter(d => d.status !== 'Delivered').length;
    const pendingCorrections = corrections.filter(c => c.status === 'Pending').length;
    const dispatchedThisMonth = dispatches.filter(d => d.dispatch_date >= monthStart).length;

    const lowStockItems = balances.filter(b => {
      const ing = ingredients.find(i => i.ingredient_id === b.ingredient_id);
      if (!ing) return false;
      return parseFloat(b.current_balance || 0) < parseFloat(ing.min_stock_alert || 0);
    });

    // Bail out if user navigated away during the fetch
    if (!document.body.contains(container)) return;

    // ── Render KPI cards ──────────────────────────────────────
    setHtml('#kpi-grid', `
      ${kpiCard('⚗', 'Active Batches',       activeBatches.length,    'in progress now',      'kpi--blue',  '#production/batch-list')}
      ${kpiCard('✅', 'Completed This Month', completedBatches,        'batches finished',     'kpi--green')}
      ${kpiCard('⚠', 'Low Stock Alerts',     lowStockItems.length,    'items below threshold', lowStockItems.length > 0 ? 'kpi--red' : 'kpi--green', '#inventory/current-stock')}
      ${kpiCard('🚚', 'Pending Dispatches',   pendingDispatches,       'awaiting delivery',    pendingDispatches > 0 ? 'kpi--amber' : 'kpi--green', '#dispatch/dispatch-list')}
      ${kpiCard('📦', 'Dispatched This Month',dispatchedThisMonth,     'consignments sent',    'kpi--blue')}
      ${kpiCard('✏', 'Pending Corrections',  pendingCorrections,      'awaiting approval',    pendingCorrections > 0 ? 'kpi--red' : 'kpi--green', '#corrections/inbox')}
    `);

    // ── Render ChartJS Charts ──────────────────────────────────
    try {
      const Chart = await loadChartJS();
      if (!document.body.contains(container)) return;

      // 1. Quantities Timeline (Last 30 Days)
      const dateLabels = [];
      const dateMap = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const str = d.toISOString().slice(0, 10);
        dateLabels.push(str);
        dateMap[str] = { orderQty: 0, prodQty: 0, dispQty: 0 };
      }

      sales.forEach(s => {
        if (s.sale_date && dateMap[s.sale_date]) {
          dateMap[s.sale_date].orderQty += parseFloat(s.quantity || 0);
        }
      });

      batches.forEach(b => {
        if (b.batch_date && dateMap[b.batch_date]) {
          dateMap[b.batch_date].prodQty += parseFloat(b.actual_qty || b.planned_qty || 0);
        }
      });

      dispatches.forEach(d => {
        if (d.dispatch_date && dateMap[d.dispatch_date]) {
          dateMap[d.dispatch_date].dispQty += parseFloat(d.quantity || 0);
        }
      });

      const orderData = dateLabels.map(d => dateMap[d].orderQty);
      const prodData = dateLabels.map(d => dateMap[d].prodQty);
      const dispData = dateLabels.map(d => dateMap[d].dispQty);

      const displayLabels = dateLabels.map(d => {
        const parts = d.split('-');
        const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${mNames[parseInt(parts[1])-1]} ${parseInt(parts[2])}`;
      });

      const ctxTimeline = container.querySelector('#qtyTimelineChart')?.getContext('2d');
      if (ctxTimeline) {
        new Chart(ctxTimeline, {
          type: 'line',
          data: {
            labels: displayLabels,
            datasets: [
              {
                label: 'Ordered Qty',
                data: orderData,
                borderColor: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.05)',
                tension: 0.35,
                fill: true,
                borderWidth: 2
              },
              {
                label: 'Production Qty',
                data: prodData,
                borderColor: '#d97706',
                backgroundColor: 'rgba(217, 119, 6, 0.05)',
                tension: 0.35,
                fill: true,
                borderWidth: 2
              },
              {
                label: 'Dispatched Qty',
                data: dispData,
                borderColor: '#16a34a',
                backgroundColor: 'rgba(22, 163, 74, 0.05)',
                tension: 0.35,
                fill: true,
                borderWidth: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
              tooltip: { intersect: false, mode: 'index' }
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45 } },
              y: { grid: { display: false }, ticks: { font: { size: 9 } } }
            }
          }
        });
      }

      // 2. Product Sales Performance (Orders Amount)
      const productSales = {};
      sales.forEach(s => {
        const pId = s.product_id;
        if (!pId) return;
        if (!productSales[pId]) productSales[pId] = 0;
        productSales[pId] += parseFloat(s.total_amount || 0);
      });

      const topProducts = Object.entries(productSales)
        .map(([pId, val]) => ({ name: prodMap[pId] || pId, value: val }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      const ctxPerf = container.querySelector('#productPerfChart')?.getContext('2d');
      if (ctxPerf) {
        new Chart(ctxPerf, {
          type: 'bar',
          data: {
            labels: topProducts.map(p => p.name),
            datasets: [{
              label: 'Total Orders (₹)',
              data: topProducts.map(p => p.value),
              backgroundColor: [
                'rgba(2, 132, 199, 0.8)',
                'rgba(22, 163, 74, 0.8)',
                'rgba(217, 119, 6, 0.8)',
                'rgba(220, 38, 38, 0.8)',
                'rgba(147, 51, 234, 0.8)'
              ],
              borderRadius: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => ` ₹${ctx.raw.toLocaleString('en-IN')}` } }
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 } } },
              y: { grid: { display: false }, ticks: { font: { size: 9 }, callback: (v) => '₹' + v.toLocaleString('en-IN') } }
            }
          }
        });
      }
    } catch (chartErr) {
      console.warn('Chart.js render error:', chartErr);
    }

    // ── Recent Batches ────────────────────────────────────────
    const recentBatches = [...batches]
      .sort((a, b) => (b.batch_date || '').localeCompare(a.batch_date || ''))
      .slice(0, 6);

    setHtml('#dash-recent-batches .card__body',
      recentBatches.length === 0
        ? '<p class="empty-msg">No batches recorded yet.</p>'
        : `<ul class="info-list">${recentBatches.map(b => {
            const bLogs = processLogs.filter(l => l.batch_id === b.batch_id);
            const done  = bLogs.filter(l => l.step_status === 'Completed').length;
            const total = totalSteps || bLogs.length || 1;
            const pct   = Math.round((done / total) * 100);
            return `<li class="info-item" style="display:flex;flex-direction:column;gap:0.35rem;padding:0.75rem 0;border-bottom:1px solid var(--color-border)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <a href="#production/process-log?batch=${escHtml(b.batch_id)}" style="font-weight:600;color:var(--color-primary)">${escHtml(b.batch_id)}</a>
                <span class="badge badge--${statusColor(b.status)}">${escHtml(b.status)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem">
                <div style="flex:1;height:5px;background:var(--color-border);border-radius:3px;overflow:hidden">
                  <div style="width:${pct}%;height:100%;background:${pct===100?'var(--color-success)':'var(--color-primary)'};transition:width 0.4s ease"></div>
                </div>
                <small style="font-size:0.7rem;color:var(--color-text-muted);white-space:nowrap">${done}/${total} steps</small>
              </div>
            </li>`;
          }).join('')}</ul>`
    );

    // ── Low Stock ─────────────────────────────────────────────
    setHtml('#dash-low-stock .card__body',
      lowStockItems.length === 0
        ? '<p class="empty-msg">All stock levels are healthy ✓</p>'
        : `<ul class="alert-list">${lowStockItems.map(b => {
            const ing = ingredients.find(i => i.ingredient_id === b.ingredient_id);
            return `<li class="alert-item alert-item--danger">
              <span class="alert-item__name">${escHtml(ing?.ingredient_name || b.ingredient_id)}</span>
              <span class="alert-item__val">Balance: <strong>${fmtNum(b.current_balance)}</strong> (min: ${fmtNum(ing?.min_stock_alert)})</span>
            </li>`;
          }).join('')}</ul>`
    );

    // ── Pending Corrections ───────────────────────────────────
    const pendingList = corrections.filter(c => c.status === 'Pending').slice(0, 6);
    setHtml('#dash-pending-corrections .card__body',
      pendingList.length === 0
        ? '<p class="empty-msg">No pending corrections.</p>'
        : `<ul class="info-list">${pendingList.map(c => `
            <li class="info-item">
              <div>
                <span class="info-item__id">${escHtml(c.source_row_id)}</span>
                <small style="margin-left:.5rem;color:var(--color-text-muted)">${escHtml(c.field_label || c.field_name)}</small>
              </div>
              <div style="display:flex;gap:.4rem;align-items:center;font-size:0.8rem">
                <span style="text-decoration:line-through;color:var(--color-text-muted)">${escHtml(c.old_value)}</span>
                <span>→</span>
                <strong style="color:var(--color-primary)">${escHtml(c.new_value)}</strong>
                <span class="badge badge--amber" style="margin-left:.25rem">⏳ Pending</span>
              </div>
            </li>`).join('')}</ul>`
    );

  } catch (err) {
    console.error('[dashboard]', err);
    toast.error('Failed to load dashboard: ' + err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────

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

function kpiCard(icon, label, value, sub, cls = '', link = '') {
  const inner = `
    <div class="kpi-card__icon">${icon}</div>
    <div class="kpi-card__body">
      <div class="kpi-card__value">${escHtml(String(value))}</div>
      <div class="kpi-card__label">${escHtml(label)}</div>
      <div class="kpi-card__sub">${escHtml(sub)}</div>
    </div>`;
  return link
    ? `<a href="${link}" class="kpi-card ${cls}" style="text-decoration:none">${inner}</a>`
    : `<div class="kpi-card ${cls}">${inner}</div>`;
}

function fmtNum(n) { return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function statusColor(s) { return { Completed:'green', 'In Progress':'blue', Draft:'gray', Cancelled:'red' }[s] || 'gray'; }
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
