// ============================================================
// modules/master/units.js — Units of Measurement
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache } from '../supabase-api.js';
import { SHEETS } from '../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../auth.js';

export async function renderUnits(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Units</h1><p class="page-subtitle">Units of measurement (kg, litre, piece, etc.)</p></div>
      ${canEdit ? `<button class="btn btn--primary" id="add-unit-btn">+ Add Unit</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="units-table"></div></div>
  `;
  if (canEdit) container.querySelector('#add-unit-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    const units = await readAllRows(SHEETS.UNITS);
    if (!document.body.contains(container)) return;
    const tableEl = container.querySelector('#units-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'unit_name',     label: 'Unit Name',     sortable: true },
        { key: 'abbreviation',  label: 'Abbreviation' },
        { key: 'is_active',     label: 'Status', render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
      ],
      data: units,
      actions: canEdit ? [
        { key: 'edit', label: 'Edit', icon: '✏', class: 'btn--ghost', handler: (row) => openForm(row, refresh) },
      ] : [],
    });
  }
  await refresh();

  async function openForm(data, onSave) {
    const result = await formModal({
      title: data ? 'Edit Unit' : 'Add Unit',
      fields: [
        { name: 'unit_name',    label: 'Unit Name',    type: 'text', required: true, placeholder: 'e.g. Kilogram' },
        { name: 'abbreviation', label: 'Abbreviation', type: 'text', required: true, placeholder: 'e.g. kg' },
      ],
      data: data || {}, submitText: data ? 'Update' : 'Add Unit',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.UNITS, data.unit_id);
        await updateFullRow(SHEETS.UNITS, rowNum, { ...data, ...result });
        toast.success('Unit updated.');
      } else {
        const id = await generateId(SHEETS.UNITS);
        await sheetsAppend(SHEETS.UNITS, [[id, result.unit_name, result.abbreviation, 'TRUE', now]]);
        toast.success('Unit added.');
      }
      clearDimCache(); await onSave();
    } catch (err) { toast.error(err.message); }
  }
}
