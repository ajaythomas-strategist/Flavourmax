// ============================================================
// modules/settings/users.js — User Management (Admin / Super Admin)
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, hardDelete } from '../../supabase-api.js';
import { SHEETS, ROLES } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal, confirm } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser, isSuperAdmin, resetUserPassword } from '../../auth.js';

export async function renderUsers(container) {
  if (!hasPermission('users_manage')) {
    container.innerHTML = '<div class="page-header"><h1 class="page-title">Access Denied</h1><p>Only Admins can manage users.</p></div>';
    return;
  }

  const amISuperAdmin = isSuperAdmin();
  const currentUser   = getCurrentUser();

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">User Management</h1><p class="page-subtitle">Manage app users and their roles</p></div>
      <button class="btn btn--primary" id="add-user-btn">+ Add User</button>
    </div>
    <div class="card"><div class="card__body" id="users-table"></div></div>
  `;

  container.querySelector('#add-user-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    let users = await readAllRows(SHEETS.USERS);

    // Non-Super-Admin users never see Super Admin accounts in the list
    if (!amISuperAdmin) {
      users = users.filter(u => u.role !== 'Super Admin');
    }

    if (!document.body.contains(container)) return;
    const tableEl = container.querySelector('#users-table');
    if (!tableEl) return;

    new DataTable(tableEl, {
      columns: [
        { key: 'user_id',    label: 'ID' },
        { key: 'full_name',  label: 'Name',    sortable: true },
        { key: 'email',      label: 'Email' },
        { key: 'role',       label: 'Role',
          render: (v) => {
            const isSA = v === 'Super Admin';
            return isSA
              ? `<span style="display:inline-flex;align-items:center;gap:4px;font-weight:700;
                              color:#7c3aed;background:#ede9fe;padding:2px 8px;
                              border-radius:20px;font-size:0.8rem">👑 Super Admin</span>`
              : escHtml(v);
          }
        },
        { key: 'is_active',  label: 'Status',  render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
        { key: 'created_at', label: 'Created', render: (v) => v ? new Date(v).toLocaleDateString('en-IN') : '' },
      ],
      data: users,
      actions: [
        {
          key: 'edit',
          label: 'Edit',
          icon: '✏',
          class: 'btn--ghost',
          handler: (row) => {
            if (row.role === 'Super Admin' && !amISuperAdmin) {
              toast.error('Only Super Admin can edit Super Admin accounts.');
              return;
            }
            openForm(row, refresh);
          },
        },
        {
          key: 'resetpwd',
          label: 'Reset Password',
          icon: '🔑',
          class: 'btn--ghost',
          handler: (row) => {
            if (row.role === 'Super Admin' && !amISuperAdmin) {
              toast.error('Only Super Admin can reset Super Admin passwords.');
              return;
            }
            resetPwd(row);
          },
        },
        {
          key: 'toggle',
          label: 'Toggle',
          icon: '⏻',
          class: 'btn--ghost',
          handler: (row) => {
            if (row.role === 'Super Admin' && !amISuperAdmin) {
              toast.error('Only Super Admin can activate/deactivate Super Admin accounts.');
              return;
            }
            toggleUser(row, refresh);
          },
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: '🗑',
          class: 'btn--danger',
          handler: (row) => {
            if (row.role === 'Super Admin' && !amISuperAdmin) {
              toast.error('Only Super Admin can delete Super Admin accounts.');
              return;
            }
            deleteUser(row, refresh);
          },
        },
      ],
    });
  }
  await refresh();

  async function openForm(data, onSave) {
    // Build role options — non-Super-Admin users cannot assign the Super Admin role
    const roleOptions = Object.values(ROLES)
      .filter(r => amISuperAdmin || r !== 'Super Admin')
      .map(r => ({ value: r, label: r }));

    const result = await formModal({
      title: data ? 'Edit User' : 'Add User',
      fields: [
        { name: 'full_name', label: 'Full Name', type: 'text',   required: true },
        { name: 'email',     label: 'Email',     type: 'email',  required: true },
        { name: 'role',      label: 'Role',      type: 'select', required: true, options: roleOptions },
        ...(!data ? [{ name: 'password_hash', label: 'Initial Password', type: 'text', placeholder: 'Will be SHA-256 hashed on first login' }] : []),
      ],
      data: data || {},
      submitText: data ? 'Update User' : 'Add User',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.USERS, data.user_id);
        // Only send changed fields — do not spread data object
        await updateFullRow(SHEETS.USERS, rowNum, { full_name: result.full_name, email: result.email, role: result.role });
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
      // Only update is_active — do not spread row object
      await updateFullRow(SHEETS.USERS, rowNum, { is_active: newStatus });
      toast.success('User status updated.');
      await onSave();
    } catch (err) { toast.error(err.message); }
  }

  async function deleteUser(row, onSave) {
    if (row.user_id === currentUser?.user_id) {
      toast.error('You cannot delete your own account.');
      return;
    }
    const ok = await confirm({
      title: 'Delete User',
      message: `Permanently delete "${row.full_name}" (${row.email})? This cannot be undone.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await hardDelete(SHEETS.USERS, row.user_id);
      toast.success(`User "${row.full_name}" deleted.`);
      await onSave();
    } catch (err) { toast.error(err.message); }
  }

  async function resetPwd(row) {
    const result = await formModal({
      title: `Reset Password — ${row.full_name}`,
      fields: [
        { name: 'new_password',     label: 'New Password',     type: 'text', required: true, placeholder: 'Min. 6 characters' },
        { name: 'confirm_password', label: 'Confirm Password', type: 'text', required: true, placeholder: 'Re-enter password' },
      ],
      data: {},
      submitText: 'Reset Password',
    });
    if (!result) return;
    if (result.new_password !== result.confirm_password) {
      toast.error('Passwords do not match.');
      return;
    }
    try {
      await resetUserPassword(row.user_id, result.new_password);
      toast.success(`Password reset for ${row.full_name}.`);
    } catch (err) { toast.error(err.message); }
  }
}

function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
