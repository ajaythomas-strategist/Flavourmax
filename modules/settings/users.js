// ============================================================
// modules/settings/users.js — User Management (Admin Only)
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId } from '../../sheets-api.js';
import { SHEETS, ROLES } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

export async function renderUsers(container) {
  if (!hasPermission('users_manage')) {
    container.innerHTML = '<div class="page-header"><h1 class="page-title">Access Denied</h1><p>Only Admins can manage users.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">User Management</h1><p class="page-subtitle">Manage app users and their roles</p></div>
      <button class="btn btn--primary" id="add-user-btn">+ Add User</button>
    </div>
    <div class="card"><div class="card__body" id="users-table"></div></div>
  `;

  document.getElementById('add-user-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    const users = await readAllRows(SHEETS.USERS);
    new DataTable(document.getElementById('users-table'), {
      columns: [
        { key: 'user_id',   label: 'ID' },
        { key: 'full_name', label: 'Name', sortable: true },
        { key: 'email',     label: 'Email' },
        { key: 'role',      label: 'Role' },
        { key: 'is_active', label: 'Status', render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
        { key: 'created_at', label: 'Created', render: (v) => v ? new Date(v).toLocaleDateString('en-IN') : '' },
      ],
      data: users,
      actions: [
        { key: 'edit',   label: 'Edit',   icon: '✏', class: 'btn--ghost', handler: (row) => openForm(row, refresh) },
        { key: 'toggle', label: 'Toggle', icon: '⏻', class: 'btn--ghost', handler: (row) => toggleUser(row, refresh) },
      ],
    });
  }
  await refresh();

  async function openForm(data, onSave) {
    const result = await formModal({
      title: data ? 'Edit User' : 'Add User',
      fields: [
        { name: 'full_name', label: 'Full Name', type: 'text',  required: true },
        { name: 'email',     label: 'Email',     type: 'email', required: true },
        { name: 'role',      label: 'Role',      type: 'select', required: true,
          options: Object.values(ROLES).map(r => ({ value: r, label: r })) },
        ...(!data ? [{ name: 'password_hash', label: 'Initial Password', type: 'text', placeholder: 'Will be SHA-256 hashed on first login' }] : []),
      ],
      data: data || {}, submitText: data ? 'Update User' : 'Add User',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.USERS, data.user_id);
        await updateFullRow(SHEETS.USERS, rowNum, { ...data, full_name: result.full_name, email: result.email, role: result.role });
        toast.success('User updated.');
      } else {
        const id = await generateId(SHEETS.USERS);
        await sheetsAppend(SHEETS.USERS, [[id, result.full_name, result.email, result.role, result.password_hash || '', 'TRUE', now]]);
        toast.success('User added.');
      }
      await onSave();
    } catch (err) { toast.error(err.message); }
  }

  async function toggleUser(row, onSave) {
    try {
      const rowNum = await findRowById(SHEETS.USERS, row.user_id);
      const newStatus = (row.is_active === 'TRUE' || row.is_active === true) ? 'FALSE' : 'TRUE';
      await updateFullRow(SHEETS.USERS, rowNum, { ...row, is_active: newStatus });
      toast.success('User status updated.');
      await onSave();
    } catch (err) { toast.error(err.message); }
  }
}
