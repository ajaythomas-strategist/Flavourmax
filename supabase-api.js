// ============================================================
// supabase-api.js — Flavourmax Backend Client (Supabase)
// Drop-in replacement for sheets-api.js
// All exported function signatures are identical.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG, SHEETS, COLUMNS, ID_PREFIXES } from './config.js?v=3';

// ─── Supabase Client ──────────────────────────────────────────
let supabase;
try {
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
} catch (err) {
  console.error('[Supabase] Client init failed — data features disabled:', err.message);
  supabase = null;
}

function _sb() {
  if (!supabase) throw new Error('Supabase client not initialised. Check SUPABASE_URL and SUPABASE_ANON_KEY in config.js.');
  return supabase;
}

// ─── Dim cache ────────────────────────────────────────────────
const _cache = {};

const DIM_SHEETS = [
  SHEETS.COMPANIES, SHEETS.PRODUCTS, SHEETS.CATEGORIES, SHEETS.INGREDIENTS,
  SHEETS.UNITS, SHEETS.PROCESSES, SHEETS.PROCESS_FIELDS, SHEETS.RECIPES,
  SHEETS.USERS, SHEETS.WAREHOUSES, SHEETS.SUPPLIERS
];

// ─── No-op stubs for Google-specific exports ──────────────────
// auth.js imports these; they do nothing in Supabase mode
export function setAccessToken() {}
export function getAccessToken() { return null; }
export function isWebAppConnected() { return true; }

// ─── Core Read ────────────────────────────────────────────────

/**
 * Read all rows of a sheet/table.
 * In Supabase mode returns an array of objects (not 2D arrays).
 * parseSheetRows() handles both formats.
 */
export async function sheetsRead(rangeOrSheet) {
  const sheetName = rangeOrSheet.split('!')[0].replace(/'/g, '');
  try {
    const { data, error } = await _sb().from(sheetName).select('*');
    if (error) { console.warn('[sheetsRead] failed:', error.message); return []; }
    return data || [];
  } catch (err) {
    console.warn('[sheetsRead] exception:', err.message);
    return [];
  }
}

/** Batch read multiple tables in parallel. Returns [{values: objectArray}, ...] */
export async function sheetsBatchRead(ranges) {
  const sheetNames = [...new Set(ranges.map(r => r.split('!')[0].replace(/'/g, '')))];
  try {
    const results = await Promise.all(
      sheetNames.map(name => _sb().from(name).select('*').then(({ data }) => data || []))
    );
    const sheetMap = {};
    sheetNames.forEach((name, i) => { sheetMap[name] = results[i]; });
    return ranges.map(r => ({ values: sheetMap[r.split('!')[0].replace(/'/g, '')] || [] }));
  } catch (err) {
    console.warn('[sheetsBatchRead] failed:', err.message);
    return ranges.map(() => ({ values: [] }));
  }
}

/** Read all rows of a table as objects */
export async function readAllRows(sheetName) {
  try {
    const { data, error } = await _sb().from(sheetName).select('*');
    if (error) { console.warn('[readAllRows] failed:', error.message); return []; }
    return data || [];
  } catch (err) {
    console.warn('[readAllRows] exception:', err.message);
    return [];
  }
}

// ─── Core Write ───────────────────────────────────────────────

/**
 * Append rows to a table.
 * rows: array of arrays (column-ordered, matching COLUMNS[sheetName])
 * Converts to objects before inserting.
 */
export async function sheetsAppend(sheetName, rows) {
  const cols = COLUMNS[sheetName] || [];
  const BOOL_COLS = ['is_active', 'is_required', 'is_corrected'];
  const objects = rows.map(row => {
    const obj = {};
    cols.forEach((col, i) => {
      let val = row[i] ?? null;
      if (BOOL_COLS.includes(col)) {
        val = (val === 'TRUE' || val === true || val === 1) ? true
            : (val === 'FALSE' || val === false || val === 0) ? false
            : (val === null || val === '') ? true
            : Boolean(val);
      }
      obj[col] = (val === '') ? null : val;
    });
    return obj;
  });
  const { error } = await _sb().from(sheetName).insert(objects);
  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Update a record by ID.
 * In Supabase, 'range' is treated as sheetName and 'id' from rowData's PK.
 * Note: direct callers should prefer updateFullRow().
 */
export async function sheetsUpdate(rangeOrSheet, values) {
  // Legacy stub — not used in Supabase mode since all callers use updateFullRow.
  console.warn('[sheetsUpdate] called in Supabase mode — use updateFullRow() instead.');
}

// ─── Row-Level Operations ─────────────────────────────────────

/**
 * Find a record by its primary key ID.
 * Returns the ID string if found, null if not found.
 * NOTE: Unlike sheets-api.js which returned a row number,
 *       this returns the ID itself (or null). Callers must
 *       check: if (id) { ... } instead of if (rowNum > 0) { ... }
 */
export async function findRowById(sheetName, id) {
  const pkCol = COLUMNS[sheetName]?.[0] || 'id';
  try {
    const { data, error } = await _sb().from(sheetName).select(pkCol).eq(pkCol, id).maybeSingle();
    if (error || !data) return null;
    return data[pkCol];
  } catch (err) {
    console.warn('[findRowById] exception:', err.message);
    return null;
  }
}

/**
 * Read a record by its ID, returned as a column-ordered array.
 * In Supabase mode, the first argument ('rowNum') is the record's primary key ID.
 */
export async function readRowByNumber(sheetName, id) {
  const pkCol = COLUMNS[sheetName]?.[0] || 'id';
  try {
    const { data } = await _sb().from(sheetName).select('*').eq(pkCol, id).maybeSingle();
    if (!data) return [];
    const cols = COLUMNS[sheetName] || [];
    return cols.map(col => data[col] ?? '');
  } catch (err) {
    console.warn('[readRowByNumber] exception:', err.message);
    return [];
  }
}

/**
 * Update a full record by its primary key ID.
 * rowData: object with all fields to update.
 */
export async function updateFullRow(sheetName, id, rowData) {
  const pkCol = COLUMNS[sheetName]?.[0] || 'id';
  const BOOL_COLS = ['is_active', 'is_required', 'is_corrected'];

  const updateData = { ...rowData };
  BOOL_COLS.forEach(col => {
    if (col in updateData) {
      updateData[col] = (updateData[col] === 'TRUE' || updateData[col] === true);
    }
  });

  // Auto-set updated_at if column exists
  const hasUpdatedAt = (COLUMNS[sheetName] || []).includes('updated_at');
  if (hasUpdatedAt && !updateData.updated_at) {
    updateData.updated_at = new Date().toISOString();
  }

  // Strip keys not declared in COLUMNS to prevent "column not found" errors in Supabase
  const schemaCols = COLUMNS[sheetName];
  if (schemaCols) {
    Object.keys(updateData).forEach(k => {
      if (!schemaCols.includes(k)) delete updateData[k];
    });
  }

  // Remove undefined / null-ish values
  Object.keys(updateData).forEach(k => { if (updateData[k] === undefined) delete updateData[k]; });

  const { error } = await _sb().from(sheetName).update(updateData).eq(pkCol, id);
  if (error) throw new Error(error.message);
}

/** Soft delete — sets is_active = false */
export async function softDelete(sheetName, id) {
  const pkCol = COLUMNS[sheetName]?.[0] || 'id';
  const hasUpdatedAt = (COLUMNS[sheetName] || []).includes('updated_at');
  const updateData = { is_active: false };
  if (hasUpdatedAt) updateData.updated_at = new Date().toISOString();
  const { error } = await _sb().from(sheetName).update(updateData).eq(pkCol, id);
  if (error) throw new Error(error.message);
}

/** Hard delete — permanently removes the record */
export async function hardDelete(sheetName, id) {
  const pkCol = COLUMNS[sheetName]?.[0] || 'id';
  const { error } = await _sb().from(sheetName).delete().eq(pkCol, id);
  if (error) throw new Error(error.message);
}

// ─── ID & Invoice Generation ──────────────────────────────────

export async function generateId(sheetName) {
  const prefix = ID_PREFIXES[sheetName] || 'ID';
  const pkCol  = COLUMNS[sheetName]?.[0] || 'id';
  try {
    const { data } = await supabase
      .from(sheetName)
      .select(pkCol)
      .like(pkCol, `${prefix}-%`)
      .order(pkCol, { ascending: false })
      .limit(1);
    if (!data || data.length === 0) return `${prefix}-001`;
    const lastNum = parseInt(data[0][pkCol].split('-').pop()) || 0;
    return `${prefix}-${String(lastNum + 1).padStart(3, '0')}`;
  } catch {
    return `${prefix}-001`;
  }
}

export async function generateInvoiceNo() {
  const year = new Date().getFullYear();
  try {
    const { data } = await supabase
      .from(SHEETS.SALES)
      .select('invoice_no')
      .like('invoice_no', `INV-${year}-%`)
      .order('invoice_no', { ascending: false })
      .limit(1);
    if (!data || data.length === 0) return `INV-${year}-0001`;
    const lastNum = parseInt(data[0].invoice_no.split('-').pop()) || 0;
    return `INV-${year}-${String(lastNum + 1).padStart(4, '0')}`;
  } catch {
    return `INV-${year}-0001`;
  }
}

// ─── Inventory Balance ────────────────────────────────────────

export async function updateInventoryBalance(ingredientId, deltaIn, deltaOut) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from(SHEETS.INVENTORY_BALANCE)
    .select('*')
    .eq('ingredient_id', ingredientId)
    .maybeSingle();

  if (existing) {
    const newIn  = parseFloat(existing.total_in  || 0) + (parseFloat(deltaIn)  || 0);
    const newOut = parseFloat(existing.total_out || 0) + (parseFloat(deltaOut) || 0);
    const balance = newIn - newOut;
    const { error } = await supabase
      .from(SHEETS.INVENTORY_BALANCE)
      .update({ total_in: newIn, total_out: newOut, current_balance: balance, last_updated: now })
      .eq('ingredient_id', ingredientId);
    if (error) throw new Error(error.message);
    return balance;
  } else {
    const balId = await generateId(SHEETS.INVENTORY_BALANCE);
    const inAmt  = parseFloat(deltaIn)  || 0;
    const outAmt = parseFloat(deltaOut) || 0;
    const { error } = await supabase
      .from(SHEETS.INVENTORY_BALANCE)
      .insert({
        balance_id: balId,
        ingredient_id: ingredientId,
        total_in: inAmt,
        total_out: outAmt,
        current_balance: inAmt - outAmt,
        last_updated: now,
      });
    if (error) throw new Error(error.message);
    return inAmt - outAmt;
  }
}

export async function getIngredientBalance(ingredientId) {
  const { data } = await supabase
    .from(SHEETS.INVENTORY_BALANCE)
    .select('*')
    .eq('ingredient_id', ingredientId)
    .maybeSingle();
  return data || null;
}

// ─── Dim Table Cache ──────────────────────────────────────────

export async function loadDimCache(force = false) {
  if (!force && _cache.__loaded) return _cache;
  await Promise.all(DIM_SHEETS.map(async s => {
    const { data } = await _sb().from(s).select('*');
    _cache[s] = data || [];
  }));
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

/**
 * Parse rows into objects.
 * If values are already objects (from Supabase), returns them directly.
 * If values are 2D arrays (legacy), converts using COLUMNS definition.
 */
export function parseSheetRows(sheetName, values) {
  if (!values || values.length === 0) return [];
  // Detect Supabase objects (not arrays)
  if (typeof values[0] === 'object' && !Array.isArray(values[0])) return values;
  // Legacy 2D-array path (backward compat)
  const cols = COLUMNS[sheetName];
  if (!cols) return [];
  const start = (values[0]?.[0] === cols[0]) ? 1 : 0;
  return values.slice(start).map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i] ?? ''; });
    return obj;
  });
}

export function activeOnly(rows) {
  return rows.filter(r => {
    const v = r.is_active;
    if (v === 'FALSE' || v === false || v === '0' || v === '' || v === null || v === undefined) return false;
    return true;
  });
}

// ─── Connection / Settings stubs ─────────────────────────────
// These exist in sheets-api.js; kept as stubs so settings page doesn't crash.

export async function testConnection() {
  const { data, error } = await _sb().from('dim_units').select('unit_id').limit(1);
  if (error) throw new Error('Supabase connection failed: ' + error.message);
  return 'Supabase Connected';
}

export async function fixIsActiveStatus() {
  // No-op in Supabase mode — is_active is a proper boolean, no fix needed.
  return { success: true };
}

export async function initializeAllSheets(onProgress) {
  // No-op in Supabase mode — tables are created via SQL schema.
  if (onProgress) onProgress('Tables already created via SQL schema.', 1, 1);
}
