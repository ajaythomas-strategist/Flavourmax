// ============================================================
// modules/corrections/corrections-inbox.js
// Correction workflow — raise, approve, reject, history
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, parseSheetRows, sheetsBatchRead, readRowByNumber } from '../supabase-api.js?v=4';
import { SHEETS, COLUMNS } from '../config.js?v=4';
import { DataTable, statusBadge } from '../../components/data-table.js?v=4';
import { formModal, confirm } from '../../components/modal.js?v=4';
import { toast } from '../../components/toast.js?v=4';
import { hasPermission, getCurrentUser } from '../auth.js?v=4';

// ─── Correction Inbox (Admin/Supervisor) ─────────────────────
export async function renderCorrectionsInbox(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Corrections Inbox</h1><p class="page-subtitle">Review and approve data correction requests</p></div>
    </div>
    <div class="tab-bar">
      <button class="tab-btn tab-btn--active" data-tab="pending">Pending</button>
      <button class="tab-btn" data-tab="history">History</button>
    </div>
    <div class="card"><div class="card__body" id="corrections-table"></div></div>
  `;

  let activeTab = 'pending';
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--active'));
      btn.classList.add('tab-btn--active');
      activeTab = btn.dataset.tab;
      loadCorrections(activeTab);
    });
  });

  async function loadCorrections(tab) {
    const corrections = await readAllRows(SHEETS.CORRECTIONS);
    if (!document.body.contains(container)) return;
    const tableEl = container.querySelector('#corrections-table');
    if (!tableEl) return;
    const filtered = tab === 'pending'
      ? corrections.filter(c => c.status === 'Pending')
      : corrections.filter(c => c.status !== 'Pending');

    const canApprove = hasPermission('corrections_approve');

    new DataTable(tableEl, {
      columns: [
        { key: 'correction_id',  label: 'ID' },
        { key: 'requested_at',   label: 'Requested', sortable: true, render: (v) => v ? new Date(v).toLocaleString('en-IN') : '' },
        { key: 'requested_by',   label: 'Requested By' },
        { key: 'source_sheet',   label: 'Sheet' },
        { key: 'source_row_id',  label: 'Record ID' },
        { key: 'field_label',    label: 'Field' },
        { key: 'old_value',      label: 'Old Value', render: (v) => `<span class="value-old">${escHtml(v)}</span>` },
        { key: 'new_value',      label: 'New Value', render: (v) => `<span class="value-new">${escHtml(v)}</span>` },
        { key: 'reason',         label: 'Reason' },
        { key: 'status',         label: 'Status', render: (v) => statusBadge(v) },
      ],
      data: [...filtered].reverse(),
      actions: (canApprove && tab === 'pending') ? [
        { key: 'approve', label: 'Approve', icon: '✓', class: 'btn--success', handler: (row) => approveCorrection(row, loadCorrections.bind(null, tab)) },
        { key: 'reject',  label: 'Reject',  icon: '✕', class: 'btn--danger',  handler: (row) => rejectCorrection(row, loadCorrections.bind(null, tab)) },
      ] : [],
      emptyMessage: tab === 'pending' ? 'No pending corrections.' : 'No correction history.',
    });
  }

  await loadCorrections(activeTab);
}

// ─── Raise Correction (used from any module) ─────────────────
export async function raiseCorrection({ sheetName, recordId, fieldName, currentValue, customFields }) {
  const colsList = customFields || (COLUMNS[sheetName] || []).filter(c => !['created_at','updated_at','created_by','is_corrected','correction_ref_id'].includes(c));
  const result = await formModal({
    title: 'Request Correction',
    fields: [
      { name: 'field_name', label: 'Field to Correct', type: 'select', required: true,
        options: colsList.map(c => typeof c === 'object' ? c : { value: c, label: c.replace(/_/g,' ') }) },
      { name: 'new_value',  label: 'New Value',        type: 'text', required: true },
      { name: 'reason',     label: 'Reason',           type: 'textarea', required: true },
    ],
    data: { field_name: fieldName, new_value: currentValue },
    submitText: 'Submit Correction Request',
  });
  if (!result) return;

  try {
    const id  = await generateId(SHEETS.CORRECTIONS);
    const now = new Date().toISOString();

    // Get old value — findRowById returns the ID itself in Supabase mode
    const rowId = await findRowById(sheetName, recordId);
    let oldValue = '';
    if (rowId) {
      const rowData = await readRowByNumber(sheetName, rowId);
      if (sheetName === SHEETS.PROCESS_LOG) {
        const jsonIdx = (COLUMNS[sheetName] || []).indexOf('field_data_json');
        const jsonStr = rowData[jsonIdx >= 0 ? jsonIdx : 5] || '{}';
        try {
          const parsed = JSON.parse(jsonStr);
          oldValue = parsed[result.field_name] || '';
        } catch(e) {}
      } else {
        const colIdx = (COLUMNS[sheetName] || []).indexOf(result.field_name);
        oldValue = colIdx >= 0 ? (rowData[colIdx] || '') : '';
      }
    }

    const selectedOpt = colsList.find(c => (typeof c === 'object' ? c.value : c) === result.field_name);
    const fieldLabel = selectedOpt ? (typeof selectedOpt === 'object' ? selectedOpt.label : selectedOpt.replace(/_/g, ' ')) : result.field_name;

    await sheetsAppend(SHEETS.CORRECTIONS, [[
      id, now, getCurrentUser()?.user_id, sheetName, recordId,
      result.field_name, fieldLabel, oldValue, result.new_value, result.reason,
      'Pending', '', '', ''
    ]]);
    toast.success('Correction request submitted for approval.');
  } catch (err) { toast.error(err.message); }
}

// ─── Approve Correction ───────────────────────────────────────
async function approveCorrection(correction, onDone) {
  const ok = await confirm({
    title: 'Approve Correction',
    message: `Apply "${correction.field_label}" = "${correction.new_value}" to record ${correction.source_row_id}?`,
    confirmText: 'Approve'
  });
  if (!ok) return;
  try {
    const sheetName = correction.source_sheet;

    // Read the full record from Supabase
    const records = await readAllRows(sheetName);
    const pkCol = COLUMNS[sheetName]?.[0] || 'id';
    const record = records.find(r => String(r[pkCol]) === String(correction.source_row_id));
    if (!record) throw new Error('Source record not found. It may have been deleted.');

    // Build updated record
    const updatedRecord = { ...record };

    if (sheetName === SHEETS.PROCESS_LOG) {
      let fieldData = {};
      try { fieldData = JSON.parse(record.field_data_json || '{}'); } catch(e) {}
      fieldData[correction.field_name] = correction.new_value;
      updatedRecord.field_data_json = JSON.stringify(fieldData);
      updatedRecord.is_corrected = true;
      updatedRecord.correction_ref_id = correction.correction_id;
    } else {
      updatedRecord[correction.field_name] = correction.new_value;
      if ('is_corrected' in record) updatedRecord.is_corrected = true;
      if ('correction_ref_id' in record) updatedRecord.correction_ref_id = correction.correction_id;
    }

    // Apply update to source table
    await updateFullRow(sheetName, correction.source_row_id, updatedRecord);

    // Mark correction as Approved
    await updateFullRow(SHEETS.CORRECTIONS, correction.correction_id, {
      ...correction,
      status: 'Approved',
      reviewed_by: getCurrentUser()?.user_id,
      reviewed_at: new Date().toISOString(),
      review_note: 'Approved'
    });
    toast.success('Correction approved and applied.');
    await onDone();
  } catch (err) { toast.error('Error: ' + err.message); }
}

// ─── Reject Correction ────────────────────────────────────────
async function rejectCorrection(correction, onDone) {
  const result = await formModal({
    title: 'Reject Correction',
    fields: [{ name: 'note', label: 'Rejection Note', type: 'textarea', required: true }],
    submitText: 'Reject',
  });
  if (!result) return;
  try {
    await updateFullRow(SHEETS.CORRECTIONS, correction.correction_id, {
      ...correction,
      status: 'Rejected',
      reviewed_by: getCurrentUser()?.user_id,
      reviewed_at: new Date().toISOString(),
      review_note: result.note
    });
    toast.warning('Correction rejected.');
    await onDone();
  } catch (err) { toast.error(err.message); }
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
