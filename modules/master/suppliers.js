// ============================================================
// modules/master/suppliers.js — Suppliers / Vendors
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache } from '../supabase-api.js?v=4';
import { SHEETS } from '../config.js?v=4';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js?v=4';
import { hasPermission } from '../auth.js?v=4';

export async function renderSuppliers(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Suppliers</h1><p class="page-subtitle">Raw material vendors and suppliers</p></div>
      ${canEdit ? `<button class="btn btn--primary" id="add-supplier-btn">+ Add Supplier</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="suppliers-table"></div></div>
  `;

  if (canEdit) container.querySelector('#add-supplier-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    const suppliers = await readAllRows(SHEETS.SUPPLIERS);
    if (!document.body.contains(container)) return;
    const tableEl = container.querySelector('#suppliers-table');
    if (!tableEl) return;
    new DataTable(tableEl, {
      columns: [
        { key: 'supplier_id',     label: 'ID' },
        { key: 'supplier_name',   label: 'Supplier Name',   sortable: true },
        { key: 'contact_person',  label: 'Contact Person' },
        { key: 'phone',           label: 'Phone' },
        { key: 'email',           label: 'Email' },
        { key: 'address',         label: 'Address' },
        { key: 'is_active',       label: 'Status', render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
      ],
      data: suppliers,
      actions: canEdit ? [
        { key: 'edit',     label: 'Edit',      icon: '✏', class: 'btn--ghost',  handler: (row) => openForm(row, refresh) },
        { key: 'deactive', label: 'Deactivate', icon: '✕', class: 'btn--danger btn--ghost',
          visible: (row) => row.is_active === 'TRUE' || row.is_active === true,
          handler: (row) => toggleActive(row, false, refresh) },
        { key: 'activate', label: 'Activate',   icon: '✓', class: 'btn--success btn--ghost',
          visible: (row) => row.is_active === 'FALSE' || row.is_active === false,
          handler: (row) => toggleActive(row, true, refresh) },
      ] : [],
    });
  }
  await refresh();

  async function openForm(data, onSave) {
    const result = await formModal({
      title: data ? 'Edit Supplier' : 'Add Supplier',
      fields: [
        { name: 'supplier_name',  label: 'Supplier Name',  type: 'text',     required: true },
        { name: 'contact_person', label: 'Contact Person', type: 'text' },
        { name: 'phone',          label: 'Phone',          type: 'text' },
        { name: 'email',          label: 'Email',          type: 'email' },
        { name: 'address',        label: 'Address',        type: 'textarea' },
      ],
      data: data || {},
      submitText: data ? 'Update' : 'Add Supplier',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.SUPPLIERS, data.supplier_id);
        await updateFullRow(SHEETS.SUPPLIERS, rowNum, { ...data, ...result, updated_at: now });
        toast.success('Supplier updated.');
      } else {
        const id = await generateId(SHEETS.SUPPLIERS);
        await sheetsAppend(SHEETS.SUPPLIERS, [[
          id, result.supplier_name, result.contact_person || '', result.phone || '',
          result.email || '', result.address || '', 'TRUE', now, now
        ]]);
        toast.success('Supplier added.');
      }
      clearDimCache();
      await onSave();
    } catch (err) { toast.error(err.message); }
  }

  async function toggleActive(row, active, onSave) {
    try {
      const rowNum = await findRowById(SHEETS.SUPPLIERS, row.supplier_id);
      await updateFullRow(SHEETS.SUPPLIERS, rowNum, { ...row, is_active: active ? 'TRUE' : 'FALSE', updated_at: new Date().toISOString() });
      toast.success(active ? 'Supplier activated.' : 'Supplier deactivated.');
      clearDimCache();
      await onSave();
    } catch (err) { toast.error(err.message); }
  }
}
