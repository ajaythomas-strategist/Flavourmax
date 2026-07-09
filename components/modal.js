// ============================================================
// components/modal.js — Modal Dialogs
// Uses native <dialog> element for accessible modals
// ============================================================

// ─── Alert Dialog ─────────────────────────────────────────────
export function alert({ title = 'Info', message = '' } = {}) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    dialog.innerHTML = `
      <div class="fm-modal__header">
        <h2 class="fm-modal__title">${escHtml(title)}</h2>
      </div>
      <div class="fm-modal__body">
        <p>${message}</p>
      </div>
      <div class="fm-modal__footer">
        <button class="btn btn--primary" id="modal-ok">OK</button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('#modal-ok').addEventListener('click', () => { dialog.close(); resolve(true); });
    dialog.addEventListener('close', () => { setTimeout(() => dialog.remove(), 300); });
  });
}

// ─── Confirmation Dialog ──────────────────────────────────────
export function confirm({ title = 'Confirm', message = 'Are you sure?', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    dialog.innerHTML = `
      <div class="fm-modal__header">
        <h2 class="fm-modal__title">${escHtml(title)}</h2>
      </div>
      <div class="fm-modal__body">
        <p>${escHtml(message)}</p>
      </div>
      <div class="fm-modal__footer">
        <button class="btn btn--ghost" id="modal-cancel">Cancel</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" id="modal-confirm">${escHtml(confirmText)}</button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();

    dialog.querySelector('#modal-cancel').addEventListener('click', () => { dialog.close(); resolve(false); });
    dialog.querySelector('#modal-confirm').addEventListener('click', () => { dialog.close(); resolve(true); });
    dialog.addEventListener('close', () => { setTimeout(() => dialog.remove(), 300); });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) { dialog.close(); resolve(false); }
    });
  });
}

// ─── Form Modal ────────────────────────────────────────────────
export function formModal({ title = 'Form', fields = [], data = {}, submitText = 'Save', size = 'md' } = {}) {
  return new Promise((resolve) => {
    const dialog = createDialog(size);
    dialog.innerHTML = `
      <div class="fm-modal__header">
        <h2 class="fm-modal__title">${escHtml(title)}</h2>
        <button class="fm-modal__close" aria-label="Close">×</button>
      </div>
      <div class="fm-modal__body">
        <form id="fm-modal-form" novalidate>
          ${fields.map(f => renderField(f, data[f.name])).join('')}
        </form>
      </div>
      <div class="fm-modal__footer">
        <button class="btn btn--ghost" type="button" id="modal-cancel">Cancel</button>
        <button class="btn btn--primary" type="submit" form="fm-modal-form">${escHtml(submitText)}</button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();

    dialog.querySelector('.fm-modal__close')?.addEventListener('click', () => { dialog.close(); resolve(null); });
    dialog.querySelector('#modal-cancel').addEventListener('click', () => { dialog.close(); resolve(null); });

    dialog.querySelector('#fm-modal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      if (!validateForm(form, fields)) return;
      const result = {};
      fields.forEach(f => {
        const el = form.querySelector(`[name="${f.name}"]`);
        if (!el) return;
        result[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      });
      dialog.close();
      resolve(result);
    });

    dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 300));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) { dialog.close(); resolve(null); } });
  });
}

// ─── Custom Content Modal ─────────────────────────────────────
export function contentModal({ title = '', content = '', size = 'lg' } = {}) {
  const dialog = createDialog(size);
  dialog.innerHTML = `
    <div class="fm-modal__header">
      <h2 class="fm-modal__title">${escHtml(title)}</h2>
      <button class="fm-modal__close" aria-label="Close">×</button>
    </div>
    <div class="fm-modal__body">${content}</div>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector('.fm-modal__close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 300));
  return dialog;
}

// ─── Helpers ──────────────────────────────────────────────────
function createDialog(size = 'md') {
  const d = document.createElement('dialog');
  d.className = `fm-modal fm-modal--${size}`;
  
  // Override showModal to automatically lock body scroll
  const originalShowModal = d.showModal;
  d.showModal = function() {
    document.body.classList.add('modal-open');
    originalShowModal.call(d);
  };
  
  // Clean up class when dialog is closed
  d.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
  });
  
  return d;
}

function renderField(field, value = '') {
  const req = field.required ? 'required' : '';
  const reqMark = field.required ? '<span class="req">*</span>' : '';
  const v = value ?? '';

  switch (field.type) {
    case 'textarea':
      return `<div class="form-group">
        <label for="mf-${field.name}">${escHtml(field.label)}${reqMark}</label>
        <textarea id="mf-${field.name}" name="${field.name}" rows="3" ${req}>${escHtml(v)}</textarea>
        ${field.hint ? `<small class="form-hint">${escHtml(field.hint)}</small>` : ''}
      </div>`;

    case 'select':
      const opts = (field.options || []).map(o => {
        const val = typeof o === 'object' ? o.value : o;
        const lbl = typeof o === 'object' ? o.label : o;
        return `<option value="${escHtml(val)}" ${val == v ? 'selected' : ''}>${escHtml(lbl)}</option>`;
      }).join('');
      return `<div class="form-group">
        <label for="mf-${field.name}">${escHtml(field.label)}${reqMark}</label>
        <select id="mf-${field.name}" name="${field.name}" ${req}>
          <option value="">-- Select --</option>${opts}
        </select>
        ${field.hint ? `<small class="form-hint">${escHtml(field.hint)}</small>` : ''}
      </div>`;

    case 'checkbox':
      return `<div class="form-group form-group--inline">
        <input type="checkbox" id="mf-${field.name}" name="${field.name}" ${v === true || v === 'TRUE' || v === '1' ? 'checked' : ''}>
        <label for="mf-${field.name}">${escHtml(field.label)}</label>
      </div>`;

    default:
      return `<div class="form-group">
        <label for="mf-${field.name}">${escHtml(field.label)}${reqMark}</label>
        <input type="${field.type || 'text'}" id="mf-${field.name}" name="${field.name}" 
          value="${escHtml(v)}" ${req} ${field.placeholder ? `placeholder="${escHtml(field.placeholder)}"` : ''}
          ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}
          ${field.step ? `step="${field.step}"` : ''}>
        ${field.hint ? `<small class="form-hint">${escHtml(field.hint)}</small>` : ''}
      </div>`;
  }
}

function validateForm(form, fields) {
  let valid = true;
  fields.forEach(f => {
    const el = form.querySelector(`[name="${f.name}"]`);
    if (!el) return;
    el.classList.remove('input--error');
    if (f.required && !el.value && el.type !== 'checkbox') {
      el.classList.add('input--error');
      valid = false;
    }
  });
  return valid;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
