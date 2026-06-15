// ============================================================
// modules/production/batch-list.js — Production Batch List
// ============================================================
import { sheetsBatchRead, parseSheetRows, updateFullRow, findRowById, readAllRows, activeOnly } from '../../supabase-api.js';
import { SHEETS, BATCH_STATUS } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { toast } from '../../components/toast.js';
import { formModal } from '../../components/modal.js';
import { hasPermission, getCurrentUser } from '../../auth.js';
import { navigate } from '../../app.js';

export async function renderBatchList(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Production Batches</h1><p class="page-subtitle">All manufacturing batches</p></div>
      ${hasPermission('production_edit') ? `<a href="#production/new-batch" class="btn btn--primary">+ New Batch</a>` : ''}
    </div>
    <div class="filter-bar">
      <select id="bl-status-filter" class="input--sm"><option value="">All Statuses</option>
        ${Object.values(BATCH_STATUS).map(s => `<option>${escHtml(s)}</option>`).join('')}
      </select>
      <input type="date" id="bl-from" class="input--sm"><span>to</span>
      <input type="date" id="bl-to" class="input--sm">
      <button class="btn btn--ghost btn--sm" id="bl-apply">Filter</button>
    </div>
    <div class="card"><div class="card__body" id="batch-table"></div></div>
  `;

  async function loadDataAndRender() {
    const batchData = await sheetsBatchRead([
      `${SHEETS.PRODUCTION_BATCHES}!A:L`, 
      `${SHEETS.PRODUCTS}!A:H`, 
      `${SHEETS.COMPANIES}!A:J`, 
      `${SHEETS.UNITS}!A:E`,
      `${SHEETS.PROCESSES}!A:G`,
      `${SHEETS.PROCESS_LOG}!A:O`
    ]);

    if (!document.body.contains(container)) return;
    const allBatches      = parseSheetRows(SHEETS.PRODUCTION_BATCHES, batchData[0].values || []);
    const products        = parseSheetRows(SHEETS.PRODUCTS, batchData[1].values || []);
    const companies       = parseSheetRows(SHEETS.COMPANIES, batchData[2].values || []);
    const units           = parseSheetRows(SHEETS.UNITS, batchData[3].values || []);
    const allProcesses    = activeOnly(parseSheetRows(SHEETS.PROCESSES, batchData[4].values || []));
    const allLogs         = parseSheetRows(SHEETS.PROCESS_LOG, batchData[5].values || []);

    const prodMap = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));
    const compMap = Object.fromEntries(companies.map(c => [c.company_id, c.company_name]));
    const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation]));

    // Helper: get process count for a specific product
    const productProcessCount = (productId) =>
      allProcesses.filter(p => !p.product_id || p.product_id === productId).length;

    let batches = [...allBatches].reverse();

    function applyFilters() {
      const status = container.querySelector('#bl-status-filter')?.value;
      const from   = container.querySelector('#bl-from')?.value;
      const to     = container.querySelector('#bl-to')?.value;
      let filtered = [...allBatches].reverse();
      if (status) filtered = filtered.filter(b => b.status === status);
      if (from)   filtered = filtered.filter(b => b.batch_date >= from);
      if (to)     filtered = filtered.filter(b => b.batch_date <= to);
      return filtered;
    }

    function render(data) {
      const batchTableEl = container.querySelector('#batch-table');
      if (!batchTableEl) return;
      new DataTable(batchTableEl, {
        columns: [
          { key: 'batch_id',    label: 'Batch ID', sortable: true },
          { key: 'batch_date',  label: 'Date', sortable: true },
          { key: 'product_id',  label: 'Product',  render: (v) => escHtml(prodMap[v] || v) },
          { key: 'company_id',  label: 'Company',  render: (v) => escHtml(compMap[v] || v) },
          { key: 'planned_qty', label: 'Planned',  render: (v,r) => `${v} ${escHtml(unitMap[r.unit_id] || '')}` },
          { key: 'actual_qty',  label: 'Actual',   render: (v,r) => v ? `${v} ${escHtml(unitMap[r.unit_id] || '')}` : '—' },
          { key: 'status',      label: 'Status',   render: (v) => statusBadge(v) },
          { key: 'progress',    label: 'Progress', render: (v, r) => {
              const blogs = allLogs.filter(l => l.batch_id === r.batch_id);
              const done = blogs.filter(l => l.step_status === 'Completed').length;
              const total = productProcessCount(r.product_id);
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return `
                <div style="display:flex; align-items:center; gap:0.5rem; min-width:100px">
                  <div style="flex:1; height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden">
                    <div style="width:${pct}%; height:100%; background:var(--color-success)"></div>
                  </div>
                  <small style="font-size:0.75rem">${done}/${total}</small>
                </div>
              `;
            }
          },
          { key: 'created_by',  label: 'By' },
        ],
        data,
        actions: [
          { key: 'view', label: 'View', icon: '👁', class: 'btn--ghost', handler: (row) => navigate(`production/process-log?batch=${row.batch_id}`) },
          { key: 'cancel', label: 'Cancel', icon: '✕', class: 'btn--danger btn--ghost', 
            visible: (row) => row.status === BATCH_STATUS.IN_PROGRESS && hasPermission('production_edit'),
            handler: (row) => cancelBatch(row, loadDataAndRender)
          }
        ],
        onRowClick: (row) => navigate(`production/process-log?batch=${row.batch_id}`),
      });
    }

    container.querySelector('#bl-apply')?.addEventListener('click', () => render(applyFilters()));
    render(batches);
  }

  await loadDataAndRender();
}

async function cancelBatch(batch, onDone) {
  const res = await formModal({
    title: 'Cancel Batch',
    fields: [{ name: 'reason', label: 'Cancellation Reason', type: 'textarea', required: true }],
    submitText: 'Cancel Batch'
  });
  if (!res) return;

  try {
    const batchId = await findRowById(SHEETS.PRODUCTION_BATCHES, batch.batch_id);
    if (batchId) {
      const now = new Date().toISOString();
      // Update batch header
      await updateFullRow(SHEETS.PRODUCTION_BATCHES, batchId, {
        ...batch,
        status: BATCH_STATUS.CANCELLED,
        notes: (batch.notes ? batch.notes + ' | ' : '') + 'Cancelled reason: ' + res.reason,
        updated_at: now
      });

      // Update remaining log steps to Cancelled
      const allLogs = await readAllRows(SHEETS.PROCESS_LOG);
      const logs = allLogs.filter(l => l.batch_id === batch.batch_id);
      for (const l of logs) {
        if (l.step_status !== 'Completed') {
          const logId = await findRowById(SHEETS.PROCESS_LOG, l.log_id);
          if (logId) {
            await updateFullRow(SHEETS.PROCESS_LOG, logId, {
              ...l,
              step_status: 'Cancelled',
              completed_at: now,
              completed_by: getCurrentUser()?.full_name || 'System'
            });
          }
        }
      }
      toast.warning(`Batch ${batch.batch_id} cancelled.`);
      await onDone();
    }
  } catch (err) { toast.error(err.message); }
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
