// ============================================================
// modules/production/new-batch.js — Create Production Batch
// Desktop: form-grid + ingredient table
// Mobile:  stacked form fields + ingredient cards
// ============================================================
import { sheetsAppend, generateId, sheetsBatchRead, parseSheetRows, updateInventoryBalance, activeOnly, updateFullRow } from '../../supabase-api.js';
import { SHEETS, BATCH_STATUS } from '../../config.js';
import { toast } from '../../components/toast.js';
import { hasPermission, getCurrentUser } from '../../auth.js';
import { navigate } from '../../app.js';

const isMobile = () => window.innerWidth <= 768;

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
          <!-- Batch header — uses form-grid (CSS already single-col on mobile) -->
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
            <div class="form-group">
              <label for="nb-sales-order">Sales Order Reference (Optional)</label>
              <select id="nb-sales-order" name="sale_id"><option value="">-- Manual / No Sales Order --</option></select>
            </div>
            <div class="form-group form-group--row">
              <div class="form-group__half">
                <label for="nb-qty">Planned Quantity <span class="req">*</span></label>
                <input type="number" id="nb-qty" name="planned_qty" min="0.01" step="0.01" required inputmode="decimal">
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

          <!-- Ingredient section (adaptive: table on desktop, cards on mobile) -->
          <div id="ingredient-section" style="display:none;margin-top:1.25rem">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
              <h4 style="margin:0;font-size:0.9rem;font-weight:600">Ingredients — Stock Out</h4>
              <button type="button" id="add-ing-row" class="btn btn--sm btn--ghost">+ Add</button>
            </div>
            <p id="no-recipe-note" style="display:none;margin-bottom:0.5rem;font-size:0.8rem;color:var(--color-text-muted)">
              No recipe found for this product/company. Add ingredients manually.
            </p>
            <!-- Desktop: table -->
            <div id="ing-table-wrap" style="overflow-x:auto">
              <table id="ing-table" style="width:100%;border-collapse:collapse;font-size:0.875rem;min-width:680px">
                <thead>
                  <tr style="background:var(--color-surface)">
                    <th style="padding:0.4rem 0.5rem;text-align:left;min-width:160px">Ingredient</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;min-width:110px">Lot No</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:80px">Qty</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:80px">Unit</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:80px">Rate (₹)</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;width:80px">Total (₹)</th>
                    <th style="padding:0.4rem 0.5rem;text-align:left;min-width:120px">Warehouse</th>
                    <th style="padding:0.4rem 0.5rem;width:36px"></th>
                  </tr>
                </thead>
                <tbody id="ingredient-rows"></tbody>
              </table>
            </div>
            <!-- Mobile: cards -->
            <div id="ing-cards" style="display:none;flex-direction:column;gap:0.75rem"></div>
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
    `${SHEETS.SALES_ORDERS}!A:M`,
    `${SHEETS.INVENTORY_IN}!A:N`,
    `${SHEETS.INVENTORY_OUT}!A:K`
  ]);
  const products    = activeOnly(parseSheetRows(SHEETS.PRODUCTS,    batchData[0].values || []));
  const companies   = activeOnly(parseSheetRows(SHEETS.COMPANIES,   batchData[1].values || []));
  const units       = activeOnly(parseSheetRows(SHEETS.UNITS,       batchData[2].values || []));
  const ingredients = activeOnly(parseSheetRows(SHEETS.INGREDIENTS, batchData[3].values || []));
  const warehouses  = activeOnly(parseSheetRows(SHEETS.WAREHOUSES,  batchData[4].values || []));
  const allRecipes  = activeOnly(parseSheetRows(SHEETS.RECIPES,     batchData[5].values || []));
  const allProcesses= activeOnly(parseSheetRows(SHEETS.PROCESSES,   batchData[6].values || []))
    .sort((a, b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));
  const allSalesOrders = parseSheetRows(SHEETS.SALES_ORDERS,        batchData[7].values || []);
  const allStockIn  = parseSheetRows(SHEETS.INVENTORY_IN,           batchData[8].values || []);
  const allStockOut = parseSheetRows(SHEETS.INVENTORY_OUT,          batchData[9].values || []);

  if (!document.body.contains(container)) return; // navigated away during fetch

  const productSelect = container.querySelector('#nb-product');
  const companySelect = container.querySelector('#nb-company');
  const salesOrderSelect = container.querySelector('#nb-sales-order');
  const unitSelect    = container.querySelector('#nb-unit');
  const qtyInput      = container.querySelector('#nb-qty');

  const unitMap = Object.fromEntries(units.map(u => [u.unit_id, u.abbreviation || u.unit_name]));
  const whMap   = Object.fromEntries(warehouses.map(w => [w.warehouse_id, w.warehouse_name]));

  if (!productSelect || !companySelect || !unitSelect) return;

  products.forEach(p   => productSelect.insertAdjacentHTML('beforeend',  `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`));
  companies.forEach(c  => companySelect.insertAdjacentHTML('beforeend',  `<option value="${escHtml(c.company_id)}">${escHtml(c.company_name)}</option>`));
  units.forEach(u      => unitSelect.insertAdjacentHTML('beforeend',     `<option value="${escHtml(u.unit_id)}">${escHtml(u.unit_name)}</option>`));

  // ── Sales Order filtering ─────────────────────────────────
  function filterSalesOrders() {
    const cId = companySelect.value;
    const pId = productSelect.value;
    if (!salesOrderSelect) return;
    salesOrderSelect.innerHTML = '<option value="">-- Manual / No Sales Order --</option>';
    if (!cId || !pId) return;

    // Filter open (Pending) sales orders for this company+product
    const filtered = allSalesOrders.filter(o =>
      o.company_id === cId &&
      o.product_id === pId &&
      (o.status === 'Pending' || o.status === 'In Production')
    );

    if (filtered.length === 0) {
      salesOrderSelect.insertAdjacentHTML('beforeend',
        `<option value="" disabled style="color:var(--color-text-muted)">No open orders for this selection</option>`);
      return;
    }

    filtered.forEach(o => {
      salesOrderSelect.insertAdjacentHTML('beforeend',
        `<option value="${escHtml(o.order_id)}" data-qty="${o.quantity}" data-unit="${o.unit_id}" data-orderno="${escHtml(o.order_no)}">
          ${escHtml(o.order_no)} — Qty: ${o.quantity} ${escHtml(unitMap[o.unit_id] || '')} | Del: ${o.expected_delivery || 'Open'}
        </option>`
      );
    });
  }

  companySelect.addEventListener('change', filterSalesOrders);
  productSelect.addEventListener('change', filterSalesOrders);

  salesOrderSelect?.addEventListener('change', () => {
    const opt = salesOrderSelect.selectedOptions[0];
    if (opt && opt.value) {
      qtyInput.value = opt.dataset.qty;
      unitSelect.value = opt.dataset.unit;
      // trigger input event so ingredient quantities rescale!
      qtyInput.dispatchEvent(new Event('input'));
    }
  });

  // ── Compute available lots logic ──────────────────────────
  function getAvailableLotsForIng(ingId) {
    const stock = {};
    allStockIn.filter(item => item.ingredient_id === ingId).forEach(item => {
      const lot = item.lot_no || 'No-Lot';
      const whId = item.warehouse_id || 'No-Wh';
      const key = `${lot}||${whId}`;
      if (!stock[key]) {
        stock[key] = {
          lot_no: item.lot_no || '',
          warehouse_id: item.warehouse_id || '',
          total_in: 0,
          total_out: 0,
          rate: parseFloat(item.rate || 0)
        };
      }
      stock[key].total_in += parseFloat(item.quantity || 0);
    });

    allStockOut.filter(item => item.ingredient_id === ingId).forEach(item => {
      const lot = item.lot_no || 'No-Lot';
      const whId = item.warehouse_id || 'No-Wh';
      const key = `${lot}||${whId}`;
      if (stock[key]) {
        stock[key].total_out += parseFloat(item.quantity || 0);
      }
    });

    const list = [];
    for (const key in stock) {
      const bal = stock[key].total_in - stock[key].total_out;
      if (bal > 0) {
        list.push({
          lot_no: stock[key].lot_no,
          warehouse_id: stock[key].warehouse_id,
          balance: bal,
          rate: stock[key].rate
        });
      }
    }
    return list;
  }

  const ingOptHtml = (selectedId = '') => ingredients.map(i =>
    `<option value="${escHtml(i.ingredient_id)}"${i.ingredient_id === selectedId ? ' selected' : ''}>${escHtml(i.ingredient_name)}</option>`).join('');
  const unitOptHtml = (selectedId = '') => units.map(u =>
    `<option value="${escHtml(u.unit_id)}"${u.unit_id === selectedId ? ' selected' : ''}>${escHtml(u.unit_name)}</option>`).join('');
  const whOptHtml = (selectedId = '') => warehouses.map(w =>
    `<option value="${escHtml(w.warehouse_id)}"${w.warehouse_id === selectedId ? ' selected' : ''}>${escHtml(w.warehouse_name)}</option>`).join('');

  // ─────────────────────────────────────────────────────────
  // MOBILE: Ingredient cards
  // ─────────────────────────────────────────────────────────
  function addMobileCard(ingId = '', qty = '', unitId = '', lotNo = '', warehouseId = '') {
    const wrap = container.querySelector('#ing-cards');
    const card = document.createElement('div');
    card.className = 'm-entry-form';
    card.style.cssText = 'padding:var(--space-4);gap:var(--space-3);position:relative';

    card.innerHTML = `
      <button type="button" class="m-card-remove-btn btn btn--xs btn--ghost"
        style="position:absolute;top:0.5rem;right:0.5rem;padding:0 0.4rem;font-size:1rem;line-height:1.5">×</button>

      <div class="form-group">
        <label>Ingredient <span class="req">*</span></label>
        <select class="r-ing">
          <option value="">Select ingredient…</option>
          ${ingOptHtml(ingId)}
        </select>
      </div>

      <div class="form-group">
        <label>Lot No</label>
        <select class="r-lot"><option value="">-- No Lot --</option></select>
      </div>

      <div class="form-row-2col">
        <div class="form-group">
          <label>Quantity <span class="req">*</span></label>
          <input type="number" class="r-qty" value="${escHtml(qty)}" min="0.01" step="0.01" placeholder="0" inputmode="decimal">
        </div>
        <div class="form-group">
          <label>Unit</label>
          <select class="r-unit">
            <option value="">—</option>
            ${unitOptHtml(unitId)}
          </select>
        </div>
      </div>

      <div class="form-row-2col">
        <div class="form-group">
          <label>Rate (₹)</label>
          <input type="number" class="r-rate" min="0" step="0.01" placeholder="0" inputmode="decimal">
        </div>
        <div class="form-group">
          <label>Total (₹)</label>
          <input type="number" class="r-total" readonly placeholder="0.00" tabindex="-1">
        </div>
      </div>

      <div class="form-group">
        <label>Warehouse / Godown</label>
        <select class="r-wh">
          <option value="">Select godown…</option>
          ${whOptHtml(warehouseId)}
        </select>
        <p class="r-lot-bal-msg" style="font-size:0.75rem;margin-top:0.25rem;color:var(--color-primary);display:none"></p>
      </div>
    `;

    const ingS = card.querySelector('.r-ing');
    const lotS = card.querySelector('.r-lot');
    const whS  = card.querySelector('.r-wh');
    const qtyI = card.querySelector('.r-qty');
    const unitS= card.querySelector('.r-unit');
    const rateI= card.querySelector('.r-rate');
    const totI = card.querySelector('.r-total');
    const balMsg = card.querySelector('.r-lot-bal-msg');

    const updateLots = (selectedLot = '') => {
      const ingIdVal = ingS.value;
      if (!ingIdVal) {
        lotS.innerHTML = '<option value="">-- No Lot --</option>';
        whS.value = '';
        if (balMsg) balMsg.style.display = 'none';
        return;
      }
      const lots = getAvailableLotsForIng(ingIdVal);
      lotS.innerHTML = '<option value="">-- No Lot / Custom --</option>' +
        lots.map(l => `<option value="${escHtml(l.lot_no)}" data-wh="${escHtml(l.warehouse_id)}" data-bal="${l.balance}" data-rate="${l.rate}" ${l.lot_no === selectedLot ? 'selected' : ''}>
          Lot: ${escHtml(l.lot_no)} (Godown: ${escHtml(whMap[l.warehouse_id] || l.warehouse_id)}, Stock: ${l.balance})
        </option>`).join('');
      
      const activeOpt = lotS.selectedOptions[0];
      if (activeOpt && activeOpt.value) {
        whS.value = activeOpt.dataset.wh;
        rateI.value = activeOpt.dataset.rate;
        if (balMsg) {
          balMsg.style.display = '';
          balMsg.textContent = `Available Stock: ${activeOpt.dataset.bal} ${escHtml(unitMap[unitS.value] || '')}`;
        }
      }
      recalc();
    };

    ingS.addEventListener('change', () => {
      const ing = ingredients.find(i => i.ingredient_id === ingS.value);
      if (ing?.unit_id) unitS.value = ing.unit_id;
      updateLots();
    });

    lotS.addEventListener('change', () => {
      const opt = lotS.selectedOptions[0];
      if (opt && opt.value) {
        whS.value = opt.dataset.wh;
        rateI.value = opt.dataset.rate;
        if (balMsg) {
          balMsg.style.display = '';
          balMsg.textContent = `Available Stock: ${opt.dataset.bal} ${escHtml(unitMap[unitS.value] || '')}`;
        }
      } else {
        whS.value = '';
        rateI.value = '';
        if (balMsg) balMsg.style.display = 'none';
      }
      recalc();
    });

    const recalc = () => {
      const t = (parseFloat(qtyI.value) || 0) * (parseFloat(rateI.value) || 0);
      totI.value = t > 0 ? t.toFixed(2) : '';
    };
    qtyI.addEventListener('input', recalc);
    rateI.addEventListener('input', recalc);
    card.querySelector('.m-card-remove-btn').addEventListener('click', () => card.remove());

    wrap.appendChild(card);
    if (ingId) {
      updateLots(lotNo);
    }
    return card;
  }

  // ─────────────────────────────────────────────────────────
  // DESKTOP: Ingredient table row
  // ─────────────────────────────────────────────────────────
  function addDesktopRow(ingId = '', qty = '', unitId = '', lotNo = '', warehouseId = '') {
    const tbody = container.querySelector('#ingredient-rows');
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="padding:0.3rem 0.4rem">
        <select class="r-ing input--sm" style="width:100%">
          <option value="">-- Select --</option>
          ${ingOptHtml(ingId)}
        </select>
      </td>
      <td style="padding:0.3rem 0.4rem">
        <select class="r-lot input--sm" style="width:100%">
          <option value="">-- No Lot --</option>
        </select>
      </td>
      <td style="padding:0.3rem 0.4rem">
        <input type="number" class="r-qty input--sm" value="${escHtml(qty)}" min="0.01" step="0.01" style="width:80px">
        <div class="r-bal-label" style="font-size:0.65rem;color:var(--color-primary);display:none;white-space:nowrap"></div>
      </td>
      <td style="padding:0.3rem 0.4rem">
        <select class="r-unit input--sm">${unitOptHtml(unitId)}</select>
      </td>
      <td style="padding:0.3rem 0.4rem">
        <input type="number" class="r-rate input--sm" min="0" step="0.01" style="width:70px" placeholder="0">
      </td>
      <td style="padding:0.3rem 0.4rem;font-weight:600" class="r-total">₹0.00</td>
      <td style="padding:0.3rem 0.4rem">
        <select class="r-wh input--sm" style="width:100%">
          <option value="">-- Godown --</option>
          ${whOptHtml(warehouseId)}
        </select>
      </td>
      <td style="padding:0.3rem 0.4rem;text-align:center">
        <button type="button" class="btn btn--xs btn--danger remove-row-btn" title="Remove">×</button>
      </td>
    `;
    const ingS = tr.querySelector('.r-ing');
    const lotS = tr.querySelector('.r-lot');
    const whS = tr.querySelector('.r-wh');
    const qtyI = tr.querySelector('.r-qty'), rateI = tr.querySelector('.r-rate');
    const unitS = tr.querySelector('.r-unit');
    const totC = tr.querySelector('.r-total');
    const balLbl = tr.querySelector('.r-bal-label');

    const updateLots = (selectedLot = '') => {
      const ingIdVal = ingS.value;
      if (!ingIdVal) {
        lotS.innerHTML = '<option value="">-- No Lot --</option>';
        whS.value = '';
        if (balLbl) balLbl.style.display = 'none';
        return;
      }
      const lots = getAvailableLotsForIng(ingIdVal);
      lotS.innerHTML = '<option value="">-- No Lot / Custom --</option>' +
        lots.map(l => `<option value="${escHtml(l.lot_no)}" data-wh="${escHtml(l.warehouse_id)}" data-bal="${l.balance}" data-rate="${l.rate}" ${l.lot_no === selectedLot ? 'selected' : ''}>
          ${escHtml(l.lot_no)} (${l.balance})
        </option>`).join('');

      const activeOpt = lotS.selectedOptions[0];
      if (activeOpt && activeOpt.value) {
        whS.value = activeOpt.dataset.wh;
        rateI.value = activeOpt.dataset.rate;
        if (balLbl) {
          balLbl.style.display = 'block';
          balLbl.textContent = `Max: ${activeOpt.dataset.bal}`;
        }
      }
      recalc();
    };

    ingS.addEventListener('change', () => {
      const ing = ingredients.find(i => i.ingredient_id === ingS.value);
      if (ing?.unit_id) unitS.value = ing.unit_id;
      updateLots();
    });

    lotS.addEventListener('change', () => {
      const opt = lotS.selectedOptions[0];
      if (opt && opt.value) {
        whS.value = opt.dataset.wh;
        rateI.value = opt.dataset.rate;
        if (balLbl) {
          balLbl.style.display = 'block';
          balLbl.textContent = `Max: ${opt.dataset.bal}`;
        }
      } else {
        whS.value = '';
        rateI.value = '';
        if (balLbl) balLbl.style.display = 'none';
      }
      recalc();
    });

    const recalc = () => {
      const t = (parseFloat(qtyI.value) || 0) * (parseFloat(rateI.value) || 0);
      totC.textContent = '₹' + t.toFixed(2);
    };
    qtyI.addEventListener('input', recalc);
    rateI.addEventListener('input', recalc);
    tr.querySelector('.remove-row-btn').addEventListener('click', () => tr.remove());

    tbody.appendChild(tr);
    if (ingId) {
      updateLots(lotNo);
    }
    return tr;
  }

  // ── Pick correct add-row fn based on device ───────────────
  function addIngRow(ingId = '', qty = '', unitId = '', lotNo = '', whId = '') {
    if (isMobile()) {
      addMobileCard(ingId, qty, unitId, lotNo, whId);
    } else {
      addDesktopRow(ingId, qty, unitId, lotNo, whId);
    }
  }

  // ── Show correct container based on device ────────────────
  function initIngredientLayout() {
    const tableWrap = container.querySelector('#ing-table-wrap');
    const cardsWrap = container.querySelector('#ing-cards');
    if (!tableWrap || !cardsWrap) return;
    if (isMobile()) {
      tableWrap.style.display = 'none';
      cardsWrap.style.display = 'flex';
    } else {
      tableWrap.style.display = '';
      cardsWrap.style.display = 'none';
    }
  }

  // ── Load / refresh ingredient rows from recipe ─────────────
  // Auto-scales recipe quantities by the planned batch qty
  function refreshIngredientSection() {
    const prodId = productSelect.value;
    const compId = companySelect.value;
    const section = container.querySelector('#ingredient-section');
    const tbody = container.querySelector('#ingredient-rows');
    const cardsWrap = container.querySelector('#ing-cards');
    const noRecipeNote = container.querySelector('#no-recipe-note');

    if (!prodId || !compId || !section) { if (section) section.style.display = 'none'; return; }

    // Scale factor: recipe is for 1 unit — multiply by planned qty
    const plannedQty = parseFloat(qtyInput?.value || 1) || 1;

    section.style.display = '';
    initIngredientLayout();
    if (tbody) tbody.innerHTML = '';
    if (cardsWrap) cardsWrap.innerHTML = '';

    const recipes = allRecipes.filter(r => r.product_id === prodId && r.company_id === compId);

    if (recipes.length === 0) {
      if (noRecipeNote) noRecipeNote.style.display = '';
      addIngRow();
    } else {
      if (noRecipeNote) noRecipeNote.style.display = 'none';
      recipes.forEach(r => {
        const scaledQty = (parseFloat(r.quantity || 0) * plannedQty).toFixed(3).replace(/\.?0+$/, '');
        addIngRow(r.ingredient_id, scaledQty, r.unit_id, '');
      });
    }
  }

  productSelect.addEventListener('change', refreshIngredientSection);
  companySelect.addEventListener('change', refreshIngredientSection);
  // Re-scale ingredient quantities when planned qty changes
  qtyInput?.addEventListener('input', () => {
    const section = container.querySelector('#ingredient-section');
    if (section && section.style.display !== 'none') refreshIngredientSection();
  });

  container.querySelector('#add-ing-row')?.addEventListener('click', () => {
    const section = container.querySelector('#ingredient-section');
    if (section) section.style.display = '';
    initIngredientLayout();
    addIngRow();
  });

  // ── Collect ingredient data (works for both layouts) ──────
  function collectIngredients() {
    const rows = [];
    if (isMobile()) {
      container.querySelectorAll('#ing-cards .m-entry-form').forEach(card => {
        const ingId = card.querySelector('.r-ing')?.value;
        const qty   = parseFloat(card.querySelector('.r-qty')?.value || 0);
        const unitId= card.querySelector('.r-unit')?.value;
        const rate  = parseFloat(card.querySelector('.r-rate')?.value || 0);
        const lotNo = card.querySelector('.r-lot')?.value || '';
        const whId  = card.querySelector('.r-wh')?.value || '';
        if (ingId && qty > 0) rows.push({ ingId, qty, unitId, rate, lotNo, whId });
      });
    } else {
      container.querySelectorAll('#ingredient-rows tr').forEach(tr => {
        const ingId = tr.querySelector('.r-ing')?.value;
        const qty   = parseFloat(tr.querySelector('.r-qty')?.value || 0);
        const unitId= tr.querySelector('.r-unit')?.value;
        const rate  = parseFloat(tr.querySelector('.r-rate')?.value || 0);
        const lotNo = tr.querySelector('.r-lot')?.value || '';
        const whId  = tr.querySelector('.r-wh')?.value || '';
        if (ingId && qty > 0) rows.push({ ingId, qty, unitId, rate, lotNo, whId });
      });
    }
    return rows;
  }

  // ── Form Submit ───────────────────────────────────────────
  container.querySelector('#new-batch-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const btn  = container.querySelector('#create-batch-btn');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      const ingRows = collectIngredients();
      const batchId = await generateId(SHEETS.PRODUCTION_BATCHES);
      const now = new Date().toISOString();

      await sheetsAppend(SHEETS.PRODUCTION_BATCHES, [[
        batchId, data.batch_date, data.product_id, data.company_id,
        data.planned_qty, '', data.unit_id, BATCH_STATUS.IN_PROGRESS,
        data.notes, getCurrentUser()?.user_id, now, now
      ]]);

      // Link Sales Order to batch if referenced, and update status to In Production
      if (data.sale_id) {
        try {
          const { findRowById: findRow } = await import('../../supabase-api.js');
          const soRowNum = await findRow(SHEETS.SALES_ORDERS, data.sale_id);
          if (soRowNum) {
            const soRecord = allSalesOrders.find(o => o.order_id === data.sale_id);
            if (soRecord) {
              await updateFullRow(SHEETS.SALES_ORDERS, soRowNum, {
                ...soRecord,
                batch_id: batchId,
                status: 'In Production',
              });
            }
          }
        } catch (soErr) {
          console.warn('Could not update Sales Order status:', soErr.message);
        }
      }

      for (const row of ingRows) {
        await updateInventoryBalance(row.ingId, 0, row.qty);
        const outId = await generateId(SHEETS.INVENTORY_OUT);
        await sheetsAppend(SHEETS.INVENTORY_OUT, [[
          outId, data.batch_date, row.ingId, batchId,
          row.qty, row.unitId, 'Production Consumption',
          getCurrentUser()?.user_id, now, row.lotNo, row.whId
        ]]);
      }

      const activeProcesses = allProcesses.filter(p =>
        !p.product_id || p.product_id === data.product_id);
      const logRows = [];
      for (let i = 0; i < activeProcesses.length; i++) {
        const proc = activeProcesses[i];
        const logId = await generateId(SHEETS.PROCESS_LOG);
        logRows.push([
          logId, batchId, proc.process_id, proc.process_name,
          i === 0 ? 'Active' : 'Locked',
          '{}', '', '', '', '',
          i === 0 ? now : '', '', '', 'FALSE', ''
        ]);
      }
      if (logRows.length > 0) await sheetsAppend(SHEETS.PROCESS_LOG, logRows);

      toast.success(`Batch ${batchId} created! Now log the production processes.`);
      navigate(`production/process-log?batch=${batchId}`);
    } catch (err) {
      toast.error(err.message);
      btn.disabled = false; btn.textContent = 'Create Batch & Start';
    }
  });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
