// ============================================================
// modules/master/recipes.js — Company-Specific Recipe Management
// Configure ingredient lists per company+product combination
// ============================================================
import { readAllRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache, activeOnly, sheetsBatchRead, parseSheetRows } from '../supabase-api.js';
import { SHEETS } from '../config.js';
import { formModal, confirm, contentModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../auth.js';

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
            <label>Company</label>
            <div style="position:relative">
              <input type="text" id="recipe-company-text" placeholder="Type to search company…"
                autocomplete="off" style="width:100%">
              <input type="hidden" id="recipe-company-val">
              <div id="company-dropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;z-index:200;
                background:#fff;border:1px solid #d1d5db;border-radius:8px;
                box-shadow:0 4px 16px rgba(0,0,0,.12);max-height:220px;overflow-y:auto"></div>
            </div>
          </div>
          <div class="form-group">
            <label>Product</label>
            <div style="position:relative">
              <input type="text" id="recipe-product-text" placeholder="Type to search product…"
                autocomplete="off" style="width:100%">
              <input type="hidden" id="recipe-product-val">
              <div id="product-dropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;z-index:200;
                background:#fff;border:1px solid #d1d5db;border-radius:8px;
                box-shadow:0 4px 16px rgba(0,0,0,.12);max-height:220px;overflow-y:auto"></div>
            </div>
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

  if (!document.body.contains(container)) return; // navigated away during fetch

  // Init searchable comboboxes
  initCombobox(
    container.querySelector('#recipe-company-text'),
    container.querySelector('#recipe-company-val'),
    container.querySelector('#company-dropdown'),
    companies.map(c => ({ value: c.company_id, label: c.company_name }))
  );
  initCombobox(
    container.querySelector('#recipe-product-text'),
    container.querySelector('#recipe-product-val'),
    container.querySelector('#product-dropdown'),
    products.map(p => ({ value: p.product_id, label: p.product_name }))
  );

  let currentCompanyId = '', currentProductId = '';

  container.querySelector('#load-recipe-btn')?.addEventListener('click', async () => {
    currentCompanyId = container.querySelector('#recipe-company-val').value;
    currentProductId = container.querySelector('#recipe-product-val').value;
    if (!currentCompanyId || !currentProductId) { toast.info('Please select both company and product.'); return; }
    await loadRecipe(currentCompanyId, currentProductId);
  });

  container.querySelector('#add-ingredient-row-btn')?.addEventListener('click', () => {
    if (!currentCompanyId || !currentProductId) return;
    addIngredientRow(currentCompanyId, currentProductId, ingredients, units, () => loadRecipe(currentCompanyId, currentProductId));
  });

  container.querySelector('#copy-recipe-btn')?.addEventListener('click', () => {
    if (!currentCompanyId || !currentProductId) { toast.info('Load a recipe first.'); return; }
    copyRecipeFrom(currentCompanyId, currentProductId, companies, products, ingredients, units);
  });

  async function loadRecipe(companyId, productId) {
    const company = companies.find(c => c.company_id === companyId);
    const product = products.find(p => p.product_id === productId);
    const titleEl = container.querySelector('#recipe-card-title');
    if (titleEl) titleEl.textContent = `${company?.company_name} — ${product?.product_name}`;
    const detailCard = container.querySelector('#recipe-detail-card');
    if (detailCard) detailCard.style.display = '';
    const copyBtn = container.querySelector('#copy-recipe-btn');
    if (canEdit && copyBtn) copyBtn.disabled = false;

    const allRecipes = await readAllRows(SHEETS.RECIPES);
    const isActive = (r) => r.is_active !== 'FALSE' && r.is_active !== false && r.is_active !== '0';
    const filtered = allRecipes.filter(r => r.company_id === companyId && r.product_id === productId && isActive(r));
    const detail = container.querySelector('#recipe-ingredients');
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

// ── Searchable combobox ───────────────────────────────────────
// items = [{ value, label }]
function initCombobox(textInput, hiddenInput, dropdown, items) {
  if (!textInput || !hiddenInput || !dropdown) return;

  const itemStyle = 'padding:0.5rem 0.75rem;font-size:0.875rem;cursor:pointer;border-bottom:1px solid #f3f4f6';

  function renderDropdown(query) {
    const q = query.trim().toLowerCase();
    const filtered = q === ''
      ? items
      : items.filter(it => it.label.toLowerCase().includes(q));

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div style="${itemStyle};color:var(--color-text-muted);cursor:default">No results found</div>`;
    } else {
      dropdown.innerHTML = filtered.map(it => {
        // Bold the matching portion
        const idx = it.label.toLowerCase().indexOf(q);
        const highlighted = q && idx !== -1
          ? escHtml(it.label.slice(0, idx))
            + `<strong>${escHtml(it.label.slice(idx, idx + q.length))}</strong>`
            + escHtml(it.label.slice(idx + q.length))
          : escHtml(it.label);
        return `<div class="combo-item" data-value="${escHtml(it.value)}" data-label="${escHtml(it.label)}"
          style="${itemStyle}">${highlighted}</div>`;
      }).join('');
    }

    dropdown.querySelectorAll('.combo-item').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.background = '#f0f9f6');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('mousedown', e => {
        e.preventDefault(); // keep focus on input
        hiddenInput.value = el.dataset.value;
        textInput.value   = el.dataset.label;
        closeDropdown();
        textInput.dispatchEvent(new Event('combo:select'));
      });
    });
  }

  function openDropdown() {
    renderDropdown(textInput.value);
    dropdown.style.display = '';
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
  }

  textInput.addEventListener('focus',  () => openDropdown());
  textInput.addEventListener('input',  () => {
    hiddenInput.value = ''; // clear value if user edits text
    renderDropdown(textInput.value);
    dropdown.style.display = '';
  });
  textInput.addEventListener('blur', () => setTimeout(closeDropdown, 160));

  // Keyboard: arrow up/down to navigate, Enter to select, Escape to close
  textInput.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('.combo-item')];
    const active = dropdown.querySelector('.combo-item--active');
    let idx = items.indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('combo-item--active');
      const next = items[Math.min(idx + 1, items.length - 1)];
      if (next) { next.classList.add('combo-item--active'); next.style.background = '#f0f9f6'; next.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('combo-item--active');
      const prev = items[Math.max(idx - 1, 0)];
      if (prev) { prev.classList.add('combo-item--active'); prev.style.background = '#f0f9f6'; prev.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) { active.dispatchEvent(new MouseEvent('mousedown')); }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });
}

function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
