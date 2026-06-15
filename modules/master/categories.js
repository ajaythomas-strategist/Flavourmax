// ============================================================
// modules/master/categories.js — Product Categories
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache } from '../supabase-api.js?v=4';
import { SHEETS } from '../config.js?v=4';
import { DataTable, statusBadge } from '../../components/data-table.js?v=4';
import { formModal } from '../../components/modal.js?v=4';
import { toast } from '../../components/toast.js?v=4';
import { hasPermission } from '../auth.js?v=4';

export async function renderCategories(container) {
  const canEdit = hasPermission('master_edit');

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Categories</h1><p class="page-subtitle">Product categories (Pickles, Rice Products, Brine, etc.)</p></div>
      ${canEdit ? `<button class="btn btn--primary" id="add-cat-btn">+ Add Category</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="cat-table"></div></div>
  `;

  container.querySelector('#add-cat-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    const categories = await readAllRows(SHEETS.CATEGORIES);
    if (!document.body.contains(container)) return;

    const tableEl = container.querySelector('#cat-table');
    if (!tableEl) return;

    new DataTable(tableEl, {
      columns: [
        { key: 'category_name', label: 'Category Name', sortable: true },
        { key: 'description',   label: 'Description' },
        { key: 'is_active',     label: 'Status', render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
      ],
      data: categories,
      actions: canEdit ? [
        { key: 'edit',   label: 'Edit',   icon: '✏', class: 'btn--ghost', handler: (row) => openForm(row, refresh) },
        { key: 'toggle', label: 'Toggle', icon: '⏻', class: 'btn--ghost', handler: (row) => toggleCategory(row, refresh) },
      ] : [],
      emptyMessage: 'No categories yet. Click "+ Add Category" to create one.',
    });
  }
  await refresh();

  async function openForm(data, onSave) {
    const result = await formModal({
      title: data ? 'Edit Category' : 'Add Category',
      fields: [
        { name: 'category_name', label: 'Category Name', type: 'text',     required: true, placeholder: 'e.g. Pickles' },
        { name: 'description',   label: 'Description',   type: 'textarea',                 placeholder: 'Brief description (optional)' },
      ],
      data: data || {},
      submitText: data ? 'Update' : 'Add Category',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.CATEGORIES, data.category_id);
        await updateFullRow(SHEETS.CATEGORIES, rowNum, {
          ...data,
          category_name: result.category_name,
          description:   result.description || '',
        });
        toast.success('Category updated.');
      } else {
        const id = await generateId(SHEETS.CATEGORIES);
        await sheetsAppend(SHEETS.CATEGORIES, [[
          id, result.category_name, result.description || '', 'TRUE', now
        ]]);
        toast.success('Category added.');
      }
      clearDimCache();
      await onSave();
    } catch (err) { toast.error(err.message); }
  }

  async function toggleCategory(row, onSave) {
    try {
      const rowNum = await findRowById(SHEETS.CATEGORIES, row.category_id);
      const newStatus = (row.is_active === 'TRUE' || row.is_active === true) ? 'FALSE' : 'TRUE';
      await updateFullRow(SHEETS.CATEGORIES, rowNum, { ...row, is_active: newStatus });
      toast.success('Category status updated.');
      clearDimCache();
      await onSave();
    } catch (err) { toast.error(err.message); }
  }
}
