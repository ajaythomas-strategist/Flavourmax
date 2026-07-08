// ============================================================
// modules/master/warehouses.js — Godown / Warehouse Management
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow,
         generateId, clearDimCache } from '../../supabase-api.js';
import { SHEETS } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal, confirm } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

export async function renderWarehouses(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Godowns / Warehouses</h1>
        <p class="page-subtitle">Manage inventory storage locations and Godowns</p>
      </div>
      ${canEdit ? `<button class="btn btn--primary" id="add-wh-btn">+ Add Godown</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="warehouses-table"></div></div>
  `;

  if (canEdit) {
    container.querySelector('#add-wh-btn')?.addEventListener('click', () => openWarehouseForm(null, refreshTable));
  }

  let table;
  async function refreshTable() {
    const rows = await readAllRows(SHEETS.WAREHOUSES);
    if (!document.body.contains(container)) return;
    const tableContainer = container.querySelector('#warehouses-table');
    if (!tableContainer) return;

    table = new DataTable(tableContainer, {
      columns: [
        { key: 'warehouse_name',  label: 'Godown Name', sortable: true },
        { key: 'location',        label: 'Location',    sortable: true },
        { key: 'is_active',       label: 'Status', render: (v) => statusBadge(v === 'TRUE' || v === true ? 'Active' : 'Inactive') },
      ],
      data: rows,
      actions: canEdit ? [
        { key: 'edit',   label: 'Edit',   icon: '✏', class: 'btn--ghost', handler: (row) => openWarehouseForm(row, refreshTable) },
        { key: 'toggle', label: 'Toggle', icon: '⏻', class: 'btn--ghost', handler: (row) => toggleActive(row, refreshTable) },
      ] : [],
    });
  }

  await refreshTable();
}

async function openWarehouseForm(data, onSave) {
  const fields = [
    { name: 'warehouse_name', label: 'Godown Name',  type: 'text', required: true },
    { name: 'location',       label: 'Location',     type: 'text' },
  ];
  const result = await formModal({
    title: data ? 'Edit Godown' : 'Add Godown',
    fields, data: data || {}, submitText: data ? 'Update' : 'Add Godown',
  });
  if (!result) return;

  try {
    const now = new Date().toISOString();
    if (data) {
      const rowNum = await findRowById(SHEETS.WAREHOUSES, data.warehouse_id);
      if (!rowNum) throw new Error('Record not found');
      await updateFullRow(SHEETS.WAREHOUSES, rowNum, { ...data, ...result });
      toast.success('Godown updated successfully.');
    } else {
      const id = await generateId(SHEETS.WAREHOUSES);
      await sheetsAppend(SHEETS.WAREHOUSES, [[
        id, result.warehouse_name, result.location, 'TRUE', now
      ]]);
      toast.success('Godown added successfully.');
    }
    clearDimCache();
    await onSave();
  } catch (err) {
    toast.error('Error: ' + err.message);
  }
}

async function toggleActive(row, onSave) {
  const action = (row.is_active === 'TRUE' || row.is_active === true) ? 'deactivate' : 'activate';
  const ok = await confirm({
    title: `${action.charAt(0).toUpperCase() + action.slice(1)} Godown`,
    message: `Are you sure you want to ${action} "${row.warehouse_name}"?`
  });
  if (!ok) return;
  try {
    const rowNum = await findRowById(SHEETS.WAREHOUSES, row.warehouse_id);
    const newStatus = action === 'activate' ? 'TRUE' : 'FALSE';
    await updateFullRow(SHEETS.WAREHOUSES, rowNum, { ...row, is_active: newStatus });
    toast.success(`Godown ${action}d successfully.`);
    clearDimCache();
    await onSave();
  } catch (err) {
    toast.error('Error: ' + err.message);
  }
}

function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
