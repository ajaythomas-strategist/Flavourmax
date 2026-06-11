// ============================================================
// modules/master/recipes.js — Company-Specific Recipe Management
// Configure ingredient lists per company+product combination
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache, activeOnly, sheetsBatchRead, parseSheetRows } from '../../sheets-api.js';
import { SHEETS } from '../../config.js';
import { formModal, confirm, contentModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../../auth.js';

export async function renderRecipes(container) {
  const canEdit = hasPermission('master_edit');
  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Recipes</h1><p class="page-subtitle">Company-specific ingredient compositions per product</p></div>
    </div>
    <div class="card">
      <div class="card__body">
        <div class="recipe-selector">
          <div class="form-group">
            <label for="recipe-company">Company</label>
            <select id="recipe-company"><option value="">-- Select Company --</option></select>
          </div>
          <div class="form-group">
            <label for="recipe-product">Product</label>
            <select id="recipe-product"><option value="">-- Select Product --</option></select>
          </div>
          <div class="recipe-selector__actions">
            <button class="btn btn--primary" id="load-recipe-btn">Load Recipe</button>
            ${canEdit ? `<button class="btn btn--ghost" id="copy-recipe-btn" disabled>Copy From…</button>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div id="recipe-detail-card" style="display:none">
      <div class="card">
        <div class="card__header">
          <h3 class="card__title" id="recipe-card-title">Recipe</h3>
          <div class="card__header-actions">
            ${canEdit ? `<button class="btn btn--primary btn--sm" id="add-ingredient-row-btn">+ Add Ingredient</button>` : ''}
          </div>
        </div>
        <div class="card__body" id="recipe-ingredients"></div>
      </div>
    </div>
  `;

  // Load reference data
  const batchData = await sheetsBatchRead([`${SHEETS.COMPANIES}!A:J`, `${SHEETS.PRODUCTS}!A:H`, `${SHEETS.INGREDIENTS}!A:H`, `${SHEETS.UNITS}!A:E`]);
  const companies   = activeOnly(parseSheetRows(SHEETS.COMPANIES,   batchData[0].values || []));
  const products    = activeOnly(parseSheetRows(SHEETS.PRODUCTS,    batchData[1].values || []));
  const ingredients = activeOnly(parseSheetRows(SHEETS.INGREDIENTS, batchData[2].values || []));
  const units       = activeOnly(parseSheetRows(SHEETS.UNITS,       batchData[3].values || []));

  const companySelect  = document.getElementById('recipe-company');
  const productSelect  = document.getElementById('recipe-product');
  companies.forEach(c => companySelect.insertAdjacentHTML('beforeend', `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`));
  products.forEach(p => productSelect.insertAdjacentHTML('beforeend', `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`));

  let currentCompanyId = '', currentProductId = '';

  document.getElementById('load-recipe-btn')?.addEventListener('click', async () => {
    currentCompanyId = companySelect.value;
    currentProductId = productSelect.value;
    if (!currentCompanyId || !currentProductId) { toast.info('Please select both company and product.'); return; }
    await loadRecipe(currentCompanyId, currentProductId);
  });

  document.getElementById('add-ingredient-row-btn')?.addEventListener('click', () => {
    if (!currentCompanyId || !currentProductId) return;
    addIngredientRow(currentCompanyId, currentProductId, ingredients, units, () => loadRecipe(currentCompanyId, currentProductId));
  });

  document.getElementById('copy-recipe-btn')?.addEventListener('click', () => {
    if (!currentCompanyId || !currentProductId) { toast.info('Load a recipe first.'); return; }
    copyRecipeFrom(currentCompanyId, currentProductId, companies, products, ingredients, units);
  });

  async function loadRecipe(companyId, productId) {
    const company = companies.find(c => c.company_id === companyId);
    const product = products.find(p => p.product_id === productId);
    document.getElementById('recipe-card-title').textContent = `${company?.company_name} — ${product?.product_name}`;
    document.getElementById('recipe-detail-card').style.display = '';
    if (canEdit) document.getElementById('copy-recipe-btn').disabled = false;

    const allRecipes = await readAllRows(SHEETS.RECIPES);
    const isActive = (r) => r.is_active !== 'FALSE' && r.is_active !== false && r.is_active !== '0';
    const filtered = allRecipes.filter(r => r.company_id === companyId && r.product_id === productId && isActive(r));
    const detail = document.getElementById('recipe-ingredients');
    if (!detail) return;

    if (filtered.length === 0) {
      detail.innerHTML = `<div class="empty-state"><p>No recipe configured. Click "+ Add Ingredient" to start building the recipe.</p></div>`;
      return;
    }

    detail.innerHTML = `
      <table class="dt">
        <thead><tr>
          <th class="dt__th">Ingredient</th><th class="dt__th">Quantity</th>
          <th class="dt__th">Unit</th><th class="dt__th">Notes</th>
          ${canEdit ? '<th class="dt__th">Actions</th>' : ''}
        </tr></thead>
        <tbody>
          ${filtered.map(r => {
            const ing  = ingredients.find(i => i.ingredient_id === r.ingredient_id);
            const unit = units.find(u => u.unit_id === r.unit_id);
            return `<tr>
              <td class="dt__td">${escHtml(ing?.ingredient_name || r.ingredient_id)}</td>
              <td class="dt__td"><strong>${escHtml(r.quantity)}</strong></td>
              <td class="dt__td">${escHtml(unit?.abbreviation || r.unit_id)}</td>
              <td class="dt__td">${escHtml(r.notes || '')}</td>
              ${canEdit ? `<td class="dt__td dt__td--actions">
                <button class="btn btn--xs btn--ghost" data-edit-recipe="${escHtml(r.recipe_id)}">✏</button>
                <button class="btn btn--xs btn--danger" data-remove-recipe="${escHtml(r.recipe_id)}">✕</button>
              </td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    detail.querySelectorAll('[data-edit-recipe]').forEach(btn => {
      const rec = filtered.find(r => r.recipe_id === btn.dataset.editRecipe);
      btn.addEventListener('click', () => editIngredientRow(rec, ingredients, units, () => loadRecipe(companyId, productId)));
    });

    detail.querySelectorAll('[data-remove-recipe]').forEach(btn => {
      const rec = filtered.find(r => r.recipe_id === btn.dataset.removeRecipe);
      btn.addEventListener('click', async () => {
        const ok = await confirm({ title: 'Remove Ingredient', message: `Remove this ingredient from the recipe?`, danger: true });
        if (!ok) return;
        const rowNum = await findRowById(SHEETS.RECIPES, rec.recipe_id);
        await updateFullRow(SHEETS.RECIPES, rowNum, { ...rec, is_active: 'FALSE', updated_at: new Date().toISOString() });
        toast.success('Ingredient removed.'); clearDimCache();
        loadRecipe(companyId, productId);
      });
    });
  }
}

async function addIngredientRow(companyId, productId, ingredients, units, onSave) {
  const result = await formModal({
    title: 'Add Ingredient to Recipe',
    fields: [
      { name: 'ingredient_id', label: 'Ingredient', type: 'select', required: true, options: ingredients.map(i => ({ value: i.ingredient_id, label: i.ingredient_name })) },
      { name: 'quantity',      label: 'Quantity',   type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'unit_id',       label: 'Unit',       type: 'select', required: true, options: units.map(u => ({ value: u.unit_id, label: `${u.unit_name} (${u.abbreviation})` })) },
      { name: 'notes',         label: 'Notes',      type: 'text' },
    ],
    submitText: 'Add Ingredient',
  });
  if (!result) return;
  try {
    const id = await generateId(SHEETS.RECIPES);
    const now = new Date().toISOString();
    await sheetsAppend(SHEETS.RECIPES, [[id, companyId, productId, result.ingredient_id, result.quantity, result.unit_id, result.notes, 'TRUE', now, now]]);
    toast.success('Ingredient added to recipe.'); clearDimCache(); await onSave();
  } catch (err) { toast.error(err.message); }
}

async function editIngredientRow(rec, ingredients, units, onSave) {
  const result = await formModal({
    title: 'Edit Recipe Ingredient',
    fields: [
      { name: 'ingredient_id', label: 'Ingredient', type: 'select', required: true, options: ingredients.map(i => ({ value: i.ingredient_id, label: i.ingredient_name })) },
      { name: 'quantity',      label: 'Quantity',   type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'unit_id',       label: 'Unit',       type: 'select', required: true, options: units.map(u => ({ value: u.unit_id, label: `${u.unit_name} (${u.abbreviation})` })) },
      { name: 'notes',         label: 'Notes',      type: 'text' },
    ],
    data: rec, submitText: 'Update',
  });
  if (!result) return;
  try {
    const rowNum = await findRowById(SHEETS.RECIPES, rec.recipe_id);
    await updateFullRow(SHEETS.RECIPES, rowNum, { ...rec, ...result, updated_at: new Date().toISOString() });
    toast.success('Recipe updated.'); clearDimCache(); await onSave();
  } catch (err) { toast.error(err.message); }
}

async function copyRecipeFrom(toCompanyId, productId, companies, products, ingredients, units) {
  const result = await formModal({
    title: 'Copy Recipe From Another Company',
    fields: [
      { name: 'from_company_id', label: 'Copy From Company', type: 'select', required: true,
        options: companies.filter(c => c.company_id !== toCompanyId).map(c => ({ value: c.company_id, label: c.company_name })) },
    ],
    submitText: 'Copy Recipe',
  });
  if (!result) return;
  try {
    const allRecipes = await readAllRows(SHEETS.RECIPES);
    const sourceRecipes = allRecipes.filter(r => r.company_id === result.from_company_id && r.product_id === productId && r.is_active !== 'FALSE' && r.is_active !== false);
    if (sourceRecipes.length === 0) { toast.warning('No recipe found for selected company+product.'); return; }
    const now = new Date().toISOString();
    for (const rec of sourceRecipes) {
      const newId = await generateId(SHEETS.RECIPES);
      await sheetsAppend(SHEETS.RECIPES, [[newId, toCompanyId, productId, rec.ingredient_id, rec.quantity, rec.unit_id, rec.notes, 'TRUE', now, now]]);
    }
    toast.success(`Copied ${sourceRecipes.length} ingredients.`);
    clearDimCache();
  } catch (err) { toast.error(err.message); }
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
