// ============================================================
// modules/production/process-log.js — Dynamic Process Logging
// Sequential Process Stepper with Input/Output Tracking
// ============================================================
import { sheetsAppend, findRowById, updateFullRow, generateId, sheetsBatchRead, parseSheetRows, readAllRows, activeOnly } from '../../supabase-api.js';
import { SHEETS, BATCH_STATUS } from '../../config.js';
import { toast } from '../../components/toast.js';
import { confirm, alert, formModal } from '../../components/modal.js';
import { hasPermission, getCurrentUser } from '../../auth.js';
import { navigate } from '../../app.js';
import { raiseCorrection } from '../corrections/corrections-inbox.js';

let _autoSaveTimer = null;
let _renderController = null;  // AbortController for stale-render protection

export async function renderProcessLog(container, params = {}) {
  // Abort any stale previous render's listeners
  if (_renderController) _renderController.abort();
  _renderController = new AbortController();
  const { signal } = _renderController;

  const batchId = params.batch || new URLSearchParams(window.location.hash.split('?')[1] || '').get('batch');

  // Clear any existing autosave timer
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }

  if (!batchId) {
    container.innerHTML = '<div class="page-header"><h1 class="page-title">No batch selected.</h1><p><a href="#production/batch-list">← Back to Batch List</a></p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Batch Process Pipeline</h1>
        <p class="page-subtitle">Batch: <strong>${escHtml(batchId)}</strong></p>
      </div>
      <a href="#production/batch-list" class="btn btn--ghost">← All Batches</a>
    </div>
    <div id="batch-status-bar"></div>
    <div id="process-stepper" class="process-stepper"></div>
    <div id="batch-actions" class="batch-actions" style="display:none"></div>
  `;

  const batchData = await sheetsBatchRead([
    `${SHEETS.PRODUCTION_BATCHES}!A:L`,     // 0
    `${SHEETS.PROCESSES}!A:G`,              // 1
    `${SHEETS.PROCESS_FIELDS}!A:I`,         // 2
    `${SHEETS.PROCESS_LOG}!A:O`,            // 3 — A:O for 15 columns
    `${SHEETS.PRODUCTS}!A:H`,               // 4
    `${SHEETS.COMPANIES}!A:J`,              // 5
    `${SHEETS.CORRECTIONS}!A:N`,            // 6
    `${SHEETS.UNITS}!A:E`,                  // 7
  ]);

  const batches         = parseSheetRows(SHEETS.PRODUCTION_BATCHES, batchData[0].values || []);
  const allProcessesRaw = activeOnly(parseSheetRows(SHEETS.PROCESSES, batchData[1].values || []));
  const allFields    = activeOnly(parseSheetRows(SHEETS.PROCESS_FIELDS, batchData[2].values || []));
  const logs         = parseSheetRows(SHEETS.PROCESS_LOG, batchData[3].values || []).filter(l => l.batch_id === batchId);
  const products     = parseSheetRows(SHEETS.PRODUCTS, batchData[4].values || []);
  const companies    = parseSheetRows(SHEETS.COMPANIES, batchData[5].values || []);
  const corrections  = parseSheetRows(SHEETS.CORRECTIONS, batchData[6].values || []).filter(c => c.source_sheet === SHEETS.PROCESS_LOG);
  const units        = parseSheetRows(SHEETS.UNITS, batchData[7].values || []);
  const unitMap      = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation || u.unit_name]));

  const batch  = batches.find(b => b.batch_id === batchId);
  if (!batch) {
    container.innerHTML = '<div class="page-header"><h1 class="page-title">Batch not found.</h1></div>';
    return;
  }

  // Only show processes for this batch's product (or universal processes with no product_id)
  const processes = allProcessesRaw
    .filter(p => !p.product_id || p.product_id === batch.product_id)
    .sort((a, b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));

  const product = products.find(p => p.product_id === batch.product_id);
  const company = companies.find(c => c.company_id === batch.company_id);
  const canEdit = hasPermission('production_edit') && batch.status !== BATCH_STATUS.COMPLETED && batch.status !== BATCH_STATUS.CANCELLED;

  // ── Status Bar ────────────────────────────────────────────
  const statusBarEl = container.querySelector('#batch-status-bar');
  if (!statusBarEl) return; // navigated away during fetch
  statusBarEl.innerHTML = `
    <div class="batch-info-bar">
      <div class="batch-info-item"><span class="label">Product</span><span>${escHtml(product?.product_name || batch.product_id)}</span></div>
      <div class="batch-info-item"><span class="label">Company</span><span>${escHtml(company?.company_name || batch.company_id)}</span></div>
      <div class="batch-info-item"><span class="label">Date</span><span>${escHtml(batch.batch_date)}</span></div>
      <div class="batch-info-item"><span class="label">Planned Qty</span><span>${escHtml(batch.planned_qty)} ${escHtml(unitMap[batch.unit_id] || '')}</span></div>
      <div class="batch-info-item"><span class="label">Status</span><span class="badge badge--${statusColor(batch.status)}">${escHtml(batch.status)}</span></div>
    </div>
  `;

  // Use container.querySelector so we're scoped to the current render, not the global document.
  // Clear first — if a stale render also runs, clearing before appending ensures
  // only ONE set of steps ends up in the DOM.
  const stepper = container.querySelector('#process-stepper');
  if (stepper) stepper.innerHTML = '';

  // Unit options for output dropdown
  const unitOptionsHtml = units.map(u =>
    `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`
  ).join('');

  // ── Render Steps ──────────────────────────────────────────
  processes.forEach((proc, idx) => {
    const log = logs.find(l => l.process_id === proc.process_id);
    const stepStatus = log ? log.step_status : (idx === 0 ? 'Active' : 'Locked');

    const fields = allFields.filter(f => f.process_id === proc.process_id).sort((a,b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));
    let fieldValues = {};
    if (log && log.field_data_json) {
      try { fieldValues = JSON.parse(log.field_data_json); } catch(e) {}
    }

    // Determine input for this step
    let inputQty  = '';
    let inputUnit = '';
    if (idx === 0) {
      inputQty  = batch.planned_qty || '';
      inputUnit = batch.unit_id || '';
    } else {
      const prevLog = logs.find(l => l.process_id === processes[idx - 1].process_id);
      inputQty  = prevLog?.output_qty  || '';
      inputUnit = prevLog?.output_unit || '';
    }
    const inputUnitName = unitMap[inputUnit] || inputUnit;

    // Output from this log entry (for completed steps)
    const outputQty      = log?.output_qty  || '';
    const outputUnit     = log?.output_unit || '';
    const outputUnitName = unitMap[outputUnit] || outputUnit;

    // Wastage (readonly, for completed steps)
    let wastageHtml = '';
    if (stepStatus === 'Completed' && inputQty && outputQty) {
      const w = parseFloat(inputQty) - parseFloat(outputQty);
      const pct = inputQty ? ((w / parseFloat(inputQty)) * 100).toFixed(1) : '—';
      const wColor = w > 0 ? 'var(--color-amber)' : w < 0 ? 'var(--color-danger)' : 'var(--color-success)';
      wastageHtml = `<span style="color:${wColor};font-size:0.8rem;margin-left:0.75rem">Wastage: ${w > 0 ? '+' : ''}${parseFloat(w).toFixed(2)} (${pct}%)</span>`;
    }

    const stepDiv = document.createElement('div');
    stepDiv.className = `stepper-step stepper-step--${stepStatus.toLowerCase().replace(' ', '-')}`;
    stepDiv.id = `step-container-${proc.process_id}`;

    // Correction badges
    let correctionBadgeHtml = '';
    let pendingCorr = null, completedCorr = null;
    if (log && stepStatus === 'Completed') {
      pendingCorr   = corrections.find(c => c.source_row_id === log.log_id && c.status === 'Pending');
      completedCorr = corrections.find(c => c.source_row_id === log.log_id && c.status === 'Approved');
      if (pendingCorr)   correctionBadgeHtml = `<span class="badge badge--amber" style="margin-left:0.5rem">⏳ Correction Pending</span>`;
      else if (completedCorr) correctionBadgeHtml = `<span class="badge badge--gray badge--clickable" id="corr-details-${log.log_id}" style="margin-left:0.5rem;cursor:pointer" title="Click to view correction details">✎ Corrected</span>`;
    }

    // Build form content
    const isReadOnly = stepStatus === 'Completed' || !canEdit;

    const fieldsHtml = renderFieldsCompact(fields, fieldValues, isReadOnly, unitOptionsHtml);

    // IO bar — top (Input)
    const inputBarHtml = `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;background:var(--color-bg-light);border-radius:6px;margin-bottom:0.75rem;font-size:0.875rem">
        <span style="color:var(--color-text-muted)">📥 Input:</span>
        <strong>${inputQty ? `${escHtml(String(inputQty))} ${escHtml(inputUnitName)}` : '—'}</strong>
        ${wastageHtml}
      </div>`;

    // IO bar — bottom (Output)
    let outputBarHtml = '';
    if (isReadOnly) {
      const qPassedVal = log?.quality_passed || '';
      outputBarHtml = `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;background:var(--color-bg-light);border-radius:6px;margin-top:0.75rem;font-size:0.875rem;flex-wrap:wrap">
          <span style="color:var(--color-text-muted)">📤 Output:</span>
          <strong>${outputQty ? `${escHtml(String(outputQty))} ${escHtml(outputUnitName)}` : '—'}</strong>
          <span style="color:var(--color-text-muted);margin-left:auto">Quality Check:</span>
          <span class="badge badge--${qPassedVal === 'TRUE' ? 'green' : 'red'}">${qPassedVal === 'TRUE' ? 'Passed' : 'Failed'}</span>
        </div>`;
    } else {
      const qPassedVal = log?.quality_passed || 'TRUE';
      outputBarHtml = `
        <div style="padding:0.6rem 0.75rem;background:var(--color-bg-light);border-radius:6px;margin-top:0.75rem">
          <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.875rem;flex-wrap:wrap">
            <span style="color:var(--color-text-muted)">📤 Output:</span>
            <input type="number" name="output_qty" value="${escHtml(String(outputQty))}"
              min="0.01" step="0.01" class="input--sm" style="width:100px" placeholder="Qty" required>
            <select name="output_unit" class="input--sm">
              ${units.map(u => `<option value="${escHtml(u.unit_id)}"${u.unit_id === outputUnit ? ' selected' : ''}>${escHtml(u.unit_name)}</option>`).join('')}
            </select>
            <span id="wastage-live-${proc.process_id}" style="font-size:0.8rem"></span>
            
            <div style="margin-left:auto;display:flex;align-items:center;gap:0.5rem">
              <span style="color:var(--color-text-muted)">Quality Passed?</span>
              <select name="quality_passed" class="input--sm" style="width:80px">
                <option value="TRUE"${qPassedVal === 'TRUE' ? ' selected' : ''}>Yes</option>
                <option value="FALSE"${qPassedVal === 'FALSE' ? ' selected' : ''}>No</option>
              </select>
            </div>
          </div>
        </div>`;
    }

    stepDiv.innerHTML = `
      <div class="stepper-step__header">
        <div class="stepper-step__icon">${stepStatus === 'Completed' ? '✓' : proc.sequence_order}</div>
        <div class="stepper-step__title-wrap">
          <h3 class="stepper-step__title">${escHtml(proc.process_name)} ${correctionBadgeHtml}</h3>
          <p class="stepper-step__meta">
            Status: <strong class="text--${stepStatusColor(stepStatus)}">${escHtml(stepStatus)}</strong>
            ${log && log.completed_at ? ` | Completed by ${escHtml(log.completed_by)} on ${new Date(log.completed_at).toLocaleString('en-IN')}` : ''}
          </p>
        </div>
        <div class="stepper-step__actions">
          ${stepStatus === 'Active'       && canEdit ? `<button class="btn btn--primary btn--sm start-step-btn"   data-proc-id="${proc.process_id}">Start Process</button>` : ''}
          ${stepStatus === 'In Progress'  && canEdit ? `<button class="btn btn--amber btn--sm continue-step-btn"  data-proc-id="${proc.process_id}">Continue</button>` : ''}
          ${stepStatus === 'Completed'                ? `<button class="btn btn--ghost btn--sm view-step-btn"      data-proc-id="${proc.process_id}">View Details</button>` : ''}
          ${stepStatus === 'Completed' && !pendingCorr && hasPermission('corrections_raise') ? `<button class="btn btn--ghost btn--sm request-corr-btn" data-log-id="${log.log_id}" data-proc-id="${proc.process_id}">Request Correction</button>` : ''}
        </div>
      </div>
      <div class="stepper-step__content" style="display:none" id="step-content-${proc.process_id}">
        <form class="process-form" id="form-${proc.process_id}"
              data-proc-id="${proc.process_id}"
              data-log-id="${log ? log.log_id : ''}"
              data-input-qty="${escHtml(String(inputQty))}"
              data-input-unit="${escHtml(String(inputUnit))}">
          ${inputBarHtml}
          ${fieldsHtml}
          ${outputBarHtml}
          ${!isReadOnly ? `
            <div class="form-actions" style="margin-top:1rem">
              <button type="button" class="btn btn--ghost btn--sm save-draft-btn" data-proc-id="${proc.process_id}">Save Draft</button>
              <button type="submit" class="btn btn--primary btn--sm complete-step-btn">Mark as Complete</button>
            </div>
          ` : ''}
        </form>
      </div>
    `;

    stepper.appendChild(stepDiv);

    // Bind correction badge click
    if (completedCorr) {
      setTimeout(() => {
        document.getElementById(`corr-details-${log.log_id}`)?.addEventListener('click', () => {
          alert({
            title: 'Correction Details',
            message: `<strong>Field corrected:</strong> ${escHtml(completedCorr.field_label)}<br>
                      <strong>Old Value:</strong> ${escHtml(completedCorr.old_value)}<br>
                      <strong>New Value:</strong> ${escHtml(completedCorr.new_value)}<br>
                      <strong>Reason:</strong> ${escHtml(completedCorr.reason)}<br><br>
                      Approved by ${escHtml(completedCorr.reviewed_by)} on ${new Date(completedCorr.reviewed_at).toLocaleString('en-IN')}`
          });
        });
      }, 50);
    }
  });

  // ── Step click handlers ───────────────────────────────────
  stepper.querySelectorAll('.start-step-btn, .continue-step-btn, .view-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const procId = btn.dataset.procId;
      const content = document.getElementById(`step-content-${procId}`);
      if (content.style.display === 'none') {
        content.style.display = '';
        if (btn.classList.contains('start-step-btn')) {
          startProcessStep(batchId, procId);
        }
        // Wire wastage live calc after content is shown
        const form = document.getElementById(`form-${procId}`);
        if (form) wireWastage(form, procId);
      } else {
        content.style.display = 'none';
      }
    });
  });

  // ── Correction request handlers ───────────────────────────
  stepper.querySelectorAll('.request-corr-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const logId  = btn.dataset.logId;
      const procId = btn.dataset.procId;
      const fields = allFields.filter(f => f.process_id === procId);
      await raiseCorrection({
        sheetName: SHEETS.PROCESS_LOG,
        recordId: logId,
        customFields: fields.map(f => ({ value: f.field_id, label: f.field_label }))
      });
      renderProcessLog(container, params);
    });
  });

  // ── Complete / Cancel Batch panel ─────────────────────────
  const allCompleted = processes.every(p => {
    const log = logs.find(l => l.process_id === p.process_id);
    return log && log.step_status === 'Completed';
  });

  const batchActions = container.querySelector('#batch-actions');
  if (batch.status === BATCH_STATUS.IN_PROGRESS && canEdit) {
    batchActions.style.display = '';
    batchActions.innerHTML = `
      <div class="batch-actions__bar" style="display:flex;justify-content:space-between;align-items:center;margin-top:2rem;padding:1rem;background:var(--color-bg-light);border-radius:8px">
        <div>
          ${allCompleted
            ? `<button class="btn btn--success" id="complete-batch-btn">✓ Complete Batch</button>`
            : `<span class="text--muted">All steps must be completed to close the batch.</span>`}
        </div>
        <button class="btn btn--danger btn--sm" id="cancel-batch-btn">Cancel Batch</button>
      </div>`;

    container.querySelector('#complete-batch-btn')?.addEventListener('click', async () => {
      const res = await formModal({
        title: 'Complete Batch',
        fields: [{ name: 'actual_qty', label: 'Actual Output Qty', type: 'number', required: true }],
        submitText: 'Complete Batch'
      });
      if (!res) return;
      try {
        const rowNum = await findRowById(SHEETS.PRODUCTION_BATCHES, batchId);
        if (rowNum) {
          await updateFullRow(SHEETS.PRODUCTION_BATCHES, rowNum, {
            ...batch, status: BATCH_STATUS.COMPLETED,
            actual_qty: res.actual_qty, updated_at: new Date().toISOString()
          });
          toast.success(`Batch ${batchId} completed successfully!`);
          navigate('production/batch-list');
        }
      } catch (err) { toast.error(err.message); }
    });

    container.querySelector('#cancel-batch-btn')?.addEventListener('click', async () => {
      const res = await formModal({
        title: 'Cancel Batch',
        fields: [{ name: 'reason', label: 'Cancellation Reason', type: 'textarea', required: true }],
        submitText: 'Cancel Batch'
      });
      if (!res) return;
      try {
        const rowNum = await findRowById(SHEETS.PRODUCTION_BATCHES, batchId);
        if (rowNum) {
          const now = new Date().toISOString();
          await updateFullRow(SHEETS.PRODUCTION_BATCHES, rowNum, {
            ...batch, status: BATCH_STATUS.CANCELLED,
            notes: (batch.notes ? batch.notes + ' | ' : '') + 'Cancelled reason: ' + res.reason,
            updated_at: now
          });
          for (const l of logs) {
            if (l.step_status !== 'Completed') {
              const logRowNum = await findRowById(SHEETS.PROCESS_LOG, l.log_id);
              if (logRowNum) {
                await updateFullRow(SHEETS.PROCESS_LOG, logRowNum, {
                  ...l, step_status: 'Cancelled',
                  completed_at: now, completed_by: getCurrentUser()?.full_name || 'System'
                });
              }
            }
          }
          toast.warning(`Batch ${batchId} has been cancelled.`);
          navigate('production/batch-list');
        }
      } catch (err) { toast.error(err.message); }
    });
  }

  // ── Form submit / draft handlers ──────────────────────────
  if (canEdit) {
    container.querySelectorAll('.process-form').forEach(form => {
      const procId = form.dataset.procId;
      const fields = allFields.filter(f => f.process_id === procId);

      form.addEventListener('input',  () => { form.dataset.dirty = 'true'; });
      form.addEventListener('change', () => { form.dataset.dirty = 'true'; });

      form.querySelector('.save-draft-btn')?.addEventListener('click', async () => {
        await saveFormDraft(form, fields);
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await confirm({
          title: 'Confirm Completion',
          message: 'Mark this process step as complete? This cannot be undone without a correction request.'
        });
        if (!ok) return;
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await completeProcessStep(batchId, procId, form, fields, logs, processes);
          toast.success('Process step completed successfully.');
          renderProcessLog(container, params);
        } catch (err) {
          toast.error(err.message);
          btn.disabled = false; btn.textContent = 'Mark as Complete';
        }
      });
    });

    // Autosave every 2 minutes
    _autoSaveTimer = setInterval(async () => {
      for (const form of document.querySelectorAll('.process-form[data-dirty="true"]')) {
        const procId = form.dataset.procId;
        const fields = allFields.filter(f => f.process_id === procId);
        await saveFormDraft(form, fields, true);
      }
    }, 2 * 60 * 1000);

    // Clean up on navigation
    const _cleanupOnNav = () => {
      if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
      window.removeEventListener('hashchange', _cleanupOnNav);
    };
    window.addEventListener('hashchange', _cleanupOnNav);
  }
}

// ── Wire live wastage calculation on output_qty input ────────
function wireWastage(form, procId) {
  const outputQtyInput = form.querySelector('[name="output_qty"]');
  const wastageSpan    = document.getElementById(`wastage-live-${procId}`);
  if (!outputQtyInput || !wastageSpan) return;

  const inputQty = parseFloat(form.dataset.inputQty || 0);
  const calc = () => {
    const out = parseFloat(outputQtyInput.value || 0);
    if (!out || !inputQty) { wastageSpan.textContent = ''; return; }
    const w = inputQty - out;
    const pct = ((w / inputQty) * 100).toFixed(1);
    if (w > 0) {
      wastageSpan.style.color = 'var(--color-amber)';
      wastageSpan.textContent = `Wastage: ${w.toFixed(2)} (${pct}%)`;
    } else if (w < 0) {
      wastageSpan.style.color = 'var(--color-danger)';
      wastageSpan.textContent = `Output exceeds input (${Math.abs(w).toFixed(2)} over)`;
    } else {
      wastageSpan.style.color = 'var(--color-success)';
      wastageSpan.textContent = 'No wastage';
    }
  };
  outputQtyInput.addEventListener('input', calc);
  calc(); // run once if value is pre-filled
}

// ── Start step (Active → In Progress) ────────────────────────
async function startProcessStep(batchId, procId) {
  const logs = await readAllRows(SHEETS.PROCESS_LOG);
  const log  = logs.find(l => l.batch_id === batchId && l.process_id === procId);
  if (log && log.step_status === 'Active') {
    const rowNum = await findRowById(SHEETS.PROCESS_LOG, log.log_id);
    if (rowNum) {
      await updateFullRow(SHEETS.PROCESS_LOG, rowNum, {
        ...log, step_status: 'In Progress', started_at: new Date().toISOString()
      });
      const stepDiv = document.getElementById(`step-container-${procId}`);
      if (stepDiv) {
        stepDiv.className = stepDiv.className.replace('stepper-step--active', 'stepper-step--in-progress');
        const startBtn = stepDiv.querySelector('.start-step-btn');
        if (startBtn) {
          startBtn.textContent = 'Continue';
          startBtn.classList.remove('start-step-btn', 'btn--primary');
          startBtn.classList.add('continue-step-btn', 'btn--amber');
        }
      }
    }
  }
}

// ── Save draft ────────────────────────────────────────────────
async function saveFormDraft(form, fields, isAutosave = false) {
  const logId = form.dataset.logId;
  if (!logId) return;
  const formData = new FormData(form);
  const data = {};
  fields.forEach(f => {
    data[f.field_id] = f.field_type === 'checkbox'
      ? (form.querySelector(`[name="${f.field_id}"]`)?.checked ? 'TRUE' : 'FALSE')
      : (formData.get(f.field_id) || '');
  });

  const outputQty  = formData.get('output_qty')  || '';
  const outputUnit = formData.get('output_unit') || '';
  const inputQty   = form.dataset.inputQty  || '';
  const inputUnit  = form.dataset.inputUnit || '';
  const qualityPassed = formData.get('quality_passed') || '';

  try {
    const allLogs = await readAllRows(SHEETS.PROCESS_LOG);
    const log = allLogs.find(l => l.log_id === logId);
    if (log) {
      const rowNum = await findRowById(SHEETS.PROCESS_LOG, logId);
      if (rowNum) {
        await updateFullRow(SHEETS.PROCESS_LOG, rowNum, {
          ...log,
          field_data_json: JSON.stringify(data),
          quality_passed:  qualityPassed,
          input_qty:   inputQty,
          input_unit:  inputUnit,
          output_qty:  outputQty,
          output_unit: outputUnit,
        });
        form.dataset.dirty = 'false';
        if (!isAutosave) toast.success('Draft saved successfully.');
      }
    }
  } catch (e) {
    if (!isAutosave) toast.error('Failed to save draft: ' + e.message);
  }
}

// ── Complete step ─────────────────────────────────────────────
async function completeProcessStep(batchId, procId, form, fields, logs, processes) {
  const logId   = form.dataset.logId;
  const formData = new FormData(form);
  const data    = {};

  for (const f of fields) {
    const val = f.field_type === 'checkbox'
      ? (form.querySelector(`[name="${f.field_id}"]`)?.checked ? 'TRUE' : 'FALSE')
      : (formData.get(f.field_id) || '');
    if (f.is_required === 'TRUE' && !val && f.field_type !== 'checkbox') {
      throw new Error(`Field "${f.field_label}" is required.`);
    }
    data[f.field_id] = val;
  }

  const outputQty  = formData.get('output_qty')  || '';
  const outputUnit = formData.get('output_unit') || '';
  const qualityPassed = formData.get('quality_passed') || '';
  if (!outputQty) throw new Error('Output Quantity is required to complete this step.');

  const inputQty  = form.dataset.inputQty  || '';
  const inputUnit = form.dataset.inputUnit || '';

  const now  = new Date().toISOString();
  const user = getCurrentUser()?.full_name || 'User';

  const logRowNum = await findRowById(SHEETS.PROCESS_LOG, logId);
  const log = logs.find(l => l.log_id === logId);
  if (logRowNum && log) {
    await updateFullRow(SHEETS.PROCESS_LOG, logRowNum, {
      ...log,
      step_status:     'Completed',
      field_data_json: JSON.stringify(data),
      quality_passed:  qualityPassed,
      input_qty:       inputQty,
      input_unit:      inputUnit,
      output_qty:      outputQty,
      output_unit:     outputUnit,
      completed_at:    now,
      completed_by:    user,
    });

    // Unlock next sequential step
    const currIdx = processes.findIndex(p => p.process_id === procId);
    if (currIdx >= 0 && currIdx + 1 < processes.length) {
      const nextProc = processes[currIdx + 1];
      const nextLog  = logs.find(l => l.process_id === nextProc.process_id);
      if (nextLog && nextLog.step_status === 'Locked') {
        const nextLogRowNum = await findRowById(SHEETS.PROCESS_LOG, nextLog.log_id);
        if (nextLogRowNum) {
          await updateFullRow(SHEETS.PROCESS_LOG, nextLogRowNum, {
            ...nextLog, step_status: 'Active', started_at: now
          });
        }
      }
    }
  }
}

// ── Compact 2-per-row field table ─────────────────────────────
function renderFieldsCompact(fields, fieldValues, isReadOnly, _unitOptionsHtml) {
  if (fields.length === 0) return '<p style="color:var(--color-text-muted);font-size:0.8rem;margin:0.5rem 0">No additional fields for this step.</p>';

  const thStyle = 'padding:0.4rem 0.6rem;text-align:left;font-weight:500;font-size:0.8rem;color:var(--color-text-muted);white-space:nowrap;width:1%;vertical-align:top';
  const tdStyle = 'padding:0.3rem 0.5rem;vertical-align:top';

  const rows = [];
  let i = 0;
  while (i < fields.length) {
    const f1 = fields[i];
    if (f1.field_type === 'textarea') {
      rows.push(`<tr>
        <th style="${thStyle}">${escHtml(f1.field_label)}${f1.is_required === 'TRUE' ? '<span class="req">*</span>' : ''}</th>
        <td style="${tdStyle}" colspan="3">${renderFieldInput(f1, fieldValues[f1.field_id], isReadOnly)}</td>
      </tr>`);
      i++;
    } else {
      const f2 = fields[i + 1];
      rows.push(`<tr>
        <th style="${thStyle}">${escHtml(f1.field_label)}${f1.is_required === 'TRUE' ? '<span class="req">*</span>' : ''}</th>
        <td style="${tdStyle}">${renderFieldInput(f1, fieldValues[f1.field_id], isReadOnly)}</td>
        ${f2 ? `
        <th style="${thStyle}">${escHtml(f2.field_label)}${f2.is_required === 'TRUE' ? '<span class="req">*</span>' : ''}</th>
        <td style="${tdStyle}">${renderFieldInput(f2, fieldValues[f2.field_id], isReadOnly)}</td>
        ` : '<td colspan="2"></td>'}
      </tr>`);
      i += 2;
    }
  }

  return `<table style="width:100%;border-collapse:collapse;font-size:0.875rem"><tbody>${rows.join('')}</tbody></table>`;
}

function renderFieldInput(field, currentValue = '', isReadOnly = false) {
  const req      = field.is_required === 'TRUE' ? 'required' : '';
  const name     = field.field_id;
  const disabled = isReadOnly ? 'disabled' : '';

  switch (field.field_type) {
    case 'dropdown': {
      const opts = (field.field_options || '').split(',').map(o => {
        const v = o.trim();
        return `<option value="${escHtml(v)}"${v === currentValue ? ' selected' : ''}>${escHtml(v)}</option>`;
      }).join('');
      return `<select name="${name}" ${req} ${disabled} class="input--sm" style="width:100%"><option value="">-- Select --</option>${opts}</select>`;
    }
    case 'checkbox':
      return `<label style="display:flex;align-items:center;gap:0.35rem;margin-top:0.2rem">
        <input type="checkbox" name="${name}" id="pf-${name}" ${currentValue === 'TRUE' ? 'checked' : ''} ${disabled}>
        <span>Yes</span></label>`;
    case 'textarea':
      return `<textarea name="${name}" rows="2" ${req} ${disabled} class="input--sm" style="width:100%;min-width:240px">${escHtml(currentValue)}</textarea>`;
    default:
      return `<input type="${field.field_type}" name="${name}" value="${escHtml(currentValue)}" ${req} ${disabled} class="input--sm" style="width:100%">`;
  }
}

function statusColor(s)     { return { Completed:'green', 'In Progress':'blue', Draft:'gray', Cancelled:'red' }[s] || 'gray'; }
function stepStatusColor(s) { return { Completed:'green', 'In Progress':'amber', Active:'blue', Locked:'gray', Cancelled:'red' }[s] || 'gray'; }
function escHtml(s)         { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
