// ============================================================
// modules/master/companies.js — Company Management
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, softDelete,
         generateId, getDimCache, clearDimCache, loadDimCache } from '../../supabase-api.js';
import { SHEETS } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal, confirm } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

export async function renderCompanies(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Companies</h1>
        <p class="page-subtitle">Manage client companies and their profiles</p>
      </div>
      ${canEdit ? `<button class="btn btn--primary" id="add-company-btn">+ Add Company</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="companies-table"></div></div>
  `;

  if (canEdit) {
    container.querySelector('#add-company-btn')?.addEventListener('click', () => openCompanyForm(null, refreshTable));
  }

  let table;
  async function refreshTable() {
    const rows = await readAllRows(SHEETS.COMPANIES);
    if (!document.body.contains(container)) return;
    const tableContainer = container.querySelector('#companies-table');
    if (!tableContainer) return;

    table = new DataTable(tableContainer, {
      columns: [
        { key: 'company_name',    label: 'Company Name', sortable: true },
        { key: 'contact_person',  label: 'Contact' },
        { key: 'phone',           label: 'Phone' },
        { key: 'email',           label: 'Email' },
        { key: 'gstin',           label: 'GSTIN' },
        { key: 'is_active',       label: 'Status', render: (v) => statusBadge(v === 'TRUE' || v === true ? 'Active' : 'Inactive') },
      ],
      data: rows,
      actions: canEdit ? [
        { key: 'edit',   label: 'Edit',   icon: '✏', class: 'btn--ghost', handler: (row) => openCompanyForm(row, refreshTable) },
        { key: 'toggle', label: 'Toggle', icon: '⏻', class: 'btn--ghost', handler: (row) => toggleActive(row, refreshTable) },
      ] : [],
    });
  }

  await refreshTable();
}

async function openCompanyForm(data, onSave) {
  const fields = [
    { name: 'company_name',   label: 'Company Name',    type: 'text',  required: true },
    { name: 'contact_person', label: 'Contact Person',  type: 'text' },
    { name: 'phone',          label: 'Phone',           type: 'tel' },
    { name: 'email',          label: 'Email',           type: 'email' },
    { name: 'gstin',          label: 'GSTIN',           type: 'text', placeholder: '27AABCU9603R1ZX' },
    { name: 'address',        label: 'Address',         type: 'textarea' },
  ];
  const result = await formModal({
    title: data ? 'Edit Company' : 'Add Company',
    fields, data: data || {}, submitText: data ? 'Update' : 'Add Company',
  });
  if (!result) return;

  try {
    const now = new Date().toISOString();
    if (data) {
      const rowNum = await findRowById(SHEETS.COMPANIES, data.company_id);
      if (!rowNum) throw new Error('Record not found');
      await updateFullRow(SHEETS.COMPANIES, rowNum, { ...data, ...result, updated_at: now });
      toast.success('Company updated successfully.');
    } else {
      const id = await generateId(SHEETS.COMPANIES);
      await sheetsAppend(SHEETS.COMPANIES, [[
        id, result.company_name, result.contact_person, result.phone,
        result.email, result.address, result.gstin, 'TRUE', now, now
      ]]);
      toast.success('Company added successfully.');
    }
    clearDimCache();
    await onSave();
  } catch (err) {
    toast.error('Error: ' + err.message);
  }
}

async function toggleActive(row, onSave) {
  const action = (row.is_active === 'TRUE' || row.is_active === true) ? 'deactivate' : 'activate';
  const ok = await confirm({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} Company`, message: `Are you sure you want to ${action} "${row.company_name}"?` });
  if (!ok) return;
  try {
    const rowNum = await findRowById(SHEETS.COMPANIES, row.company_id);
    const newStatus = action === 'activate' ? 'TRUE' : 'FALSE';
    await updateFullRow(SHEETS.COMPANIES, rowNum, { ...row, is_active: newStatus, updated_at: new Date().toISOString() });
    toast.success(`Company ${action}d.`);
    clearDimCache();
    await onSave();
  } catch (err) {
    toast.error('Error: ' + err.message);
  }
}
