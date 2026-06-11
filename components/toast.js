// ============================================================
// components/toast.js — Toast Notification System
// Uses native Popover API for non-intrusive stacking toasts
// ============================================================

export function initToasts() {
  if (document.getElementById('fm-toast-host')) return;
  const host = document.createElement('div');
  host.id = 'fm-toast-host';
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);

  window.addEventListener('fm:toast', (e) => {
    const { type = 'info', message = '', duration = 4000 } = e.detail || {};
    showToast(type, message, duration);
  });
}

export function showToast(type = 'info', message = '', duration = 4000) {
  const host = document.getElementById('fm-toast-host');
  if (!host) return;

  const toast = document.createElement('div');
  toast.className = `fm-toast fm-toast--${type}`;
  toast.setAttribute('role', 'status');

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  toast.innerHTML = `
    <span class="fm-toast__icon">${icons[type] || icons.info}</span>
    <span class="fm-toast__msg">${escHtml(message)}</span>
    <button class="fm-toast__close" aria-label="Dismiss">×</button>
  `;

  toast.querySelector('.fm-toast__close').addEventListener('click', () => dismiss(toast));
  host.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('fm-toast--visible'));

  const timer = setTimeout(() => dismiss(toast), duration);
  toast._timer = timer;
}

function dismiss(toast) {
  clearTimeout(toast._timer);
  toast.classList.remove('fm-toast--visible');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
}

// Convenience exports
export const toast = {
  success: (msg) => showToast('success', msg),
  error:   (msg) => showToast('error',   msg, 6000),
  warning: (msg) => showToast('warning', msg),
  info:    (msg) => showToast('info',    msg),
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
