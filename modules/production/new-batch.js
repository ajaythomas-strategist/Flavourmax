// ============================================================
// modules/production/new-batch.js — Create Production Batch
// ============================================================
import { sheetsAppend, generateId, sheetsBatchRead, parseSheetRows, updateInventoryBalance, activeOnly } from '../../sheets-api.js';
import { SHEETS, BATCH_STATUS } from '../../config.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';
import { navigate } from '../../app.js';

export async function renderNewBatch(container) {
  if (!hasPermission('production_edit')) {
    container.innerHTML = '<div class="page-header"><h1 class="page-title">Access Denied</h1></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">New Production Batch</h1><p class="page-subtitle">Start a new manufacturing batch</p></div>
    </div>
    <div class="card" style="max-width:960px">
      <div class="card__header"><h3 class="card__title">Batch Details</h3></div>
      <div class="card__body">
        <form id="new-batch-form" novalidate>
          <div class="form-grid" style="margin-bottom:0">
            <div class="form-group">
              <label for="nb-date">Batch Date <span class="req">*</span></label>
              <input type="date" id="nb-date" name="batch_date" required value="${todayStr()}">
            </div>
            <div class="form-group">
              <label for="nb-product">Product <span class="req">*</span></label>
              <select id="nb-product" name="product_id" required><option value="">-- Select Product --</option></select>
            </div>
            <div class="form-group">
              <label for="nb-company">Company <span class="req">*</span></label>
              <select id="nb-company" name="company_id" required><option value="">-- Select Company --</option></select>
            </div>
            <div class="form-group form-group--row">
              <div class="form-group__half">
                <label for="nb-qty">Planned Quantity <span class="req">*</span></label>
                <input type="number" id="nb-qty" name="planned_qty" min="0.01" step="0.01" required>
              </div>
              <div class="form-group__half">
                <label for="nb-unit">Unit <span class="req">*</span></label>
                <select id="nb-unit" name="unit_id" required><option value="">--</option></select>
              </div>
            </div>
            <div class="form-group form-group--full">
              <label for="nb-notes">Notes</label>
              <textarea id="nb-notes" name="notes" rows="2"></textarea>
            </div>
          </div>

          <!-- Ingredient Stock-Out Table -->
          <div id="ingredient-section" style="display:none;margin-top:1.25rem">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
              <h4 style="margin:0;font-size:0.9rem;font-weight:600">Ingredients — Stock Out</h4>
              <button type="button" id="add-ing-row" class="btn btn--sm btn--ghost">+ Add Row</button>
            </div>
            <div style="overflow-x:auto">
              <table id="ing-table" style="width:100%;border-collapse:collapse;font-size:0.875rem">
                <thead>
                  <tr style="background:var(--color-bg-light)">
                    <th style="padding:0.4rem 0.5rem;text-align:left;min-width:180px">Ingredient</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:90px">Qty</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:90px">Unit</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:90px">Rate (₹)</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:90px">Total (₹)</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;min-width:140px">Warehouse</th>
                    <th style="padding:0.4rem 0.5rem;width:36px"></th>
                  </tr>
                </thead>
                <tbody id="ingredient-rows"></tbody>
              </table>
            </div>
            <p id="no-recipe-note" style="display:none;margin-top:0.5rem;font-size:0.8rem;color:var(--color-text-muted)">
              No recipe found for this product/company. Add rows manually.
            </p>
          </div>

          <div class="form-actions" style="margin-top:1.5rem">
            <button type="submit" class="btn btn--primary" id="create-batch-btn">Create Batch &amp; Start</button>
            <button type="button" class="btn btn--ghost" onclick="window.history.back()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const batchData = await sheetsBatchRead([
    `${SHEETS.PRODUCTS}!A:H`,
    `${SHEETS.COMPANIES}!A:J`,
    `${SHEETS.UNITS}!A:E`,
    `${SHEETS.INGREDIENTS}!A:H`,
    `${SHEETS.WAREHOUSES}!A:E`,
    `${SHEETS.RECIPES}!A:J`,
    `${SHEETS.PROCESSES}!A:G`,
  ]);
  const products        = activeOnly(parseSheetRows(SHEETS.PRODUCTS,    batchData[0].values || []));
  const companies       = activeOnly(parseSheetRows(SHEETS.COMPANIES,   batchData[1].values || []));
  const units           = activeOnly(parseSheetRows(SHEETS.UNITS,       batchData[2].values || []));
  const ingredients     = activeOnly(parseSheetRows(SHEETS.INGREDIENTS, batchData[3].values || []));
  const warehouses      = activeOnly(parseSheetRows(SHEETS.WAREHOUSES,  batchData[4].values || []));
  const allRecipes      = activeOnly(parseSheetRows(SHEETS.RECIPES,     batchData[5].values || []));
  const allProcesses = activeOnly(parseSheetRows(SHEETS.PROCESSES, batchData[6].values || []))
    .sort((a, b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));

  const productSelect  = document.getElementById('nb-product');
  const companySelect  = document.getElementById('nb-company');
  const unitSelect     = document.getElementById('nb-unit');

  products.forEach(p => productSelect.insertAdjacentHTML('beforeend',
    `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`));
  companies.forEach(c => companySelect.insertAdjacentHTML('beforeend',
    `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`));
  units.forEach(u => unitSelect.insertAdjacentHTML('beforeend',
    `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`));

  // ── Ingredient row helpers ────────────────────────────────
  function ingOptions(selectedId = '') {
    return ingredients.map(i =>
      `<option value="${escHtml(i.ingredient_id)}"${i.ingredient_id === selectedId ? ' selected' : ''}>${escHtml(i.ingredient_name)}</option>`
    ).join('');
  }
  function unitOptions(selectedId = '') {
    return units.map(u =>
      `<option value="${escHtml(u.unit_id)}"${u.unit_id === selectedId ? ' selected' : ''}>${escHtml(u.unit_name)}</option>`
    ).join('');
  }
  function whOptions(selectedId = '') {
    return warehouses.map(w =>
      `<option value="${escHtml(w.warehouse_id)}"${w.warehouse_id === selectedId ? ' selected' : ''}>${escHtml(w.warehouse_name)}</option>`
    ).join('');
  }

  function addRow(ingId = '', qty = '', unitId = '', warehouseId = '') {
    const tbody = document.getElementById('ingredient-rows');
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="padding:0.3rem 0.4rem">
        <select class="r-ing input--sm" style="width:100%">
          <option value="">-- Select --</option>
          ${ingOptions(ingId)}
        </select>
      </td>
      <td style="padding:0.3rem 0.4rem">
        <input type="number" class="r-qty input--sm" value="${escHtml(qty)}" min="0.01" step="0.01" style="width:80px">
      </td>
      <td style="padding:0.3rem 0.4rem">
        <select class="r-unit input--sm">
          ${unitOptions(unitId)}
        </select>
      </td>
      <td style="padding:0.3rem 0.4rem">
        <input type="number" class="r-rate input--sm" value="" min="0" step="0.01" style="width:80px" placeholder="0">
      </td>
      <td style="padding:0.3rem 0.4rem;font-weight:600" class="r-total">₹0.00</td>
      <td style="padding:0.3rem 0.4rem">
        <select class="r-wh input--sm" style="width:100%">
          <option value="">-- Godown --</option>
          ${whOptions(warehouseId)}
        </select>
      </td>
      <td style="padding:0.3rem 0.4rem;text-align:center">
        <button type="button" class="btn btn--xs btn--danger remove-row-btn" title="Remove row">×</button>
      </td>
    `;

    const qtyInput  = tr.querySelector('.r-qty');
    const rateInput = tr.querySelector('.r-rate');
    const totalCell = tr.querySelector('.r-total');
    const recalc = () => {
      const t = (parseFloat(qtyInput.value) || 0) * (parseFloat(rateInput.value) || 0);
      totalCell.textContent = '₹' + t.toFixed(2);
    };
    qtyInput.addEventListener('input', recalc);
    rateInput.addEventListener('input', recalc);
    tr.querySelector('.remove-row-btn').addEventListener('click', () => tr.remove());

    tbody.appendChild(tr);
    return tr;
  }

  // ── Load / refresh ingredient rows from recipe ─────────────
  function refreshIngredientTable() {
    const prodId = productSelect.value;
    const compId = companySelect.value;
    const section = document.getElementById('ingredient-section');
    const tbody = document.getElementById('ingredient-rows');
    const noRecipeNote = document.getElementById('no-recipe-note');

    if (!prodId || !compId) { section.style.display = 'none'; return; }

    section.style.display = '';
    tbody.innerHTML = '';

    const recipes = allRecipes.filter(r => r.product_id === prodId && r.company_id === compId);

    if (recipes.length === 0) {
      noRecipeNote.style.display = '';
      addRow(); // blank row so they can start entering manually
    } else {
      noRecipeNote.style.display = 'none';
      recipes.forEach(r => addRow(r.ingredient_id, r.quantity, r.unit_id, ''));
    }
  }

  productSelect.addEventListener('change', () => refreshIngredientTable());
  companySelect.addEventListener('change', () => refreshIngredientTable());

  document.getElementById('add-ing-row').addEventListener('click', () => {
    document.getElementById('ingredient-section').style.display = '';
    addRow();
  });

  // ── Form Submit ───────────────────────────────────────────
  document.getElementById('new-batch-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const btn = document.getElementById('create-batch-btn');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      // Collect ingredient rows from table
      const ingRows = [];
      document.querySelectorAll('#ingredient-rows tr').forEach(tr => {
        const ingId = tr.querySelector('.r-ing')?.value;
        const qty   = parseFloat(tr.querySelector('.r-qty')?.value || 0);
        const unitId= tr.querySelector('.r-unit')?.value;
        const rate  = parseFloat(tr.querySelector('.r-rate')?.value || 0);
        const whId  = tr.querySelector('.r-wh')?.value;
        if (ingId && qty > 0) ingRows.push({ ingId, qty, unitId, rate, whId });
      });

      const batchId = await generateId(SHEETS.PRODUCTION_BATCHES);
      const now = new Date().toISOString();
      await sheetsAppend(SHEETS.PRODUCTION_BATCHES, [[
        batchId, data.batch_date, data.product_id, data.company_id,
        data.planned_qty, '', data.unit_id, BATCH_STATUS.IN_PROGRESS,
        data.notes, getCurrentUser()?.user_id, now, now
      ]]);

      // Deduct ingredients from inventory using table rows
      for (const row of ingRows) {
        await updateInventoryBalance(row.ingId, 0, row.qty);
        const outId = await generateId(SHEETS.INVENTORY_OUT);
        await sheetsAppend(SHEETS.INVENTORY_OUT, [[
          outId, data.batch_date, row.ingId, batchId,
          row.qty, row.unitId, 'Production Consumption',
          getCurrentUser()?.user_id, now
        ]]);
      }

      // Initialize process log entries — filter by the selected product
      const activeProcesses = allProcesses.filter(p =>
        !p.product_id || p.product_id === data.product_id
      );
      const logRows = [];
      for (let i = 0; i < activeProcesses.length; i++) {
        const proc = activeProcesses[i];
        const logId = await generateId(SHEETS.PROCESS_LOG);
        const stepStatus = i === 0 ? 'Active' : 'Locked';
        // columns: log_id|batch_id|process_id|process_name|step_status|field_data_json
        //          |input_qty|input_unit|output_qty|output_unit
        //          |started_at|completed_at|completed_by|is_corrected|correction_ref_id
        logRows.push([
          logId, batchId, proc.process_id, proc.process_name, stepStatus,
          '{}',       // field_data_json
          '',         // input_qty
          '',         // input_unit
          '',         // output_qty
          '',         // output_unit
          i === 0 ? now : '', // started_at
          '',         // completed_at
          '',         // completed_by
          'FALSE',    // is_corrected
          ''          // correction_ref_id
        ]);
      }
      if (logRows.length > 0) {
        await sheetsAppend(SHEETS.PROCESS_LOG, logRows);
      }

      toast.success(`Batch ${batchId} created! Now log the production processes.`);
      navigate(`production/process-log?batch=${batchId}`);
    } catch (err) {
      toast.error(err.message);
      btn.disabled = false; btn.textContent = 'Create Batch & Start';
    }
  });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
