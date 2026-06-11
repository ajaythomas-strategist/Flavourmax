// ============================================================
// modules/master/ingredients.js — Ingredient Management
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache } from '../../sheets-api.js';
import { SHEETS } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

export async function renderIngredients(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Ingredients</h1><p class="page-subtitle">Raw materials and stock alert levels</p></div>
      ${canEdit ? `<button class="btn btn--primary" id="add-ing-btn">+ Add Ingredient</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="ingredients-table"></div></div>
  `;
  if (canEdit) container.querySelector('#add-ing-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    const [ingredients, units] = await Promise.all([readAllRows(SHEETS.INGREDIENTS), readAllRows(SHEETS.UNITS)]);
    if (!document.body.contains(container)) return;
    const tableEl = container.querySelector('#ingredients-table');
    if (!tableEl) return;
    const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.unit_name]));
    new DataTable(tableEl, {
      columns: [
        { key: 'ingredient_name', label: 'Ingredient', sortable: true },
        { key: 'category',        label: 'Category' },
        { key: 'unit_id',         label: 'Unit', render: (v) => escHtml(unitMap[v] || v) },
        { key: 'min_stock_alert', label: 'Min Stock Alert', render: (v) => `<strong>${v}</strong>` },
        { key: 'is_active',       label: 'Status', render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
      ],
      data: ingredients,
      actions: canEdit ? [
        { key: 'edit', label: 'Edit', icon: '✏', class: 'btn--ghost',
          handler: (row) => openForm(row, refresh, units) },
      ] : [],
    });
    refresh._units = units;
  }

  await refresh();

  async function openForm(data, onSave) {
    const units = refresh._units || await readAllRows(SHEETS.UNITS);
    const result = await formModal({
      title: data ? 'Edit Ingredient' : 'Add Ingredient',
      fields: [
        { name: 'ingredient_name', label: 'Ingredient Name', type: 'text',   required: true },
        { name: 'category',        label: 'Category',        type: 'text',   placeholder: 'e.g. Spice, Salt, Oil' },
        { name: 'unit_id',         label: 'Unit',            type: 'select', required: true,
          options: units.map(u => ({ value: u.unit_id, label: u.unit_name })) },
        { name: 'min_stock_alert', label: 'Min Stock Alert', type: 'number', min: 0 },
      ],
      data: data || {}, submitText: data ? 'Update' : 'Add',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.INGREDIENTS, data.ingredient_id);
        await updateFullRow(SHEETS.INGREDIENTS, rowNum, { ...data, ...result, updated_at: now });
        toast.success('Ingredient updated.');
      } else {
        const id = await generateId(SHEETS.INGREDIENTS);
        await sheetsAppend(SHEETS.INGREDIENTS, [[id, result.ingredient_name, result.unit_id, result.category, result.min_stock_alert || 0, 'TRUE', now, now]]);
        toast.success('Ingredient added.');
      }
      clearDimCache(); await onSave();
    } catch (err) { toast.error(err.message); }
  }
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
