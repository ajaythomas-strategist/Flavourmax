// ============================================================
// modules/master/products.js — Product Management
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, getDimCache, clearDimCache } from '../../sheets-api.js';
import { SHEETS } from '../../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

export async function renderProducts(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Products</h1><p class="page-subtitle">Manage product catalogue</p></div>
      ${canEdit ? `<button class="btn btn--primary" id="add-product-btn">+ Add Product</button>` : ''}
    </div>
    <div class="card"><div class="card__body" id="products-table"></div></div>
  `;
  if (canEdit) document.getElementById('add-product-btn')?.addEventListener('click', () => openForm(null, refresh));

  async function refresh() {
    const [products, categories, units] = await Promise.all([
      readAllRows(SHEETS.PRODUCTS),
      readAllRows(SHEETS.CATEGORIES),
      readAllRows(SHEETS.UNITS),
    ]);
    const catMap  = Object.fromEntries(categories.map(c => [c.category_id, c.category_name]));
    const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.unit_name]));

    new DataTable(document.getElementById('products-table'), {
      columns: [
        { key: 'product_name',  label: 'Product', sortable: true },
        { key: 'category_id',   label: 'Category', render: (v) => escHtml(catMap[v] || v) },
        { key: 'default_unit_id', label: 'Unit', render: (v) => escHtml(unitMap[v] || v) },
        { key: 'description',   label: 'Description' },
        { key: 'is_active',     label: 'Status', render: (v) => statusBadge((v === 'TRUE' || v === true) ? 'Active' : 'Inactive') },
      ],
      data: products,
      actions: canEdit ? [
        { key: 'edit', label: 'Edit', icon: '✏', class: 'btn--ghost',
          handler: (row) => openForm(row, refresh, categories, units) },
      ] : [],
    });
    // Store for modal use
    refresh._categories = categories; refresh._units = units;
  }

  await refresh();

  async function openForm(data, onSave) {
    const cats  = refresh._categories || await readAllRows(SHEETS.CATEGORIES);
    const units = refresh._units      || await readAllRows(SHEETS.UNITS);
    const result = await formModal({
      title: data ? 'Edit Product' : 'Add Product',
      fields: [
        { name: 'product_name',    label: 'Product Name',    type: 'text',   required: true },
        { name: 'category_id',     label: 'Category',        type: 'select', required: true,
          options: cats.map(c => ({ value: c.category_id, label: c.category_name })) },
        { name: 'default_unit_id', label: 'Default Unit',    type: 'select', required: true,
          options: units.map(u => ({ value: u.unit_id, label: u.unit_name })) },
        { name: 'description',     label: 'Description',     type: 'textarea' },
      ],
      data: data || {}, submitText: data ? 'Update' : 'Add Product',
    });
    if (!result) return;
    try {
      const now = new Date().toISOString();
      if (data) {
        const rowNum = await findRowById(SHEETS.PRODUCTS, data.product_id);
        await updateFullRow(SHEETS.PRODUCTS, rowNum, { ...data, ...result, updated_at: now });
        toast.success('Product updated.');
      } else {
        const id = await generateId(SHEETS.PRODUCTS);
        await sheetsAppend(SHEETS.PRODUCTS, [[id, result.product_name, result.category_id, result.default_unit_id, result.description, 'TRUE', now, now]]);
        toast.success('Product added.');
      }
      clearDimCache(); await onSave();
    } catch (err) { toast.error(err.message); }
  }
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
