// ============================================================
// sheets-api.js — Flavourmax Backend Client
// Uses Google Apps Script Web App as backend (no API key needed)
// Falls back to Google Sheets REST API if Web App URL not set
// ============================================================

import { CONFIG, SHEETS, COLUMNS, ID_PREFIXES } from './config.js?v=4';

// ─── Runtime state ───────────────────────────────────────────
let _accessToken = null;
const _cache = {};

// Connection health: null=unknown, true=ok, false=offline
let _webAppOk = null;
let _offlineToastShown = false;

// ─── Token Management ─────────────────────────────────────────
export function setAccessToken(token) { _accessToken = token; }
export function getAccessToken() { return _accessToken; }
export function isWebAppConnected() { return _webAppOk === true; }

// ─── Config helpers ───────────────────────────────────────────
function getWebAppUrl() {
  return localStorage.getItem('fm_webapp_url') || CONFIG.WEBAPP_URL || '';
}

function getSpreadsheetId() {
  return localStorage.getItem('fm_spreadsheet_id') || CONFIG.SPREADSHEET_ID || '';
}

function getApiKey() {
  return localStorage.getItem('fm_api_key') || CONFIG.API_KEY || '';
}

function useWebApp() {
  return !!getWebAppUrl();
}

function _showOfflineToast() {
  if (_offlineToastShown) return;
  _offlineToastShown = true;
  // Dispatch via event so we don't need to import toast here
  window.dispatchEvent(new CustomEvent('fm:toast', {
    detail: {
      type: 'warning',
      message: '⚠ Google Sheets not connected. Pages will show empty data. Redeploy the Apps Script and reload.'
    }
  }));
}

// ─── Fetch with timeout ────────────────────────────────────────
const FETCH_TIMEOUT_MS  = 30_000; // 30 s — Apps Script cold start can take ~20 s
const FETCH_RETRY_DELAY = 2_000;  // wait 2 s before retry

async function _fetchWithTimeout(input, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const e = new Error('Request timed out — the backend is still waking up. Retrying…');
      e.isTimeout = true;
      throw e;
    }
    throw err;
  }
}

// ─── Web App Request (Apps Script backend) ────────────────────
async function _doWebAppGet(params, attempt = 1) {
  const url  = getWebAppUrl();
  const qs   = new URLSearchParams(params).toString();
  const full = `${url}?${qs}`;
  let res;
  try {
    res = await _fetchWithTimeout(full, { redirect: 'follow' });
  } catch (err) {
    if (err.isTimeout && attempt === 1) {
      // Auto-retry once — cold start may have finished by now
      await new Promise(r => setTimeout(r, FETCH_RETRY_DELAY));
      return _doWebAppGet(params, 2);
    }
    _webAppOk = false;
    _showOfflineToast();
    throw new Error(err.isTimeout
      ? 'Backend timed out after retrying. Check your internet connection or reload the page.'
      : 'Google Sheets unreachable (network error). Check your Apps Script deployment.');
  }
  if (!res.ok) {
    _webAppOk = false;
    _showOfflineToast();
    throw new Error(`Web App error ${res.status} — redeploy the Apps Script as a Web App.`);
  }
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    _webAppOk = false;
    _showOfflineToast();
    throw new Error('Apps Script not deployed correctly. Deploy with "Execute as: Me" and "Access: Anyone".');
  }
  let data;
  try { data = JSON.parse(text); } catch {
    _webAppOk = false;
    _showOfflineToast();
    throw new Error('Web App returned invalid JSON — save + redeploy the Apps Script.');
  }
  if (data.error) {
    _webAppOk = true;
    throw new Error(data.error);
  }
  _webAppOk = true;
  _offlineToastShown = false;
  return data;
}

async function webAppGet(params = {}) {
  return _doWebAppGet(params, 1);
}

async function _doWebAppPost(body, attempt = 1) {
  const url = getWebAppUrl();
  let res;
  try {
    res = await _fetchWithTimeout(url, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(body),
      redirect: 'follow',
    });
  } catch (err) {
    if (err.isTimeout && attempt === 1) {
      await new Promise(r => setTimeout(r, FETCH_RETRY_DELAY));
      return _doWebAppPost(body, 2);
    }
    _webAppOk = false;
    _showOfflineToast();
    throw new Error(err.isTimeout
      ? 'Backend timed out after retrying. Reload the page to try again.'
      : 'Google Sheets unreachable (network error). Check your Apps Script deployment.');
  }
  if (!res.ok) {
    _webAppOk = false;
    _showOfflineToast();
    throw new Error(`Web App error ${res.status} — redeploy the Apps Script as a Web App.`);
  }
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    _webAppOk = false;
    _showOfflineToast();
    throw new Error('Apps Script not deployed correctly. Deploy with "Execute as: Me" and "Access: Anyone".');
  }
  let data;
  try { data = JSON.parse(text); } catch {
    _webAppOk = false;
    _showOfflineToast();
    throw new Error('Web App returned invalid JSON — save + redeploy the Apps Script.');
  }
  if (data.error) {
    _webAppOk = true;
    throw new Error(data.error);
  }
  _webAppOk = true;
  return data;
}

async function webAppPost(body = {}) {
  return _doWebAppPost(body, 1);
}

// ─── Google Sheets REST API (fallback) ────────────────────────
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function buildSheetsUrl(path, params = {}) {
  const id  = getSpreadsheetId();
  const key = getApiKey();
  if (!id) throw new Error('Spreadsheet ID not configured. Go to Settings → Sheets Config.');
  const base = `${SHEETS_API_BASE}/${id}${path}`;
  const qp   = new URLSearchParams(params);
  if (key && !_accessToken) qp.set('key', key);
  const qs   = qp.toString();
  return qs ? `${base}?${qs}` : base;
}

function authHeader() {
  if (_accessToken) return { Authorization: `Bearer ${_accessToken}` };
  return {};
}

async function sheetsFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...authHeader(), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let msg = `Sheets API error ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ─── Core Read ────────────────────────────────────────────────

/** Read a full sheet, returns 2D array of values */
export async function sheetsRead(rangeOrSheet) {
  // Normalise: if range looks like "sheet!A:J", extract sheet name for Web App
  const sheetName = rangeOrSheet.split('!')[0].replace(/'/g, '');

  if (useWebApp()) {
    try {
      const data = await webAppGet({ action: 'read', sheet: sheetName });
      return data.values || [];
    } catch (err) {
      console.warn('[sheetsRead] failed:', err.message);
      return [];
    }
  }
  // Fallback to REST API
  try {
    const url  = buildSheetsUrl(`/values/${encodeURIComponent(rangeOrSheet)}`);
    const data = await sheetsFetch(url);
    return data.values || [];
  } catch (err) {
    console.warn('[sheetsRead] REST failed:', err.message);
    return [];
  }
}

/** Batch read multiple sheets in one call */
export async function sheetsBatchRead(ranges) {
  if (useWebApp()) {
    try {
      // Extract unique sheet names from ranges like "dim_companies!A:J"
      const sheetNames = [...new Set(ranges.map(r => r.split('!')[0].replace(/'/g, '')))];
      const data = await webAppGet({ action: 'batchRead', sheets: sheetNames.join(',') });
      const results = data.valueRanges || [];

      // Map sheet name to its values
      const sheetMap = {};
      sheetNames.forEach((name, i) => { sheetMap[name] = results[i]?.values || []; });

      // Reconstruct the response in the exact order of the original ranges
      return ranges.map(r => ({ values: sheetMap[r.split('!')[0].replace(/'/g, '')] || [] }));
    } catch (err) {
      console.warn('[sheetsBatchRead] failed:', err.message);
      // Return empty arrays for each requested range so pages render safely
      return ranges.map(() => ({ values: [] }));
    }
  }
  // Fallback to REST API batchGet
  try {
    const qs  = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const id  = getSpreadsheetId();
    const key = getApiKey();
    if (!id) throw new Error('Spreadsheet ID not configured.');
    let url = `${SHEETS_API_BASE}/${id}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`;
    if (key && !_accessToken) url += `&key=${key}`;
    const res = await fetch(url, { headers: { ...authHeader() } });
    if (!res.ok) { const j = await res.json(); throw new Error(j.error?.message || 'BatchRead failed'); }
    const data = await res.json();
    return data.valueRanges || [];
  } catch (err) {
    console.warn('[sheetsBatchRead] REST failed:', err.message);
    return ranges.map(() => ({ values: [] }));
  }
}

// ─── Core Write ───────────────────────────────────────────────

/** Append rows to a sheet */
export async function sheetsAppend(sheetName, rows) {
  if (useWebApp()) {
    return webAppPost({ action: 'append', sheet: sheetName, values: rows });
  }
  // Fallback REST API
  const range = `${sheetName}!A1`;
  const url   = buildSheetsUrl(`/values/${encodeURIComponent(range)}:append`, {
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
  });
  return sheetsFetch(url, { method: 'POST', body: JSON.stringify({ values: rows }) });
}

/** Update a range (by A1 notation string) */
export async function sheetsUpdate(range, values) {
  if (useWebApp()) {
    // Parse row number from range like "dim_companies!A5:J5"
    const rowMatch = range.match(/(\d+)/);
    const rowNum   = rowMatch ? parseInt(rowMatch[1]) : null;
    const sheet    = range.split('!')[0].replace(/'/g, '');
    if (!rowNum) throw new Error('Cannot parse row number from range: ' + range);
    return webAppPost({ action: 'update', sheet, row: rowNum, values });
  }
  // Fallback REST API
  const url = buildSheetsUrl(`/values/${encodeURIComponent(range)}`, { valueInputOption: 'USER_ENTERED' });
  return sheetsFetch(url, { method: 'PUT', body: JSON.stringify({ values }) });
}

// ─── Row-Level Operations ─────────────────────────────────────

/** Find 1-indexed row number for a given ID in column A */
export async function findRowById(sheetName, id) {
  if (useWebApp()) {
    const data = await webAppPost({ action: 'findRow', sheet: sheetName, id });
    return data.rowNumber || -1;
  }
  const values = await sheetsRead(`${sheetName}!A:A`);
  const flat   = (values || []).flat();
  const idx    = flat.findIndex(v => v === id);
  return idx >= 0 ? idx + 1 : -1;
}

/** Read a full row by row number */
export async function readRowByNumber(sheetName, rowNum) {
  if (useWebApp()) {
    const data = await webAppPost({ action: 'readRow', sheet: sheetName, row: rowNum });
    return data.values || [];
  }
  const cols    = COLUMNS[sheetName];
  const lastCol = String.fromCharCode(65 + cols.length - 1);
  const values  = await sheetsRead(`${sheetName}!A${rowNum}:${lastCol}${rowNum}`);
  return values?.[0] || [];
}

/** Update an entire row object */
export async function updateFullRow(sheetName, rowNum, rowData) {
  const cols     = COLUMNS[sheetName];
  const lastCol  = String.fromCharCode(65 + cols.length - 1);
  const rowValues = cols.map(col => rowData[col] ?? '');
  await sheetsUpdate(`${sheetName}!A${rowNum}:${lastCol}${rowNum}`, [rowValues]);
}

/** Read all rows of a sheet as objects */
export async function readAllRows(sheetName, maxRows = 2000) {
  const values = await sheetsRead(`${sheetName}!A1:Z${maxRows + 1}`);
  return parseSheetRows(sheetName, values);
}

/** Soft delete — set is_active = FALSE */
export async function softDelete(sheetName, id) {
  const rowNum = await findRowById(sheetName, id);
  if (rowNum < 0) throw new Error(`Record ${id} not found in ${sheetName}`);
  const cols        = COLUMNS[sheetName];
  const isActiveCol = cols.indexOf('is_active');
  const updatedAtCol = cols.indexOf('updated_at');
  if (isActiveCol < 0) throw new Error('No is_active column on ' + sheetName);
  await updateFieldInRow(sheetName, rowNum, isActiveCol, 'FALSE');
  if (updatedAtCol >= 0) await updateFieldInRow(sheetName, rowNum, updatedAtCol, new Date().toISOString());
}

/** Hard delete — physically removes the row from the sheet */
export async function hardDelete(sheetName, id) {
  const rowNum = await findRowById(sheetName, id);
  if (rowNum < 0) throw new Error(`Record ${id} not found in ${sheetName}`);
  if (useWebApp()) {
    await webAppPost({ action: 'deleteRow', sheet: sheetName, row: rowNum });
    return;
  }
  throw new Error('Hard delete requires the Web App backend');
}

/** Update a single field */
export async function updateFieldInRow(sheetName, rowNumber, colIndex, value) {
  const colLetter = String.fromCharCode(65 + colIndex);
  await sheetsUpdate(`${sheetName}!${colLetter}${rowNumber}`, [[value]]);
}

// ─── ID & Invoice Generation ──────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }

export async function generateId(sheetName) {
  const prefix = ID_PREFIXES[sheetName] || 'ID';
  const today  = todayStr();
  if (useWebApp()) {
    const data = await webAppPost({ action: 'generateId', sheet: sheetName, prefix });
    return data.id || `${prefix}-${today}-001`;
  }
  try {
    const values = await sheetsRead(`${sheetName}!A:A`);
    const ids    = (values || []).flat().filter(v => String(v).startsWith(`${prefix}-${today}`));
    const seq    = ids.length > 0 ? Math.max(...ids.map(id => parseInt(id.split('-').pop()) || 0)) + 1 : 1;
    return `${prefix}-${today}-${String(seq).padStart(3, '0')}`;
  } catch {
    return `${prefix}-${today}-001`;
  }
}

export async function generateInvoiceNo() {
  if (useWebApp()) {
    const data = await webAppPost({ action: 'generateInvoice' });
    return data.invoice_no || `INV-${todayStr()}-001`;
  }
  const prefix = 'INV';
  const today  = todayStr();
  try {
    const values = await sheetsRead(`${SHEETS.SALES}!B:B`);
    const nos    = (values || []).flat().filter(v => String(v).startsWith(`${prefix}-${today}`));
    const seq    = nos.length > 0 ? Math.max(...nos.map(n => parseInt(n.split('-').pop()) || 0)) + 1 : 1;
    return `${prefix}-${today}-${String(seq).padStart(3, '0')}`;
  } catch {
    return `${prefix}-${today}-001`;
  }
}

// ─── Inventory Balance ────────────────────────────────────────

export async function updateInventoryBalance(ingredientId, deltaIn, deltaOut) {
  if (useWebApp()) {
    return webAppPost({ action: 'updateBalance', ingredient_id: ingredientId, qty_in: deltaIn, qty_out: deltaOut });
  }
  // Fallback: read-modify-write
  const rows     = await readAllRows(SHEETS.INVENTORY_BALANCE);
  const existing = rows.find(r => r.ingredient_id === ingredientId);
  const now      = new Date().toISOString();
  if (existing) {
    const rowNum = await findRowById(SHEETS.INVENTORY_BALANCE, existing.balance_id);
    const newIn  = parseFloat(existing.total_in  || 0) + (deltaIn  || 0);
    const newOut = parseFloat(existing.total_out || 0) + (deltaOut || 0);
    await sheetsUpdate(`${SHEETS.INVENTORY_BALANCE}!A${rowNum}:F${rowNum}`,
      [[existing.balance_id, ingredientId, String(newIn), String(newOut), String(newIn - newOut), now]]);
    return newIn - newOut;
  } else {
    const balId = await generateId(SHEETS.INVENTORY_BALANCE);
    await sheetsAppend(SHEETS.INVENTORY_BALANCE, [[balId, ingredientId, deltaIn, deltaOut, deltaIn - deltaOut, now]]);
    return deltaIn - deltaOut;
  }
}

export async function getIngredientBalance(ingredientId) {
  const rows = await readAllRows(SHEETS.INVENTORY_BALANCE);
  return rows.find(r => r.ingredient_id === ingredientId) || null;
}

// ─── Dim Table Cache ──────────────────────────────────────────
const DIM_SHEETS = [
  SHEETS.COMPANIES, SHEETS.PRODUCTS, SHEETS.CATEGORIES, SHEETS.INGREDIENTS,
  SHEETS.UNITS, SHEETS.PROCESSES, SHEETS.PROCESS_FIELDS, SHEETS.RECIPES,
  SHEETS.USERS, SHEETS.WAREHOUSES, SHEETS.SUPPLIERS
];

export async function loadDimCache(force = false) {
  if (!force && _cache.__loaded) return _cache;
  const ranges = DIM_SHEETS.map(s => `${s}!A:Z`);
  const batchResult = await sheetsBatchRead(ranges);
  batchResult.forEach((vr, i) => {
    const name = DIM_SHEETS[i];
    _cache[name] = parseSheetRows(name, vr.values || []);
  });
  _cache.__loaded = true;
  return _cache;
}

export function getDimCache(sheetName) { return _cache[sheetName] || []; }
export function clearDimCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

// ─── Parsing Helpers ──────────────────────────────────────────

export function parseRows(values) {
  if (!values || values.length < 2) return [];
  const [headers, ...rows] = values;
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

export function parseSheetRows(sheetName, values) {
  const cols = COLUMNS[sheetName];
  if (!values || values.length === 0 || !cols) return [];
  const start = (values[0]?.[0] === cols[0]) ? 1 : 0;
  return values.slice(start).map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i] ?? ''; });
    return obj;
  });
}

export function activeOnly(rows) {
  // Accepts: 'TRUE' (string), true (boolean), '1', any truthy non-false value
  // Rejects: 'FALSE', false, '0', '' (empty = unset = treat as inactive)
  return rows.filter(r => {
    const v = r.is_active;
    if (v === 'FALSE' || v === false || v === '0' || v === '' || v === null || v === undefined) return false;
    return true;
  });
}

// ─── Spreadsheet Init (for Settings page) ────────────────────

export async function testConnection() {
  if (useWebApp()) {
    const data = await webAppGet({ action: 'ping' });
    return data.title || 'Connected';
  }
  const url  = buildSheetsUrl('');
  const meta = await sheetsFetch(url);
  return meta.properties?.title || 'Connected';
}

/** Set is_active = TRUE on all existing dim sheet rows (repairs blank/FALSE seed data) */
export async function fixIsActiveStatus() {
  if (useWebApp()) {
    return webAppPost({ action: 'fixIsActive' });
  }
  throw new Error('fixIsActive requires the Apps Script Web App. Please configure it in Settings first.');
}

export async function initializeAllSheets(onProgress) {
  if (useWebApp()) {
    if (onProgress) onProgress('Initializing via Web App…', 0, 1);
    await webAppPost({ action: 'initSheets' });
    if (onProgress) onProgress('Done!', 1, 1);
    return;
  }
  // Fallback: REST API sheet creation
  const meta           = await sheetsFetch(buildSheetsUrl(''));
  const existingSheets = (meta.sheets || []).map(s => s.properties.title);
  const allSheets      = Object.values(SHEETS);
  let done = 0;
  for (const sheetName of allSheets) {
    if (onProgress) onProgress(`Initializing ${sheetName}…`, done, allSheets.length);
    if (!existingSheets.includes(sheetName)) {
      await sheetsFetch(buildSheetsUrl(':batchUpdate'), {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
      });
    }
    if (COLUMNS[sheetName]) {
      const headerUrl = buildSheetsUrl(`/values/${encodeURIComponent(sheetName + '!A1')}`, { valueInputOption: 'USER_ENTERED' });
      await fetch(headerUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ values: [COLUMNS[sheetName]] }) });
    }
    done++;
    await new Promise(r => setTimeout(r, 200));
  }
  if (onProgress) onProgress('Done!', allSheets.length, allSheets.length);
}
