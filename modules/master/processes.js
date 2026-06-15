// ============================================================
// modules/master/processes.js — Process & Dynamic Field Builder
// ============================================================
import { readAllRows, sheetsBatchRead, parseSheetRows, sheetsAppend, findRowById, updateFullRow, generateId, clearDimCache, activeOnly } from '../supabase-api.js';
import { SHEETS, FIELD_TYPES } from '../config.js';
import { DataTable, statusBadge } from '../../components/data-table.js';
import { formModal, confirm, alert, contentModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { hasPermission } from '../auth.js';

export async function renderProcesses(container) {
  const canEditProcess = hasPermission('master_edit');
  const canEditFields  = hasPermission('process_fields_edit');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Processes & Fields</h1>
        <p class="page-subtitle">Configure per-product production processes and their dynamic form fields</p>
      </div>
      ${canEditProcess ? `<button class="btn btn--primary" id="add-proc-btn">+ Add Process</button>` : ''}
    </div>
    <div style="margin-bottom:1rem;display:flex;align-items:center;gap:.75rem">
      <label style="font-weight:600;font-size:0.875rem">Filter by Product:</label>
      <select id="proc-product-filter" class="input--sm" style="min-width:200px">
        <option value="">All Products</option>
      </select>
    </div>
    <div class="process-layout">
      <div class="card" id="process-list-card">
        <div class="card__header"><h3 class="card__title">Production Processes</h3></div>
        <div class="card__body" id="process-list"><div class="skeleton skeleton--list"></div></div>
      </div>
      <div class="card" id="field-editor-card" style="display:none">
        <div class="card__header">
          <h3 class="card__title" id="field-editor-title">Process Fields</h3>
          <div class="card__header-actions">
            ${canEditFields ? `<button class="btn btn--sm btn--primary" id="add-field-btn">+ Add Field</button>` : ''}
            <button class="btn btn--sm btn--ghost" id="preview-form-btn">👁 Preview</button>
            <button class="btn btn--sm btn--ghost" id="close-fields-btn">✕</button>
          </div>
        </div>
        <div class="card__body" id="field-list"></div>
      </div>
    </div>
  `;

  // ── Load products + processes in one call ─────────────────
  const batchData = await sheetsBatchRead([
    `${SHEETS.PRODUCTS}!A:H`,
    `${SHEETS.PROCESSES}!A:G`,
  ]);
  const products     = activeOnly(parseSheetRows(SHEETS.PRODUCTS,   batchData[0].values || []));
  const prodMap      = Object.fromEntries(products.map(p => [p.product_id, p.product_name]));

  if (!document.body.contains(container)) return; // navigated away during fetch

  // Populate product filter
  const filterSelect = container.querySelector('#proc-product-filter');
  if (!filterSelect) return;
  products.forEach(p => filterSelect.insertAdjacentHTML('beforeend',
    `<option value="${escHtml(p.product_id)}">${escHtml(p.product_name)}</option>`));

  if (canEditProcess) {
    container.querySelector('#add-proc-btn')?.addEventListener('click', () =>
      openProcessForm(null, refreshProcesses, products));
  }
  filterSelect.addEventListener('change', () => {
    closeFieldEditor();
    refreshProcesses();
  });

  // ── Wire field-editor buttons ONCE using onclick (no accumulation) ──
  let selectedProcess = null;

  container.querySelector('#close-fields-btn')?.addEventListener('click', closeFieldEditor);

  function closeFieldEditor() {
    const card = container.querySelector('#field-editor-card');
    if (card) card.style.display = 'none';
    selectedProcess = null;
    // Clear onclick to avoid stale closures
    const addBtn     = container.querySelector('#add-field-btn');
    const previewBtn = container.querySelector('#preview-form-btn');
    if (addBtn)     addBtn.onclick     = null;
    if (previewBtn) previewBtn.onclick = null;
  }

  function openFieldEditor(process) {
    selectedProcess = process;
    const card = container.querySelector('#field-editor-card');
    if (card) card.style.display = '';
    const titleEl = container.querySelector('#field-editor-title');
    if (titleEl) titleEl.textContent = `Fields: ${process.process_name}`;

    // Use .onclick — reassigning always replaces the old handler (no accumulation)
    const addBtn     = container.querySelector('#add-field-btn');
    const previewBtn = container.querySelector('#preview-form-btn');
    if (addBtn)     addBtn.onclick     = () => openFieldForm(process.process_id, null, () => refreshFields(process.process_id));
    if (previewBtn) previewBtn.onclick = () => showFormPreview(process);

    refreshFields(process.process_id);
  }

  // ── Refresh process list (grouped by product as pipeline rows) ──
  async function refreshProcesses() {
    const filterProd = container.querySelector('#proc-product-filter')?.value || '';
    let allProcs = (await readAllRows(SHEETS.PROCESSES))
      .sort((a, b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));
    if (filterProd) allProcs = allProcs.filter(p => p.product_id === filterProd);

    const list = container.querySelector('#process-list');
    if (!list) return;

    if (allProcs.length === 0) {
      list.innerHTML = '<p style="color:var(--color-text-muted);padding:1rem">No processes configured. Add your first process.</p>';
      return;
    }

    // Group by product_id
    const groups = new Map();
    allProcs.forEach(p => {
      const key = p.product_id || '__general__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });

    // Build HTML — all inline styles, grouped by product
    let html = '';
    for (const [productKey, procs] of groups) {
      const productName = productKey === '__general__'
        ? 'General (All Products)'
        : (prodMap[productKey] || productKey);

      let stepsHtml = '';
      procs.forEach((p, i) => {
        const isActive = p.is_active === 'TRUE' || p.is_active === true;
        const isSelected = selectedProcess?.process_id === p.process_id;

        // Arrow connector between steps
        if (i > 0) {
          stepsHtml += `
            <div style="display:flex;align-items:center;align-self:stretch;padding:0 2px;color:#aaa;font-size:1rem">
              ›
            </div>`;
        }

        stepsHtml += `
          <div data-id="${escHtml(p.process_id)}" data-step-card
               style="display:flex;flex-direction:column;width:170px;min-width:170px;flex-shrink:0;
                      border-radius:12px;
                      border:1.5px solid ${isSelected ? 'var(--color-primary)' : '#e2e8ec'};
                      background:${isSelected ? '#eaf4f2' : '#fff'};
                      box-shadow:0 1px 4px rgba(0,0,0,.06);
                      overflow:hidden;cursor:pointer;
                      transition:border-color .15s,box-shadow .15s">
            <!-- Step header -->
            <div style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px 6px">
              <div style="width:22px;height:22px;min-width:22px;background:var(--color-primary);color:#fff;
                          border-radius:50%;display:flex;align-items:center;justify-content:center;
                          font-size:10px;font-weight:800;flex-shrink:0;margin-top:1px">${escHtml(p.sequence_order)}</div>
              <div style="font-weight:700;font-size:0.8rem;line-height:1.3;color:#1a2e2a">${escHtml(p.process_name)}</div>
            </div>
            <!-- Description -->
            <div style="flex:1;padding:0 12px 8px;font-size:0.75rem;color:#6b7f7c;line-height:1.4;min-height:28px">
              ${p.description ? escHtml(p.description) : ''}
            </div>
            <!-- Footer: status + actions -->
            <div style="display:flex;align-items:center;gap:4px;padding:6px 10px 8px;
                        border-top:1px solid #f0f4f3;background:#f8fbfa;flex-wrap:wrap">
              <span style="font-size:0.7rem;font-weight:700;
                           color:${isActive ? '#1d8c60' : '#999'};
                           background:${isActive ? '#e6f7f0' : '#f0f0f0'};
                           padding:2px 7px;border-radius:20px">
                ${isActive ? 'Active' : 'Inactive'}
              </span>
              ${canEditProcess ? `<button class="btn btn--xs btn--ghost" data-action="edit"
                style="padding:2px 6px;font-size:0.7rem;margin-left:auto" title="Edit">✏</button>` : ''}
              <button class="btn btn--xs btn--primary" data-action="fields"
                style="padding:2px 8px;font-size:0.7rem${!canEditProcess ? ';margin-left:auto' : ''}" title="Fields">⚙ Fields</button>
            </div>
          </div>`;
      });

      html += `
        <div style="display:flex;align-items:stretch;gap:0;padding:16px 0;
                    border-bottom:1px solid #eef1f3">
          <!-- Product label -->
          <div style="width:140px;min-width:140px;flex-shrink:0;
                      display:flex;align-items:center;padding-right:16px">
            <div style="font-weight:700;font-size:0.9rem;color:var(--color-primary);
                        background:#eaf4f2;border-radius:8px;padding:6px 10px;
                        width:100%;text-align:center;line-height:1.3">
              ${escHtml(productName)}
            </div>
          </div>
          <!-- Steps row -->
          <div style="overflow-x:auto;flex:1;padding-bottom:4px;scrollbar-width:thin">
            <div data-steps-row style="display:flex;flex-direction:row;flex-wrap:nowrap;
                        gap:6px;min-width:max-content;align-items:flex-start">
              ${stepsHtml}
            </div>
          </div>
        </div>`;
    }

    list.style.cssText = 'display:flex;flex-direction:column;gap:0;padding:0 4px';
    list.innerHTML = html;

    // Equalize card heights per product row.
    // Double-rAF: first rAF schedules after DOM paint; second fires after fonts
    // and text reflow are complete, so getBoundingClientRect() is accurate.
    const equalizeHeights = () => {
      list.querySelectorAll('[data-steps-row]').forEach(row => {
        const cards = [...row.querySelectorAll('[data-step-card]')];
        if (cards.length < 2) return;
        cards.forEach(c => { c.style.minHeight = ''; }); // reset before measuring
        const maxH = Math.max(...cards.map(c => c.getBoundingClientRect().height));
        if (maxH > 0) cards.forEach(c => { c.style.minHeight = maxH + 'px'; });
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(equalizeHeights));

    list.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id  = e.target.closest('[data-id]')?.dataset.id;
        const proc = allProcs.find(p => p.process_id === id);
        if (proc) openProcessForm(proc, refreshProcesses, products);
      });
    });

    list.querySelectorAll('[data-action="fields"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id  = e.target.closest('[data-id]')?.dataset.id;
        const proc = allProcs.find(p => p.process_id === id);
        if (proc) openFieldEditor(proc);
      });
    });
  }

  // ── Refresh fields for a process ─────────────────────────
  async function refreshFields(processId) {
    const allFields = await readAllRows(SHEETS.PROCESS_FIELDS);
    const fields = allFields
      .filter(f => f.process_id === processId)
      .sort((a, b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));

    const list = container.querySelector('#field-list');
    if (!list) return;

    if (fields.length === 0) {
      list.innerHTML = '<p class="empty-msg">No fields yet. Click "+ Add Field" to define the process form.</p>';
      return;
    }

    list.innerHTML = `<div class="field-list">
      ${fields.map(f => `
        <div class="field-item">
          <div class="field-item__seq">${escHtml(f.sequence_order)}</div>
          <div class="field-item__info">
            <div class="field-item__label">${escHtml(f.field_label)}</div>
            <div class="field-item__meta">
              <span class="badge badge--blue">${escHtml(f.field_type)}</span>
              ${f.is_required === 'TRUE' || f.is_required === true
                ? '<span class="badge badge--amber">Required</span>'
                : '<span class="badge badge--gray">Optional</span>'}
              ${statusBadge((f.is_active === 'TRUE' || f.is_active === true) ? 'Active' : 'Inactive')}
            </div>
            ${f.field_options ? `<div class="field-item__opts" style="font-size:0.78rem;color:var(--color-text-muted);margin-top:.2rem">Options: ${escHtml(f.field_options)}</div>` : ''}
          </div>
          ${canEditFields ? `<div class="field-item__actions">
            <button class="btn btn--xs btn--ghost" data-field-edit="${escHtml(f.field_id)}" title="Edit">✏</button>
            <button class="btn btn--xs btn--ghost" data-field-toggle="${escHtml(f.field_id)}" title="${(f.is_active === 'TRUE' || f.is_active === true) ? 'Deactivate' : 'Activate'}">
              ${(f.is_active === 'TRUE' || f.is_active === true) ? '⏸' : '▶'}
            </button>
            <button class="btn btn--xs btn--danger" data-field-delete="${escHtml(f.field_id)}" title="Delete">🗑</button>
          </div>` : ''}
        </div>`).join('')}
    </div>`;

    list.querySelectorAll('[data-field-edit]').forEach(btn => {
      const fld = fields.find(f => f.field_id === btn.dataset.fieldEdit);
      btn.addEventListener('click', () => openFieldForm(processId, fld, () => refreshFields(processId)));
    });

    list.querySelectorAll('[data-field-toggle]').forEach(btn => {
      const fld = fields.find(f => f.field_id === btn.dataset.fieldToggle);
      btn.addEventListener('click', async () => {
        try {
          const rowNum = await findRowById(SHEETS.PROCESS_FIELDS, fld.field_id);
          const isActive = fld.is_active === 'TRUE' || fld.is_active === true;
          await updateFullRow(SHEETS.PROCESS_FIELDS, rowNum, { ...fld, is_active: isActive ? 'FALSE' : 'TRUE' });
          toast.success('Field status updated.');
          clearDimCache();
          await refreshFields(processId);
        } catch (err) { toast.error(err.message); }
      });
    });

    list.querySelectorAll('[data-field-delete]').forEach(btn => {
      const fld = fields.find(f => f.field_id === btn.dataset.fieldDelete);
      btn.addEventListener('click', async () => {
        const ok = await confirm({
          title: 'Delete Field',
          message: `Permanently delete "${fld.field_label}"? This cannot be undone and will remove this field from all future process forms.`,
          confirmText: 'Delete',
          confirmClass: 'btn--danger',
        });
        if (!ok) return;
        try {
          const rowNum = await findRowById(SHEETS.PROCESS_FIELDS, fld.field_id);
          // Hard-delete by marking inactive and using a tombstone flag
          await updateFullRow(SHEETS.PROCESS_FIELDS, rowNum, { ...fld, is_active: 'FALSE', field_label: `[DELETED] ${fld.field_label}` });
          toast.success('Field deleted.');
          clearDimCache();
          await refreshFields(processId);
        } catch (err) { toast.error(err.message); }
      });
    });
  }

  await refreshProcesses();
}

// ── Add / Edit Process ────────────────────────────────────
async function openProcessForm(data, onSave, products = []) {
  const productOptions = [
    { value: '', label: '-- Select Product --' },
    ...products.map(p => ({ value: p.product_id, label: p.product_name })),
  ];
  const result = await formModal({
    title: data ? 'Edit Process' : 'Add Process',
    fields: [
      { name: 'product_id',     label: 'Product',        type: 'select', required: false, options: productOptions },
      { name: 'process_name',   label: 'Process Name',   type: 'text',   required: true,  placeholder: 'e.g. Brine Preparation' },
      { name: 'sequence_order', label: 'Sequence Order', type: 'number', required: true,  min: 1 },
      { name: 'description',    label: 'Description',    type: 'textarea' },
    ],
    data: data || {},
    submitText: data ? 'Update' : 'Add Process',
  });
  if (!result) return;
  try {
    const now = new Date().toISOString();
    if (data) {
      const rowNum = await findRowById(SHEETS.PROCESSES, data.process_id);
      await updateFullRow(SHEETS.PROCESSES, rowNum, { ...data, ...result, updated_at: now });
      toast.success('Process updated.');
    } else {
      const id = await generateId(SHEETS.PROCESSES);
      await sheetsAppend(SHEETS.PROCESSES, [[
        id, result.product_id || '', result.process_name,
        result.sequence_order, result.description || '', 'TRUE', now
      ]]);
      toast.success('Process added.');
    }
    clearDimCache();
    await onSave();
  } catch (err) { toast.error(err.message); }
}

// ── Add / Edit Field ──────────────────────────────────────
async function openFieldForm(processId, data, onSave) {
  const result = await formModal({
    title: data ? 'Edit Field' : 'Add Field',
    fields: [
      { name: 'field_label',    label: 'Field Label',    type: 'text',   required: true,  placeholder: 'e.g. Salt Percentage (%)' },
      { name: 'field_name',     label: 'Field Key',      type: 'text',   required: true,  placeholder: 'e.g. salt_pct (no spaces)' },
      { name: 'field_type',     label: 'Field Type',     type: 'select', required: true,
        options: Object.values(FIELD_TYPES).map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })) },
      { name: 'field_options',  label: 'Options (comma-separated — Dropdown only)', type: 'text', placeholder: 'Pass, Fail, Retest' },
      { name: 'is_required',    label: 'Required Field', type: 'checkbox' },
      { name: 'sequence_order', label: 'Sequence Order', type: 'number', required: true, min: 1 },
    ],
    data: data || {},
    submitText: data ? 'Update Field' : 'Add Field',
  });
  if (!result) return;
  try {
    if (data) {
      const rowNum = await findRowById(SHEETS.PROCESS_FIELDS, data.field_id);
      await updateFullRow(SHEETS.PROCESS_FIELDS, rowNum, {
        ...data, ...result,
        is_required: result.is_required ? 'TRUE' : 'FALSE',
      });
      toast.success('Field updated.');
    } else {
      const id = await generateId(SHEETS.PROCESS_FIELDS);
      await sheetsAppend(SHEETS.PROCESS_FIELDS, [[
        id, processId, result.field_name, result.field_label, result.field_type,
        result.field_options || '', result.is_required ? 'TRUE' : 'FALSE', result.sequence_order, 'TRUE'
      ]]);
      toast.success('Field added.');
    }
    clearDimCache();
    await onSave();
  } catch (err) { toast.error(err.message); }
}

// ── Form Preview ──────────────────────────────────────────
async function showFormPreview(process) {
  const allFields = await readAllRows(SHEETS.PROCESS_FIELDS);
  const fields = allFields
    .filter(f => f.process_id === process.process_id && (f.is_active === 'TRUE' || f.is_active === true))
    .sort((a, b) => parseInt(a.sequence_order) - parseInt(b.sequence_order));

  const formHtml = fields.length === 0
    ? '<p class="empty-msg">No active fields. Add fields to see the preview.</p>'
    : `<form class="process-preview-form" onsubmit="return false">
        ${fields.map(f => renderPreviewField(f)).join('')}
        <div class="form-actions">
          <button class="btn btn--primary" type="submit">Save ${escHtml(process.process_name)}</button>
        </div>
      </form>`;

  contentModal({
    title: `Preview: ${process.process_name}`,
    content: `<div class="form-preview">
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:1rem">This is how the form will appear to production staff.</p>
      ${formHtml}
    </div>`,
    size: 'md',
  });
}

function renderPreviewField(field) {
  const req     = (field.is_required === 'TRUE' || field.is_required === true) ? 'required' : '';
  const reqMark = (field.is_required === 'TRUE' || field.is_required === true) ? '<span class="req">*</span>' : '';
  switch (field.field_type) {
    case 'dropdown': {
      const opts = (field.field_options || '').split(',').map(o => `<option>${escHtml(o.trim())}</option>`).join('');
      return `<div class="form-group"><label>${escHtml(field.field_label)}${reqMark}</label><select ${req}><option value="">-- Select --</option>${opts}</select></div>`;
    }
    case 'checkbox':
      return `<div class="form-group" style="display:flex;align-items:center;gap:.5rem"><input type="checkbox" id="prev_${escHtml(field.field_id)}"><label for="prev_${escHtml(field.field_id)}">${escHtml(field.field_label)}</label></div>`;
    case 'textarea':
      return `<div class="form-group"><label>${escHtml(field.field_label)}${reqMark}</label><textarea rows="2" ${req}></textarea></div>`;
    default:
      return `<div class="form-group"><label>${escHtml(field.field_label)}${reqMark}</label><input type="${escHtml(field.field_type)}" ${req}></div>`;
  }
}

function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
