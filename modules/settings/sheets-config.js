// ============================================================
// modules/settings/sheets-config.js — Connection Settings
// Web App URL (primary) or API Key fallback
// ============================================================
import { testConnection, initializeAllSheets, fixIsActiveStatus } from '../supabase-api.js';
import { toast } from '../../components/toast.js';
import { confirm } from '../../components/modal.js';
import { CONFIG } from '../config.js';

export function renderSheetsConfig(container) {
  const savedWebApp = localStorage.getItem('fm_webapp_url') || CONFIG.WEBAPP_URL || '';
  const savedId     = localStorage.getItem('fm_spreadsheet_id') || CONFIG.SPREADSHEET_ID || '';
  const savedKey    = localStorage.getItem('fm_api_key') || CONFIG.API_KEY || '';

  container.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Connection Settings</h1><p class="page-subtitle">Connect the app to your Google Spreadsheet</p></div>
    </div>

    <!-- ── Recommended: Web App URL ─────────────────────────── -->
    <div class="card" style="max-width:720px;border-left:4px solid var(--color-primary)">
      <div class="card__header">
        <h3 class="card__title">✅ Google Apps Script Web App (Recommended)</h3>
      </div>
      <div class="card__body">
        <p style="font-size:0.875rem;color:var(--color-text-muted);margin-bottom:1rem">
          Paste your deployed Apps Script <code>/exec</code> URL here. No API key required — the script handles all authentication.
        </p>
        <form id="webapp-form" class="form-grid" novalidate>
          <div class="form-group form-group--full">
            <label for="cfg-webapp-url">Apps Script Web App URL <span class="req">*</span></label>
            <input
              type="url"
              id="cfg-webapp-url"
              value="${escHtml(savedWebApp)}"
              placeholder="https://script.google.com/macros/s/ABC.../exec"
            >
            <small class="form-hint">
              In Apps Script: <strong>Deploy → Manage Deployments → Web App → Copy URL</strong>
            </small>
          </div>
          <div class="form-actions form-group--full">
            <button type="submit" class="btn btn--primary">Save Web App URL</button>
            <button type="button" class="btn btn--ghost" id="test-webapp-btn">🔌 Test Connection</button>
            <button type="button" class="btn btn--ghost btn--sm" id="clear-webapp-btn">Clear</button>
          </div>
        </form>
        <div id="webapp-status" style="margin-top:1rem"></div>
      </div>
    </div>

    <!-- ── Alternative: API Key mode ────────────────────────── -->
    <details class="card" style="max-width:720px">
      <summary class="card__header" style="cursor:pointer;user-select:none;list-style:none">
        <h3 class="card__title">🔑 Alternative: Google Sheets API Key (Advanced)</h3>
        <span style="font-size:0.75rem;color:var(--color-text-muted)">Only use this if you are NOT using the Apps Script Web App</span>
      </summary>
      <div class="card__body">
        <form id="apikey-form" class="form-grid" novalidate>
          <div class="form-group form-group--full">
            <label for="cfg-sheet-id">Spreadsheet ID <span class="req">*</span></label>
            <input type="text" id="cfg-sheet-id" value="${escHtml(savedId)}" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms">
            <small class="form-hint">Found in your Sheet URL: docs.google.com/spreadsheets/d/<strong>[ID]</strong>/edit</small>
          </div>
          <div class="form-group form-group--full">
            <label for="cfg-api-key">API Key</label>
            <input type="password" id="cfg-api-key" value="${escHtml(savedKey)}" placeholder="AIzaSy...">
            <small class="form-hint">Google Cloud Console → Credentials → API Key (restrict to Sheets API)</small>
          </div>
          <div class="form-actions form-group--full">
            <button type="submit" class="btn btn--ghost">Save API Key Config</button>
          </div>
        </form>
      </div>
    </details>

    <!-- ── First-time Sheet Init ─────────────────────────────── -->
    <div class="card" style="max-width:720px">
      <div class="card__header"><h3 class="card__title">⚙ Initialize Google Sheet Tabs</h3></div>
      <div class="card__body">
        <p style="font-size:0.875rem;color:var(--color-text-muted);margin-bottom:1rem">
          Creates all required sheet tabs with correct column headers. Run this once after connecting.
          <br><strong>Tip:</strong> If you've already run the Apps Script <code>setupFlavourmax()</code> function, you don't need this.
        </p>
        <button class="btn btn--primary" id="init-sheets-btn">Initialize All Sheet Tabs</button>
        <div id="init-progress" style="display:none;margin-top:1rem" class="init-progress"></div>
      </div>
    </div>

    <!-- ── Fix is_active ───────────────────────────────────── -->
    <div class="card" style="max-width:720px;border-left:4px solid var(--color-warning)">
      <div class="card__header"><h3 class="card__title">🔧 Fix Dropdown Data (is_active Repair)</h3></div>
      <div class="card__body">
        <p style="font-size:0.875rem;color:var(--color-text-muted);margin-bottom:1rem">
          If Company / Product / Ingredient dropdowns appear empty, it means existing records
          have <code>is_active = FALSE</code> or blank. Click below to set
          <code>is_active = TRUE</code> on every row in all master (dim) sheets.
        </p>
        <button class="btn btn--warning" id="fix-active-btn">🔧 Fix Active Status on All Master Data</button>
        <div id="fix-active-status" style="margin-top:1rem"></div>
      </div>
    </div>

    <!-- ── Setup Guide ───────────────────────────────────────── -->
    <div class="card" style="max-width:720px">
      <div class="card__header"><h3 class="card__title">📋 Quick Setup Guide</h3></div>
      <div class="card__body setup-guide">
        <ol>
          <li>Open your <a href="https://sheets.google.com" target="_blank" rel="noopener">Google Sheet</a> → Extensions → Apps Script</li>
          <li>Paste the code from <code>google-sheets-setup.gs</code> and save</li>
          <li>Run <strong>setupFlavourmax()</strong> to create all tabs + sample data</li>
          <li>Then: <strong>Deploy → New Deployment → Web App</strong></li>
          <li>Set: Execute as <strong>Me</strong> · Access: <strong>Anyone</strong></li>
          <li>Copy the <code>/exec</code> URL and paste it above</li>
          <li>Click <strong>Save Web App URL</strong> → <strong>Test Connection</strong></li>
        </ol>
      </div>
    </div>
  `;

  // ── Web App URL form ─────────────────────────────────────────
  document.getElementById('webapp-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('cfg-webapp-url')?.value.trim();
    if (!url) { toast.warning('Please enter the Web App URL.'); return; }
    localStorage.setItem('fm_webapp_url', url);
    // Clear API key mode if switching to web app
    showStatus('webapp-status', 'success', '✓ Web App URL saved. Click "Test Connection" to verify.');
    toast.success('Web App URL saved.');
  });

  document.getElementById('test-webapp-btn')?.addEventListener('click', async () => {
    const url = document.getElementById('cfg-webapp-url')?.value.trim();
    if (!url) { toast.warning('Enter and save the URL first.'); return; }
    localStorage.setItem('fm_webapp_url', url);
    const btn = document.getElementById('test-webapp-btn');
    btn.disabled = true; btn.textContent = 'Testing…';
    try {
      const title = await testConnection();
      showStatus('webapp-status', 'success', `✓ Connected! Spreadsheet: "${title}"`);
      toast.success(`Connected to: "${title}"`);
    } catch (err) {
      showStatus('webapp-status', 'error', '✗ ' + err.message + ' — Make sure the Web App is deployed with access "Anyone".');
      toast.error('Connection failed: ' + err.message);
    } finally { btn.disabled = false; btn.textContent = '🔌 Test Connection'; }
  });

  document.getElementById('clear-webapp-btn')?.addEventListener('click', () => {
    localStorage.removeItem('fm_webapp_url');
    document.getElementById('cfg-webapp-url').value = '';
    showStatus('webapp-status', '', '');
    toast.info('Web App URL cleared.');
  });

  // ── API Key fallback form ────────────────────────────────────
  document.getElementById('apikey-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id  = document.getElementById('cfg-sheet-id')?.value.trim();
    const key = document.getElementById('cfg-api-key')?.value.trim();
    if (!id) { toast.warning('Spreadsheet ID is required.'); return; }
    localStorage.setItem('fm_spreadsheet_id', id);
    if (key) localStorage.setItem('fm_api_key', key);
    toast.success('API Key config saved.');
  });

  // ── Sheet Initializer ────────────────────────────────────────
  document.getElementById('init-sheets-btn')?.addEventListener('click', async () => {
    const ok = await confirm({
      title: 'Initialize Sheet Tabs',
      message: 'This will create all required sheet tabs and add header rows. Existing data will not be modified. Proceed?',
      confirmText: 'Initialize',
    });
    if (!ok) return;

    const progress = document.getElementById('init-progress');
    const btn      = document.getElementById('init-sheets-btn');
    progress.style.display = '';
    btn.disabled = true;

    try {
      await initializeAllSheets((msg, done, total) => {
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        progress.innerHTML = `
          <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
          <p class="progress-msg">${escHtml(msg)}</p>`;
      });
      toast.success('All sheet tabs initialized successfully!');
      progress.innerHTML += '<p class="progress-done">✓ Setup complete.</p>';
    } catch (err) {
      toast.error('Initialization failed: ' + err.message);
    } finally { btn.disabled = false; }
  });

  // ── Fix is_active button ──────────────────────────────
  document.getElementById('fix-active-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('fix-active-btn');
    const status = document.getElementById('fix-active-status');
    btn.disabled = true; btn.textContent = 'Fixing…';
    try {
      const res = await fixIsActiveStatus();
      const msg = res?.message || `Fixed ${res?.fixed ?? '?'} rows.`;
      showStatus('fix-active-status', 'success', '\u2713 ' + msg + ' Reload the page to see updated dropdowns.');
      toast.success('is_active repair complete.');
    } catch (err) {
      showStatus('fix-active-status', 'error', '\u2717 ' + err.message);
      toast.error('Fix failed: ' + err.message);
    } finally { btn.disabled = false; btn.textContent = '\ud83d\udd27 Fix Active Status on All Master Data'; }
  });

  // Pre-fill URL if we already have it stored
  if (savedWebApp) {
    showStatus('webapp-status', 'info', '✓ Web App URL is configured. Test it to verify.');
  }
}

function showStatus(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  const colors = { success: 'var(--color-success-soft)', error: 'var(--color-danger-soft)', info: 'var(--color-info-soft)' };
  const textColors = { success: 'var(--color-success)', error: 'var(--color-danger)', info: 'var(--color-info)' };
  el.innerHTML = `<p style="padding:0.75rem 1rem;background:${colors[type]||''};color:${textColors[type]||''};border-radius:8px;font-size:0.875rem;">${escHtml(msg)}</p>`;
}

function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
