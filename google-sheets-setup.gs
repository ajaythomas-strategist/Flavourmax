/**
 * ============================================================
 *  Flavourmax Manufacturing Management — Google Apps Script
 * ============================================================
 *  This script serves as the backend API for the Flavourmax
 *  web app. It handles ALL reads and writes to the Google Sheet.
 *
 *  DEPLOYMENT:
 *  1. Extensions → Apps Script → paste this code → Save
 *  2. Deploy → New Deployment → Type: Web App
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  3. Copy the /exec URL and paste into the web app settings
 *
 *  API USAGE:
 *  GET  ?action=read&sheet=dim_companies
 *  GET  ?action=batchRead&sheets=dim_companies,dim_products
 *  POST { action:"append", sheet:"dim_companies", values:[[...]] }
 *  POST { action:"update", sheet:"dim_companies", row:5, values:[[...]] }
 *  POST { action:"findRow", sheet:"dim_companies", id:"COMP-001" }
 *  POST { action:"initSheets" }
 * ============================================================
 */

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── GET Handler ──────────────────────────────────────────────
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || 'read';

    if (action === 'ping') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse({ ok: true, title: ss.getName(), id: ss.getId() });
    }

    if (action === 'read') {
      const sheet = params.sheet;
      const range = params.range || '';
      if (!sheet) return jsonResponse({ error: 'sheet parameter required' });

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(sheet);
      if (!sh) return jsonResponse({ values: [] });

      const data = range
        ? sh.getRange(range).getValues()
        : sh.getDataRange().getValues();

      return jsonResponse({ values: data });
    }

    if (action === 'batchRead') {
      const sheetsParam = params.sheets || '';
      const sheetNames = sheetsParam.split(',').map(s => s.trim()).filter(Boolean);
      const ss = SpreadsheetApp.getActiveSpreadsheet();

      const result = sheetNames.map(name => {
        const sh = ss.getSheetByName(name);
        if (!sh) return { values: [] };
        return { values: sh.getDataRange().getValues() };
      });

      return jsonResponse({ valueRanges: result });
    }

    if (action === 'getSpreadsheetInfo') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse({ title: ss.getName(), id: ss.getId() });
    }

    return jsonResponse({ error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack });
  }
}

// ─── POST Handler ─────────────────────────────────────────────
function doPost(e) {
  try {
    let body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    } else {
      body = e.parameter || {};
    }

    const action = body.action;

    // ── Append rows ─────────────────────────────────────────
    if (action === 'append') {
      const ss   = SpreadsheetApp.getActiveSpreadsheet();
      const sh   = getOrCreateSheet(ss, body.sheet);
      const rows = body.values || [];
      if (rows.length === 0) return jsonResponse({ ok: true, appended: 0 });

      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length)
        .setValues(rows);

      return jsonResponse({ ok: true, appended: rows.length, newLastRow: sh.getLastRow() });
    }

    // ── Update a single row ──────────────────────────────────
    if (action === 'update') {
      const ss  = SpreadsheetApp.getActiveSpreadsheet();
      const sh  = ss.getSheetByName(body.sheet);
      if (!sh) return jsonResponse({ error: 'Sheet not found: ' + body.sheet });

      const rowNum = parseInt(body.row);
      const values = body.values || [];
      if (!rowNum || values.length === 0) return jsonResponse({ error: 'row and values required' });

      sh.getRange(rowNum, 1, values.length, values[0].length).setValues(values);
      return jsonResponse({ ok: true, updatedRow: rowNum });
    }

    // ── Find row by ID (column A) ────────────────────────────
    if (action === 'findRow') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(body.sheet);
      if (!sh) return jsonResponse({ rowNumber: -1 });

      const lastRow = sh.getLastRow();
      if (lastRow === 0) return jsonResponse({ rowNumber: -1 });
      const colA = sh.getRange(1, 1, lastRow, 1).getValues().flat();
      const idx  = colA.indexOf(body.id);
      return jsonResponse({ rowNumber: idx >= 0 ? idx + 1 : -1 });
    }

    // ── Read a specific row by number ────────────────────────
    if (action === 'readRow') {
      const ss  = SpreadsheetApp.getActiveSpreadsheet();
      const sh  = ss.getSheetByName(body.sheet);
      if (!sh) return jsonResponse({ values: [] });
      const row = sh.getRange(body.row, 1, 1, sh.getLastColumn()).getValues();
      return jsonResponse({ values: row[0] });
    }

    // ── Update inventory balance ─────────────────────────────
    if (action === 'updateBalance') {
      const ss  = SpreadsheetApp.getActiveSpreadsheet();
      const sh  = ss.getSheetByName('fact_inventory_balance');
      if (!sh) return jsonResponse({ error: 'fact_inventory_balance not found' });

      const ingId  = body.ingredient_id;
      const addIn  = parseFloat(body.qty_in  || 0);
      const addOut = parseFloat(body.qty_out || 0);

      const data   = sh.getDataRange().getValues();
      let found    = false;

      for (let i = 1; i < data.length; i++) {
        if (data[i][1] === ingId) {
          const totalIn  = parseFloat(data[i][2] || 0) + addIn;
          const totalOut = parseFloat(data[i][3] || 0) + addOut;
          const balance  = totalIn - totalOut;
          sh.getRange(i + 1, 3, 1, 4).setValues([[totalIn, totalOut, balance, new Date().toISOString()]]);
          found = true;
          break;
        }
      }

      if (!found) {
        // Create new balance row
        const newId  = 'BAL-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
        const balance = addIn - addOut;
        sh.appendRow([newId, ingId, addIn, addOut, balance, new Date().toISOString()]);
      }

      return jsonResponse({ ok: true, ingredient_id: ingId });
    }

    // ── Generate next sequential ID ──────────────────────────
    if (action === 'generateId') {
      const ss     = SpreadsheetApp.getActiveSpreadsheet();
      const sh     = ss.getSheetByName(body.sheet);
      const prefix = body.prefix || 'ID';
      const today  = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd');
      let seq = 1;
      if (sh && sh.getLastRow() > 1) {
        const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat();
        const dailyIds = ids.filter(v => String(v).startsWith(prefix + '-' + today));
        if (dailyIds.length > 0) {
          const maxSeq = Math.max(...dailyIds.map(id => {
            const parts = String(id).split('-');
            return parseInt(parts[parts.length - 1], 10) || 0;
          }));
          seq = maxSeq + 1;
        }
      }
      const newId  = prefix + '-' + today + '-' + String(seq).padStart(3, '0');
      return jsonResponse({ id: newId });
    }

    // ── Generate invoice number ──────────────────────────────
    if (action === 'generateInvoice') {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sh    = ss.getSheetByName('fact_sales');
      const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd');
      const prefix = 'INV';
      let seq = 1;
      if (sh && sh.getLastRow() > 1) {
        const nos = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().flat();
        const dailyNos = nos.filter(v => String(v).startsWith(prefix + '-' + today));
        if (dailyNos.length > 0) {
          const maxSeq = Math.max(...dailyNos.map(n => {
            const parts = String(n).split('-');
            return parseInt(parts[parts.length - 1], 10) || 0;
          }));
          seq = maxSeq + 1;
        }
      }
      const inv = prefix + '-' + today + '-' + String(seq).padStart(3, '0');
      return jsonResponse({ invoice_no: inv });
    }

    // ── Initialize all sheets ────────────────────────────────
    if (action === 'initSheets') {
      initAllSheets();
      return jsonResponse({ ok: true, message: 'All sheets initialized.' });
    }

    // ── Full setup: init + clear dim + seed real data + processes ─
    if (action === 'fullSetup') {
      initAllSheets();
      // Clear all dim sheets (rows 2+)
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const DIM_TO_CLEAR = [
        'dim_units','dim_categories','dim_products','dim_companies',
        'dim_ingredients','dim_warehouses','dim_suppliers','dim_users',
        'dim_processes','dim_process_fields','dim_recipes'
      ];
      DIM_TO_CLEAR.forEach(name => {
        const sh = ss.getSheetByName(name);
        if (sh && sh.getLastRow() > 1)
          sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      });
      // Seed real master data
      insertSampleData();
      // Seed processes & fields
      insertRicePowderProcesses(ss);
      insertFGMProcesses(ss);
      return jsonResponse({ ok: true, message: 'Full setup complete — real master data seeded.' });
    }

    // ── Fix is_active = TRUE on all dim sheets ───────────────
    if (action === 'fixIsActive') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const DIM_SHEETS = [
        'dim_companies', 'dim_products', 'dim_categories',
        'dim_ingredients', 'dim_units', 'dim_processes',
        'dim_process_fields', 'dim_recipes', 'dim_users', 'dim_warehouses', 'dim_suppliers'
      ];
      let totalFixed = 0;
      DIM_SHEETS.forEach(sheetName => {
        const sh = ss.getSheetByName(sheetName);
        if (!sh || sh.getLastRow() < 2) return;
        const schema = SHEET_SCHEMAS[sheetName];
        if (!schema) return;
        const isActiveIdx = schema.columns.indexOf('is_active');
        if (isActiveIdx < 0) return;
        const colLetter = String.fromCharCode(65 + isActiveIdx);
        const lastRow = sh.getLastRow();
        const range = sh.getRange(2, isActiveIdx + 1, lastRow - 1, 1);
        const values = range.getValues();
        let changed = false;
        const updated = values.map(([v]) => {
          if (v === 'TRUE') return [v];
          changed = true;
          totalFixed++;
          return ['TRUE'];
        });
        if (changed) range.setValues(updated);
      });
      return jsonResponse({ ok: true, fixed: totalFixed, message: `Fixed ${totalFixed} rows across dim sheets.` });
    }

    // ── Ping ────────────────────────────────────────────────
    if (action === 'ping') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse({ ok: true, title: ss.getName(), id: ss.getId() });
    }

    return jsonResponse({ error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack });
  }
}

// ─── Helper: Get or create a sheet ───────────────────────────
function getOrCreateSheet(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

// ===================================================================
//  SETUP FUNCTIONS (run manually from Apps Script IDE or via menu)
// ===================================================================

function setupFlavourmax() {
  initAllSheets();
  insertSampleData();
  resetAndSeedProcesses();  // Seeds Rice Powder + FGM processes & fields
  formatAllSheets();
  addSummaryDashboard();
  Logger.log('✅ Flavourmax setup complete!');
  SpreadsheetApp.getUi().alert(
    '✅ Setup Complete!\n\n' +
    'All sheet tabs created with headers, formatting, and sample data.\n\n' +
    'Web App URL is already set — just configure it in the web app Settings.\n\n' +
    'Spreadsheet ID: ' + SpreadsheetApp.getActiveSpreadsheet().getId()
  );
}

// ─── Sheet Definitions ───────────────────────────────────────
const SHEET_SCHEMAS = {
  dim_companies:              { columns: ['company_id','company_name','contact_person','phone','email','address','gstin','is_active','created_at','updated_at'], color: '#1d5c52', description: 'Client companies' },
  dim_products:               { columns: ['product_id','product_name','category_id','default_unit_id','description','is_active','created_at','updated_at'], color: '#1d5c52', description: 'Finished goods' },
  dim_categories:             { columns: ['category_id','category_name','description','is_active','created_at'], color: '#1d5c52', description: 'Product categories' },
  dim_ingredients:            { columns: ['ingredient_id','ingredient_name','unit_id','category','min_stock_alert','is_active','created_at','updated_at'], color: '#1d5c52', description: 'Raw materials' },
  dim_units:                  { columns: ['unit_id','unit_name','abbreviation','is_active','created_at'], color: '#1d5c52', description: 'Units of measurement' },
  dim_processes:              { columns: ['process_id','product_id','process_name','sequence_order','description','is_active','created_at'], color: '#1d5c52', description: 'Per-product process steps' },
  dim_process_fields:         { columns: ['field_id','process_id','field_name','field_label','field_type','field_options','is_required','sequence_order','is_active'], color: '#1d5c52', description: 'Dynamic process fields' },
  dim_recipes:                { columns: ['recipe_id','company_id','product_id','ingredient_id','quantity','unit_id','notes','is_active','created_at','updated_at'], color: '#1d5c52', description: 'Ingredient recipes' },
  dim_users:                  { columns: ['user_id','full_name','email','role','password_hash','is_active','created_at'], color: '#1d5c52', description: 'App users' },
  dim_warehouses:             { columns: ['warehouse_id','warehouse_name','location','is_active','created_at'], color: '#1d5c52', description: 'Storage locations' },
  dim_suppliers:              { columns: ['supplier_id','supplier_name','contact_person','phone','email','address','is_active','created_at','updated_at'], color: '#1d5c52', description: 'Raw material suppliers' },
  fact_inventory_in:          { columns: ['in_id','in_date','ingredient_id','supplier','quantity','unit_id','rate','total_cost','warehouse_id','invoice_no','notes','created_by','created_at'], color: '#1565c0', description: 'Stock receipts' },
  fact_inventory_out:         { columns: ['out_id','out_date','ingredient_id','batch_id','quantity','unit_id','reason','created_by','created_at'], color: '#1565c0', description: 'Stock consumption' },
  fact_inventory_balance:     { columns: ['balance_id','ingredient_id','total_in','total_out','current_balance','last_updated'], color: '#1565c0', description: 'Live inventory balance' },
  fact_production_batches:    { columns: ['batch_id','batch_date','product_id','company_id','planned_qty','actual_qty','unit_id','status','notes','created_by','created_at','updated_at'], color: '#e65100', description: 'Production batches' },
  fact_production_process_log:{ columns: ['log_id','batch_id','process_id','process_name','step_status','field_data_json','input_qty','input_unit','output_qty','output_unit','started_at','completed_at','completed_by','is_corrected','correction_ref_id'], color: '#e65100', description: 'Process log entries' },
  fact_dispatch:              { columns: ['dispatch_id','dispatch_date','company_id','product_id','batch_id','quantity','unit_id','vehicle_no','driver_name','notes','status','created_by','created_at'], color: '#6a1b9a', description: 'Dispatch records' },
  fact_sales:                 { columns: ['sale_id','invoice_no','sale_date','company_id','product_id','batch_id','quantity','unit_id','rate','amount','gst_percent','gst_amount','total_amount','status','created_by','created_at'], color: '#2e7d32', description: 'Sales invoices' },
  fact_sales_return:          { columns: ['return_id','return_date','sale_id','company_id','product_id','quantity','reason','status','created_by','created_at'], color: '#2e7d32', description: 'Sales returns' },
  fact_corrections:           { columns: ['correction_id','requested_at','requested_by','source_sheet','source_row_id','field_name','field_label','old_value','new_value','reason','status','reviewed_by','reviewed_at','review_note'], color: '#b71c1c', description: 'Correction requests' },
};

function initAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = Object.keys(SHEET_SCHEMAS);
  sheetNames.forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    const headers = SHEET_SCHEMAS[sheetName].columns;
    if (!sheet.getRange(1,1).getValue()) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground(SHEET_SCHEMAS[sheetName].color)
      .setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
    sheet.setRowHeight(1, 36);
    sheet.setFrozenRows(1);
    sheet.setTabColor(SHEET_SCHEMAS[sheetName].color);
  });
  Logger.log('✅ Sheets initialized');
}

function insertSampleData() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date().toISOString();

  // ── Units ────────────────────────────────────────────────────
  insertIfEmpty(ss, 'dim_units', [
    ['UNIT-001','Kilogram','KG','TRUE',now],
    ['UNIT-002','Numbers','NOS','TRUE',now],
    ['UNIT-003','Pieces','PCs','TRUE',now],
    ['UNIT-004','Gram','g','TRUE',now],
    ['UNIT-005','Litre','L','TRUE',now],
    ['UNIT-006','Millilitre','mL','TRUE',now],
  ]);

  // ── Categories ───────────────────────────────────────────────
  insertIfEmpty(ss, 'dim_categories', [
    ['CAT-001','Pickles','Pickled vegetables and fruits — FGM line','TRUE',now],
    ['CAT-002','Rice Products','Rice-based powders and flours','TRUE',now],
    ['CAT-003','Brine','Vegetables and fruits stored in brine solution','TRUE',now],
    ['CAT-004','Raw Materials','Spices, oils, and other raw ingredients','TRUE',now],
    ['CAT-005','Packaging Materials','Jars, cartons, caps, labels, tapes','TRUE',now],
  ]);

  // ── Products (real product lines only) ──────────────────────
  insertIfEmpty(ss, 'dim_products', [
    ['PROD-004','Rice Powder','CAT-002','UNIT-001','Rice powder products — Puttu Podi, Appam Podi, Chemba Puttu Podi, Wheat Puttu Podi','TRUE',now,now],
    ['PROD-009','FGM Products','CAT-001','UNIT-001','Finished goods — Pickles and preserves (FGM line)','TRUE',now,now],
  ]);

  // ── Companies / Customers (from Production & Rice Powder forms) ──
  insertIfEmpty(ss, 'dim_companies', [
    ['COMP-001','Anchima Traders','','','','','','TRUE',now,now],
    ['COMP-002','Angel UK','','','','','','TRUE',now,now],
    ['COMP-003','Arorn New Zealand','','','','','','TRUE',now,now],
    ['COMP-004','Berry Foods','','','','','','TRUE',now,now],
    ['COMP-005','Binoj Kalady','','','','','','TRUE',now,now],
    ['COMP-006','Bleeco Exports','','','','','','TRUE',now,now],
    ['COMP-007','Bodhini','','','','','','TRUE',now,now],
    ['COMP-008','CVM Malta','','','','','','TRUE',now,now],
    ['COMP-009','Caico','','','','','','TRUE',now,now],
    ['COMP-010','Chattas','','','','','','TRUE',now,now],
    ['COMP-011','Deepam','','','','','','TRUE',now,now],
    ['COMP-012','Divine Foods','','','','','','TRUE',now,now],
    ['COMP-013','Double Horse','','','','','','TRUE',now,now],
    ['COMP-014','Eastern','','','','','','TRUE',now,now],
    ['COMP-015','Five Star','','','','','','TRUE',now,now],
    ['COMP-016','Food Planet','','','','','','TRUE',now,now],
    ['COMP-017','Golden Chef','','','','','','TRUE',now,now],
    ['COMP-018','Green Park','','','','','','TRUE',now,now],
    ['COMP-019','HORAKA','','','','','','TRUE',now,now],
    ['COMP-020','Haritham','','','','','','TRUE',now,now],
    ['COMP-021','Hazen','','','','','','TRUE',now,now],
    ['COMP-022','High Range Australia','','','','','','TRUE',now,now],
    ['COMP-023','Jannathi','','','','','','TRUE',now,now],
    ['COMP-024','Kanchana Foods','','','','','','TRUE',now,now],
    ['COMP-025','Kitchen Scent','','','','','','TRUE',now,now],
    ['COMP-026','Kochikaran','','','','','','TRUE',now,now],
    ['COMP-027','Kozhikodans','','','','','','TRUE',now,now],
    ['COMP-028','Lakeshore Kuwait','','','','','','TRUE',now,now],
    ['COMP-029','Le Chef','','','','','','TRUE',now,now],
    ['COMP-030','MRJ','','','','','','TRUE',now,now],
    ['COMP-031','Maloos','','','','','','TRUE',now,now],
    ['COMP-032','Mamia','','','','','','TRUE',now,now],
    ['COMP-033','Manning Australia','','','','','','TRUE',now,now],
    ['COMP-034','No:1 Malabar','','','','','','TRUE',now,now],
    ['COMP-035','Organo Pickles','','','','','','TRUE',now,now],
    ['COMP-036','Quality','','','','','','TRUE',now,now],
    ['COMP-037','Royal Ireland','','','','','','TRUE',now,now],
    ['COMP-038','Sajan','','','','','','TRUE',now,now],
    ['COMP-039','Samco','','','','','','TRUE',now,now],
    ['COMP-040','Sanoop Canada','','','','','','TRUE',now,now],
    ['COMP-041','Saras','','','','','','TRUE',now,now],
    ['COMP-042','Season Foods','','','','','','TRUE',now,now],
    ['COMP-043','Shappad','','','','','','TRUE',now,now],
    ['COMP-044','Spike','','','','','','TRUE',now,now],
    ['COMP-045','Star Foods','','','','','','TRUE',now,now],
    ['COMP-046','Sumi Merchantile','','','','','','TRUE',now,now],
    ['COMP-047','Sunkey','','','','','','TRUE',now,now],
    ['COMP-048','Taqwa','','','','','','TRUE',now,now],
    ['COMP-049','Tiruvonam','','','','','','TRUE',now,now],
    ['COMP-050','Unifresh','','','','','','TRUE',now,now],
    ['COMP-051','V and J Trading','','','','','','TRUE',now,now],
    ['COMP-052','V-Crown','','','','','','TRUE',now,now],
    ['COMP-053','Vijayan Manjappra','','','','','','TRUE',now,now],
    // Rice Powder customers
    ['COMP-054','AMACO','','','','','','TRUE',now,now],
    ['COMP-055','ANU\'S Foods','','','','','','TRUE',now,now],
    ['COMP-056','Bimbo Bakeries','','','','','','TRUE',now,now],
    ['COMP-057','COOKMATIC','','','','','','TRUE',now,now],
    ['COMP-058','Grain N Grace','','','','','','TRUE',now,now],
    ['COMP-059','Jay','','','','','','TRUE',now,now],
    ['COMP-060','KPJ Foods','','','','','','TRUE',now,now],
    ['COMP-061','MA Exports','','','','','','TRUE',now,now],
    ['COMP-062','MELAM','','','','','','TRUE',now,now],
    ['COMP-063','Natures Best','','','','','','TRUE',now,now],
    ['COMP-064','RAIDCO','','','','','','TRUE',now,now],
    ['COMP-065','VEETTAMMA','','','','','','TRUE',now,now],
  ]);

  // ── Ingredients: Brine Items ─────────────────────────────────
  // ── Ingredients: Raw Materials (RM) ─────────────────────────
  // ── Ingredients: Packaging Materials (PM) ───────────────────
  insertIfEmpty(ss, 'dim_ingredients', [
    // Brine (raw material — CAT-003)
    ['ING-B01','6MM Mango','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B02','Beetroot in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B03','Birds Eye Chilly in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B04','Bittergourd','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B05','Bottle Gourd','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B06','Carrot in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B07','Carrot Long Cut','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B08','Chow Chow in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B09','Fresh Garlic in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B10','Ginger in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B11','Gooseberry in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B12','Green Chilly in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B13','KKK Natti (19MM Mango) Hand Cut','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B14','KKK Natti (19MM Mango) Paste','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B15','Lemon AP','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B16','Lemon HC','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B17','Mango Ginger in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B18','Pappaya','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B19','Pumpkin in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B20','Sliced Mango in Brine','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B21','Tender Mango','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B22','Unda Mulaku','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B23','Vadukapuli','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B24','VSR Natti (19MM Mango)','UNIT-001','Brine','0','TRUE',now,now],
    ['ING-B25','YU Natti (19MM Mango)','UNIT-001','Brine','0','TRUE',now,now],
    // Raw Materials (RM)
    ['ING-R01','Acetic Acid','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R02','Asafoetida Powder','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R03','Capsicum Oleoresin','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R04','Chilli Powder - Double Horse','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R05','Chilly Flakes','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R06','Chlorophyll (Green Color Oil)','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R07','Dates','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R08','Dates Crushed','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R09','Fenugreek','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R10','Furtium TR-30 Liquid','UNIT-005','Raw Material','0','TRUE',now,now],
    ['ING-R11','Garlic Flakes','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R12','Garlic Green Oleoresin','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R13','Gingelly Oil','UNIT-005','Raw Material','0','TRUE',now,now],
    ['ING-R14','Guar Gum','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R15','Jaggery','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R16','Kashmiri Chilly Powder','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R17','Modified Starch','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R18','Mustard','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R19','Mustard Seed','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R20','Paprica (Pickle Colour Oil)','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R21','Red Chilly Powder','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R22','Rice Bran Oil','UNIT-005','Raw Material','0','TRUE',now,now],
    ['ING-R23','Salt Crystal','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R24','Salt Powder','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R25','Sodium Benzoate','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R26','Sugar','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R27','Tamarind','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R28','Turmeric Oleoresin (Yellow Color)','UNIT-001','Raw Material','0','TRUE',now,now],
    ['ING-R29','Turmeric Powder','UNIT-001','Raw Material','0','TRUE',now,now],
    // Packaging Materials (PM)
    ['ING-P01','1 Inch Tape','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P02','1 KG Glass Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P03','1 KG Golden Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P04','150GM Cap - Double Horse','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P05','150GM Carton - Double Horse','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P06','1KG Induction Wad','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P07','1KG Induction Wad - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P08','1KG Liner - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P09','1KG Long Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P10','1KG Pickle Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P11','1KG Pickle Carton (Local)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P12','1KG Pickle Carton - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P13','1KG Pickle Jar & Cap - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P14','1KG Round Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P15','2 Inch Tape','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P16','200GM Local Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P17','200GM Pickle Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P18','200GM Induction Wad','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P19','200GM Kissan Bottle (150GM)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P20','200GM Paper Wad (Cap Inner Wad)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P21','200GM Pickle Bottle (Long)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P22','200GM Printed Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P23','200GM Red Plain Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P24','200GM Sleeve','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P25','300GM Paste Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P26','400GM Local Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P27','400G Five Star Carton','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P28','400G Le Chef Carton','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P29','400G Spike Carton','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P30','400GM Carton - Double Horse','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P31','400GM Black Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P32','400GM Golden Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P33','400GM Induction Wad','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P34','400GM Paper Wad (Cap Inner Wad)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P35','400GM Pickle Green Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P36','400GM Pickle White Plain Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P37','400GM Pickle White Printed Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P38','400GM Printed Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P39','400GM Red Plain Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P40','400GM Sleeve','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P41','400GM White Cap for Glass Bottle','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P42','5 KG Export Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P43','5 KG Induction Wad - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P44','5 KG Pickle Carton Printed (Local)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P45','5 KG Printed Carton','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P46','500GM Carton - Double Horse','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P47','5KG Induction Wad','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P48','5KG Liner - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P49','5KG Local Jar','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P50','5KG Pickle Carton (Local)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P51','5KG Pickle Carton - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P52','5KG Pickle Jar & Cap - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P53','5KG Plain Pickle Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P54','5KG Printed Pickle Carton (Export)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P55','5KG Sunkey Pickle Carton','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P56','Ferns Jar (400GM)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P57','Food Core (300GM)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P58','Label Space (400GM)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P59','Round Bottle (400GM)','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P60','Strapping Belt','UNIT-002','Packaging','0','TRUE',now,now],
    ['ING-P61','Strapping Belt - Eastern','UNIT-002','Packaging','0','TRUE',now,now],
  ]);

  // ── Storage Locations / Warehouses ───────────────────────────
  insertIfEmpty(ss, 'dim_warehouses', [
    ['WH-001','Brine Godown 1','Brine Storage','TRUE',now],
    ['WH-002','Brine Godown 2','Brine Storage','TRUE',now],
    ['WH-003','Brine Godown 3','Brine Storage','TRUE',now],
    ['WH-004','Brine Godown 4','Brine Storage','TRUE',now],
    ['WH-005','Ingredients Store','Raw Material Storage','TRUE',now],
    ['WH-006','PM Godown 1','Packaging Material Storage','TRUE',now],
    ['WH-007','PM Godown 2','Packaging Material Storage','TRUE',now],
    ['WH-008','PM Godown 3','Packaging Material Storage','TRUE',now],
    ['WH-009','RM Godown 1','Raw Material Storage','TRUE',now],
    ['WH-010','RM Godown 2','Raw Material Storage','TRUE',now],
    ['WH-011','Finished Goods Store','Dispatch Area','TRUE',now],
  ]);

  // ── Suppliers / Vendors ──────────────────────────────────────
  insertIfEmpty(ss, 'dim_suppliers', [
    ['SUP-001','AKAY','','','','','TRUE',now,now],
    ['SUP-002','AL MANGO','','','','','TRUE',now,now],
    ['SUP-003','AL NASSAR','','','','','TRUE',now,now],
    ['SUP-004','ANEESH','','','','','TRUE',now,now],
    ['SUP-005','ANTONY THRISSUR','','','','','TRUE',now,now],
    ['SUP-006','ASP VEGETABLES','','','','','TRUE',now,now],
    ['SUP-007','BABY STORES','','','','','TRUE',now,now],
    ['SUP-008','CCL','','','','','TRUE',now,now],
    ['SUP-009','CENTURE CONTAINERS','','','','','TRUE',now,now],
    ['SUP-010','CHOICE','','','','','TRUE',now,now],
    ['SUP-011','CONTINENTAL','','','','','TRUE',now,now],
    ['SUP-012','CV INDUSTRIES','','','','','TRUE',now,now],
    ['SUP-013','DUROPET','','','','','TRUE',now,now],
    ['SUP-014','DV PET','','','','','TRUE',now,now],
    ['SUP-015','FLAVOURMAX','','','','','TRUE',now,now],
    ['SUP-016','FRESH FRUITS AND VEGETABLES','','','','','TRUE',now,now],
    ['SUP-017','GLOBE ZONE','','','','','TRUE',now,now],
    ['SUP-018','HANEEF FOODS','','','','','TRUE',now,now],
    ['SUP-019','INDIAN SPICES','','','','','TRUE',now,now],
    ['SUP-020','KANCORE','','','','','TRUE',now,now],
    ['SUP-021','KWALITY PACKAGING','','','','','TRUE',now,now],
    ['SUP-022','MAM','','','','','TRUE',now,now],
    ['SUP-023','MB TRADERS','','','','','TRUE',now,now],
    ['SUP-024','PACK ART PVT LTD','','','','','TRUE',now,now],
    ['SUP-025','PAVIZHAM','','','','','TRUE',now,now],
    ['SUP-026','PJ MARKETING','','','','','TRUE',now,now],
    ['SUP-027','PLACO PACK PVT LTD','','','','','TRUE',now,now],
    ['SUP-028','POLYPET','','','','','TRUE',now,now],
    ['SUP-029','PREMIERE','','','','','TRUE',now,now],
    ['SUP-030','PS ENTERPRISES','','','','','TRUE',now,now],
    ['SUP-031','Q-PET','','','','','TRUE',now,now],
    ['SUP-032','SCADA SOLUTIONS','','','','','TRUE',now,now],
    ['SUP-033','SHENOYS','','','','','TRUE',now,now],
    ['SUP-034','SR FOODS','','','','','TRUE',now,now],
    ['SUP-035','SREE MAHA LAKSHMI AGRO FOODS','','','','','TRUE',now,now],
    ['SUP-036','SREERAMAKRISHNA INDUSTRIES','','','','','TRUE',now,now],
    ['SUP-037','SUPREME PACKERS','','','','','TRUE',now,now],
    ['SUP-038','SYNTHITE','','','','','TRUE',now,now],
    ['SUP-039','VASO OVERSEAS','','','','','TRUE',now,now],
    ['SUP-040','VIVEKA ESSENCE','','','','','TRUE',now,now],
    ['SUP-041','VJ FOODS','','','','','TRUE',now,now],
    ['SUP-042','VORA PACKAGING','','','','','TRUE',now,now],
    ['SUP-043','VSR AGRO FOODS','','','','','TRUE',now,now],
    ['SUP-044','XAVIER STORES','','','','','TRUE',now,now],
    ['SUP-045','YUVAN FOODS','','','','','TRUE',now,now],
  ]);

  // ── Users ────────────────────────────────────────────────────
  insertIfEmpty(ss, 'dim_users', [
    ['USR-001','Admin','admin@flavourmax.onmicrosoft.com','Admin','','TRUE',now],
    ['USR-002','Jio Thomas','jio@flavourmax.onmicrosoft.com','Production Staff','','TRUE',now],
    ['USR-003','Christo','christo@flavourmax.onmicrosoft.com','Supervisor','','TRUE',now],
    ['USR-004','Gouri','gouri@flavourmax.onmicrosoft.com','QC Staff','','TRUE',now],
    ['USR-005','Gatha','gatha@flavourmax.onmicrosoft.com','QC Staff','','TRUE',now],
    ['USR-006','Gayathri','gayathri@flavourmax.onmicrosoft.com','Supervisor','','TRUE',now],
  ]);

  // ── dim_processes & dim_process_fields are seeded by resetAndSeedProcesses()
  // (called separately — manages Rice Powder + FGM process definitions)

  Logger.log('✅ Real master data inserted');
}

function formatAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_SCHEMAS).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const numCols = SHEET_SCHEMAS[sheetName].columns.length;
    for (let r = 2; r <= 500; r += 2) {
      sheet.getRange(r, 1, 1, numCols).setBackground('#f8fafb');
    }
    sheet.setRowHeights(2, 499, 28);
    sheet.setTabColor(SHEET_SCHEMAS[sheetName].color);
  });
  Logger.log('✅ Formatting applied');
}

function addSummaryDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dash = ss.getSheetByName('📊 Dashboard');
  if (!dash) dash = ss.insertSheet('📊 Dashboard');
  ss.setActiveSheet(dash);
  ss.moveActiveSheet(1);
  dash.clear();
  dash.setTabColor('#37474f');

  dash.getRange('A1:F1').merge().setValue('FLAVOURMAX MANUFACTURING — GOOGLE SHEET DATABASE')
    .setBackground('#1d5c52').setFontColor('#fff').setFontWeight('bold').setFontSize(16)
    .setHorizontalAlignment('center');

  dash.getRange('A2:F2').merge()
    .setValue('Managed by Flavourmax Web App  |  Do not edit data directly in fact_ sheets')
    .setBackground('#1d5c52').setFontColor('#a5d6a7').setFontSize(10)
    .setHorizontalAlignment('center');

  dash.setRowHeight(1, 50);
  dash.setRowHeight(2, 30);

  // Web App URL section
  dash.getRange('A4:F4').merge().setValue('🌐 WEB APP BACKEND URL (paste this in Settings → Sheets Config)')
    .setFontWeight('bold').setFontColor('#b71c1c').setFontSize(11);
  dash.getRange('A5:F5').merge()
    .setValue('https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec  ← Replace with your /exec URL')
    .setFontFamily('Courier New').setBackground('#fff3e0').setFontSize(10);

  // Spreadsheet ID section
  dash.getRange('A7:F7').merge().setValue('🔑 SPREADSHEET ID (also needed in Settings)')
    .setFontWeight('bold').setFontColor('#1565c0').setFontSize(11);
  dash.getRange('A8:F8').merge()
    .setValue(ss.getId())
    .setFontFamily('Courier New').setBackground('#e3f2fd').setFontWeight('bold').setFontSize(11);

  // Sheet list
  let row = 10;
  dash.getRange(row, 1, 1, 4).setValues([['Sheet Name','Purpose','Columns','Records']])
    .setBackground('#37474f').setFontColor('#fff').setFontWeight('bold');
  row++;

  Object.entries(SHEET_SCHEMAS).forEach(([name, schema], i) => {
    const sh = ss.getSheetByName(name);
    const count = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
    dash.getRange(row, 1, 1, 4).setValues([[name, schema.description, schema.columns.length, count]]);
    if (i % 2 === 0) dash.getRange(row, 1, 1, 4).setBackground('#f5f5f5');
    row++;
  });

  dash.setColumnWidth(1, 260);
  dash.setColumnWidth(2, 300);
  dash.setColumnWidth(3, 80);
  dash.setColumnWidth(4, 80);
  Logger.log('✅ Dashboard added');
}

function insertIfEmpty(ss, sheetName, rows) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function clearAllFactData() {
  const ui = SpreadsheetApp.getUi();
  const r  = ui.alert('⚠ Clear All Transactional Data?', 'This will delete all records in fact_ sheets. Master data stays intact.', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_SCHEMAS).filter(n => n.startsWith('fact_')).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });
  ui.alert('✅ Transactional data cleared.');
}

function fixIsActive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const DIM_SHEETS = [
    'dim_companies', 'dim_products', 'dim_categories',
    'dim_ingredients', 'dim_units', 'dim_processes',
    'dim_process_fields', 'dim_recipes', 'dim_users', 'dim_warehouses'
  ];
  let totalFixed = 0;
  DIM_SHEETS.forEach(sheetName => {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    const schema = SHEET_SCHEMAS[sheetName];
    if (!schema) return;
    const isActiveIdx = schema.columns.indexOf('is_active');
    if (isActiveIdx < 0) return;
    const lastRow = sh.getLastRow();
    const range = sh.getRange(2, isActiveIdx + 1, lastRow - 1, 1);
    const values = range.getValues();
    let changed = false;
    const updated = values.map(([v]) => {
      if (v === 'TRUE') return [v];
      changed = true;
      totalFixed++;
      return ['TRUE'];
    });
    if (changed) range.setValues(updated);
  });
  SpreadsheetApp.getUi().alert(`✅ Done! Fixed ${totalFixed} rows \u2014 all dim sheet records are now is_active = TRUE.`);
  Logger.log(`Fixed ${totalFixed} rows`);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙ Flavourmax')
    .addItem('🚀 Full Setup (first time)', 'setupFlavourmax')
    .addSeparator()
    .addItem('📋 Initialize Sheets Only', 'initAllSheets')
    .addItem('📊 Refresh Dashboard', 'addSummaryDashboard')
    .addSeparator()
    .addItem('🔧 Fix is_active = TRUE (repair dropdowns)', 'fixIsActive')
    .addItem('🏭 Reset & Seed Process Data (Rice Powder + FGM)', 'resetAndSeedProcesses')
    .addSeparator()
    .addItem('🗑 Clear Transactional Data', 'clearAllFactData')
    .addToUi();
}

// ===================================================================
//  PROCESS + FIELD SEED DATA
//  Run resetAndSeedProcesses() from Apps Script menu to populate.
//  This clears dim_processes & dim_process_fields (rows 2+) then
//  re-inserts all product-specific process definitions.
// ===================================================================

function resetAndSeedProcesses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Clear existing data (keep headers)
  ['dim_processes','dim_process_fields'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1)
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });

  insertRicePowderProcesses(ss);
  insertFGMProcesses(ss);

  SpreadsheetApp.getUi().alert('✅ Process data seeded!\nRice Powder (11 processes) + FGM Products (4 processes).');
  Logger.log('✅ Process seed complete');
}

// ─── Rice Powder (PROD-004) — 11 processes from Form 1 ──────────
function insertRicePowderProcesses(ss) {
  const now = new Date().toISOString();
  const procSheet = ss.getSheetByName('dim_processes');
  const fldSheet  = ss.getSheetByName('dim_process_fields');

  const processes = [
    ['PROC-RP-001','PROD-004','Pre-Process - Washing', 1,'Pre-processing: rice washing step','TRUE',now],
    ['PROC-RP-002','PROD-004','Pre-Process - Steaming',2,'Pre-processing: rice steaming step','TRUE',now],
    ['PROC-RP-003','PROD-004','Pre-Process - Grinding',3,'Pre-processing: rice grinding step','TRUE',now],
    ['PROC-RP-004','PROD-004','Roasting',              4,'Rice roasting process','TRUE',now],
    ['PROC-RP-005','PROD-004','Packing',               5,'Rice powder packing process','TRUE',now],
    ['PROC-RP-006','PROD-004','Dispatch',              6,'Finished goods dispatch','TRUE',now],
    ['PROC-RP-007','PROD-004','Inward',                7,'Raw material inward process','TRUE',now],
    ['PROC-RP-008','PROD-004','Production',            8,'Production consumption tracking','TRUE',now],
    ['PROC-RP-009','PROD-004','Reselling',             9,'Reselling process','TRUE',now],
    ['PROC-RP-010','PROD-004','Return',               10,'Customer return process','TRUE',now],
    ['PROC-RP-011','PROD-004','Rework',               11,'Product rework process','TRUE',now],
  ];
  procSheet.getRange(procSheet.getLastRow()+1,1,processes.length,processes[0].length).setValues(processes);

  const fields = [
    // PROC-RP-001 Washing
    ['FLD-RP-001','PROC-RP-001','date',              'Date',                            'date',    '','FALSE',1,'TRUE'],
    ['FLD-RP-002','PROC-RP-001','process_id',        'Process ID',                      'text',    '','TRUE', 2,'TRUE'],
    ['FLD-RP-003','PROC-RP-001','item_name',         'Item Name',                       'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-004','PROC-RP-001','material_name',     'Name of the Material',            'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-005','PROC-RP-001','customer_name',     'Customer Name',                   'text',    '','FALSE',5,'TRUE'],
    ['FLD-RP-006','PROC-RP-001','market',            'Market',                          'text',    '','FALSE',6,'TRUE'],
    ['FLD-RP-007','PROC-RP-001','lot_number',        'Lot Number',                      'text',    '','FALSE',7,'TRUE'],
    ['FLD-RP-008','PROC-RP-001','man_power',         'Man Power',                       'number',  '','FALSE',8,'TRUE'],
    ['FLD-RP-009','PROC-RP-001','input_qty_kg',      'Input Quantity in Kg',            'number',  '','FALSE',9,'TRUE'],
    ['FLD-RP-010','PROC-RP-001','product_in_time',   'Product In Time for Washing',     'text',    '','FALSE',10,'TRUE'],
    ['FLD-RP-011','PROC-RP-001','product_out_time',  'Product Out Time after Washing',  'number',  '','FALSE',11,'TRUE'],
    // PROC-RP-002 Steaming
    ['FLD-RP-012','PROC-RP-002','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-013','PROC-RP-002','process_id',        'Process ID',                        'text',  '','TRUE', 2,'TRUE'],
    ['FLD-RP-014','PROC-RP-002','item_name',         'Item Name',                         'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-015','PROC-RP-002','material_name',     'Name of the Material',              'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-016','PROC-RP-002','customer_name',     'Customer Name',                     'text',  '','FALSE',5,'TRUE'],
    ['FLD-RP-017','PROC-RP-002','steamer',           'Steamer',                           'number','','FALSE',6,'TRUE'],
    ['FLD-RP-018','PROC-RP-002','total_manpower',    'Total Manpower',                    'number','','FALSE',7,'TRUE'],
    ['FLD-RP-019','PROC-RP-002','market',            'Market',                            'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-020','PROC-RP-002','lot_number',        'Lot Number',                        'text',  '','FALSE',9,'TRUE'],
    ['FLD-RP-021','PROC-RP-002','product_in_time',   'Product In Time for Steaming',      'text',  '','FALSE',10,'TRUE'],
    ['FLD-RP-022','PROC-RP-002','product_out_time',  'Product Out Time after Steaming',   'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-023','PROC-RP-002','maintained_pressure','Maintained Pressure for Steaming','number','','FALSE',12,'TRUE'],
    // PROC-RP-003 Grinding
    ['FLD-RP-024','PROC-RP-003','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-025','PROC-RP-003','process_id',        'Process ID',                        'text',  '','TRUE', 2,'TRUE'],
    ['FLD-RP-026','PROC-RP-003','item_name',         'Item Name',                         'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-027','PROC-RP-003','material_name',     'Name of the Material',              'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-028','PROC-RP-003','customer_name',     'Customer Name',                     'text',  '','FALSE',5,'TRUE'],
    ['FLD-RP-029','PROC-RP-003','market',            'Market',                            'text',  '','FALSE',6,'TRUE'],
    ['FLD-RP-030','PROC-RP-003','lot_number',        'Lot Number',                        'text',  '','FALSE',7,'TRUE'],
    ['FLD-RP-031','PROC-RP-003','product_in_time',   'Product In Time for Grinding',      'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-032','PROC-RP-003','product_out_time',  'Product Out Time after Grinding',   'text',  '','FALSE',9,'TRUE'],
    ['FLD-RP-033','PROC-RP-003','total_manpower',    'Total Manpower in No:s',            'number','','FALSE',10,'TRUE'],
    ['FLD-RP-034','PROC-RP-003','quality_status',    'Quality Status',                    'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-035','PROC-RP-003','quality_verified_by','Quality Verified By',              'text',  '','FALSE',12,'TRUE'],
    ['FLD-RP-036','PROC-RP-003','supervised_by',     'Supervised By',                     'text',  '','FALSE',13,'TRUE'],
    // PROC-RP-004 Roasting
    ['FLD-RP-037','PROC-RP-004','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-038','PROC-RP-004','process_id',        'Process ID',                        'text',  '','FALSE',2,'TRUE'],
    ['FLD-RP-039','PROC-RP-004','item_name',         'Item Name',                         'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-040','PROC-RP-004','customer_name',     'Customer Name',                     'text',  '','FALSE',4,'TRUE'],
    ['FLD-RP-041','PROC-RP-004','market',            'Market',                            'text',  '','FALSE',5,'TRUE'],
    ['FLD-RP-042','PROC-RP-004','lot_number',        'Lot Number',                        'text',  '','FALSE',6,'TRUE'],
    ['FLD-RP-043','PROC-RP-004','roaster',           'Roaster',                           'text',  '','FALSE',7,'TRUE'],
    ['FLD-RP-044','PROC-RP-004','product_in_time',   'Product In Time for Roasting',      'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-045','PROC-RP-004','product_out_time',  'Product Out Time after Roasting',   'text',  '','FALSE',9,'TRUE'],
    ['FLD-RP-046','PROC-RP-004','bin_no',            'Bin No: for Roasted Product Storage','number','','FALSE',10,'TRUE'],
    ['FLD-RP-047','PROC-RP-004','input_qty',         'Input Quantity',                    'number','','FALSE',11,'TRUE'],
    ['FLD-RP-048','PROC-RP-004','output_qty',        'Output Qty after Bin Emptying (Kg)','number','','FALSE',12,'TRUE'],
    ['FLD-RP-049','PROC-RP-004','total_manpower',    'Total Manpowers in No:s',           'number','','FALSE',13,'TRUE'],
    ['FLD-RP-050','PROC-RP-004','moisture_content',  'Moisture Content in %',             'number','','FALSE',14,'TRUE'],
    ['FLD-RP-051','PROC-RP-004','fineness',          'Fineness',                          'number','','FALSE',15,'TRUE'],
    ['FLD-RP-052','PROC-RP-004','quality_status',    'Quality Status',                    'text',  '','FALSE',16,'TRUE'],
    ['FLD-RP-053','PROC-RP-004','quality_verified_by','Quality Verified By',              'text',  '','FALSE',17,'TRUE'],
    ['FLD-RP-054','PROC-RP-004','supervised_by',     'Supervised By',                     'text',  '','FALSE',18,'TRUE'],
    // PROC-RP-005 Packing
    ['FLD-RP-055','PROC-RP-005','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-056','PROC-RP-005','item_name',         'Item Name',                         'dropdown','','FALSE',2,'TRUE'],
    ['FLD-RP-057','PROC-RP-005','sku',               'SKU',                               'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-058','PROC-RP-005','market',            'Market',                            'text',  '','FALSE',4,'TRUE'],
    ['FLD-RP-059','PROC-RP-005','batch_number',      'Batch Number',                      'text',  '','FALSE',5,'TRUE'],
    ['FLD-RP-060','PROC-RP-005','input_qty_kg',      'Input Quantity in Kg',              'number','','FALSE',6,'TRUE'],
    ['FLD-RP-061','PROC-RP-005','output_qty',        'Output Quantity',                   'number','','FALSE',7,'TRUE'],
    ['FLD-RP-062','PROC-RP-005','no_of_packets',     'No: of Packets',                    'number','','FALSE',8,'TRUE'],
    ['FLD-RP-063','PROC-RP-005','no_of_bags',        'No: of Bags',                       'number','','FALSE',9,'TRUE'],
    ['FLD-RP-064','PROC-RP-005','no_of_cartons',     'No: of Cartons',                    'number','','FALSE',10,'TRUE'],
    ['FLD-RP-065','PROC-RP-005','operator',          'Operator',                          'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-066','PROC-RP-005','total_time_hrs',    'Total Time Taken in Hrs',           'text',  '','FALSE',12,'TRUE'],
    ['FLD-RP-067','PROC-RP-005','quality_status',    'Quality Status',                    'text',  '','FALSE',13,'TRUE'],
    ['FLD-RP-068','PROC-RP-005','quality_verified_by','Quality Verified By',              'text',  '','FALSE',14,'TRUE'],
    ['FLD-RP-069','PROC-RP-005','supervised_by',     'Supervised By',                     'text',  '','FALSE',15,'TRUE'],
    ['FLD-RP-070','PROC-RP-005','remarks',           'Remarks',                           'text',  '','FALSE',16,'TRUE'],
    // PROC-RP-006 Dispatch
    ['FLD-RP-071','PROC-RP-006','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-072','PROC-RP-006','item_name',         'Item Name',                         'dropdown','','FALSE',2,'TRUE'],
    ['FLD-RP-073','PROC-RP-006','market',            'Market',                            'text',  '','FALSE',3,'TRUE'],
    ['FLD-RP-074','PROC-RP-006','sku',               'SKU',                               'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-075','PROC-RP-006','customer_name',     'Customer Name',                     'text',  '','FALSE',5,'TRUE'],
    ['FLD-RP-076','PROC-RP-006','customer_batch_no', 'Customer Batch Number',             'text',  '','FALSE',6,'TRUE'],
    ['FLD-RP-077','PROC-RP-006','total_qty_kg',      'Total Quantity in Kg',              'number','','FALSE',7,'TRUE'],
    ['FLD-RP-078','PROC-RP-006','total_no_packets',  'Total No: of Packets',              'number','','FALSE',8,'TRUE'],
    ['FLD-RP-079','PROC-RP-006','total_no_bags',     'Total No: of Bags',                 'number','','FALSE',9,'TRUE'],
    ['FLD-RP-080','PROC-RP-006','total_no_cartons',  'Total No: of Cartons',              'number','','FALSE',10,'TRUE'],
    ['FLD-RP-081','PROC-RP-006','fg_loaded_by',      'FG Loaded By',                      'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-082','PROC-RP-006','remarks',           'Remarks',                           'text',  '','FALSE',12,'TRUE'],
    // PROC-RP-007 Inward
    ['FLD-RP-083','PROC-RP-007','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-084','PROC-RP-007','vendor_name',       'Vendor Name',                       'dropdown','','FALSE',2,'TRUE'],
    ['FLD-RP-085','PROC-RP-007','item',              'Item',                              'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-086','PROC-RP-007','type_of_material',  'Type of Material',                  'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-087','PROC-RP-007','material_name',     'Name of the Material',              'dropdown','','FALSE',5,'TRUE'],
    ['FLD-RP-088','PROC-RP-007','qty_received',      'Quantity Received',                 'number','','FALSE',6,'TRUE'],
    ['FLD-RP-089','PROC-RP-007','uom',               'UOM',                               'dropdown','','FALSE',7,'TRUE'],
    ['FLD-RP-090','PROC-RP-007','storage_area',      'Storage Area',                      'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-091','PROC-RP-007','lot_numbers',       'Lot Numbers',                       'text',  '','FALSE',9,'TRUE'],
    ['FLD-RP-092','PROC-RP-007','quality_status',    'Quality Status',                    'text',  '','FALSE',10,'TRUE'],
    ['FLD-RP-093','PROC-RP-007','quality_verified_by','Quality Verified By',              'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-094','PROC-RP-007','stored_by',         'Stored By',                         'text',  '','FALSE',12,'TRUE'],
    ['FLD-RP-095','PROC-RP-007','remarks',           'Remarks',                           'text',  '','FALSE',13,'TRUE'],
    // PROC-RP-008 Production
    ['FLD-RP-096','PROC-RP-008','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-097','PROC-RP-008','vendor_name',       'Vendor Name',                       'dropdown','','FALSE',2,'TRUE'],
    ['FLD-RP-098','PROC-RP-008','item',              'Item',                              'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-099','PROC-RP-008','type_of_material',  'Type of Material',                  'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-100','PROC-RP-008','item_name',         'Item Name',                         'dropdown','','FALSE',5,'TRUE'],
    ['FLD-RP-101','PROC-RP-008','material_name',     'Name of the Material',              'dropdown','','FALSE',6,'TRUE'],
    ['FLD-RP-102','PROC-RP-008','total_qty_consumed','Total Quantity Consumed',           'number','','FALSE',7,'TRUE'],
    ['FLD-RP-103','PROC-RP-008','uom',               'UOM',                               'dropdown','','FALSE',8,'TRUE'],
    ['FLD-RP-104','PROC-RP-008','lot_numbers',       'Lot Numbers',                       'number','','FALSE',9,'TRUE'],
    ['FLD-RP-105','PROC-RP-008','customer_name',     'Customer Name',                     'text',  '','FALSE',10,'TRUE'],
    ['FLD-RP-106','PROC-RP-008','quality_status',    'Quality Status',                    'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-107','PROC-RP-008','quality_verified_by','Quality Verified By',              'text',  '','FALSE',12,'TRUE'],
    ['FLD-RP-108','PROC-RP-008','remarks',           'Remarks',                           'text',  '','FALSE',13,'TRUE'],
    // PROC-RP-009 Reselling
    ['FLD-RP-109','PROC-RP-009','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-110','PROC-RP-009','vendor_name',       'Vendor Name',                       'dropdown','','FALSE',2,'TRUE'],
    ['FLD-RP-111','PROC-RP-009','item',              'Item',                              'dropdown','','FALSE',3,'TRUE'],
    ['FLD-RP-112','PROC-RP-009','type_of_material',  'Type of Material',                  'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-113','PROC-RP-009','material_name',     'Name of the Material',              'dropdown','','FALSE',5,'TRUE'],
    ['FLD-RP-114','PROC-RP-009','total_qty_consumed','Total Quantity Consumed',           'number','','FALSE',6,'TRUE'],
    ['FLD-RP-115','PROC-RP-009','uom',               'UOM',                               'dropdown','','FALSE',7,'TRUE'],
    ['FLD-RP-116','PROC-RP-009','lot_numbers',       'Lot Numbers',                       'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-117','PROC-RP-009','buyer_name',        'Buyer Name',                        'text',  '','FALSE',9,'TRUE'],
    ['FLD-RP-118','PROC-RP-009','quality_status',    'Quality Status',                    'text',  '','FALSE',10,'TRUE'],
    ['FLD-RP-119','PROC-RP-009','quality_verified_by','Quality Verified By',              'text',  '','FALSE',11,'TRUE'],
    ['FLD-RP-120','PROC-RP-009','material_loaded_by','Material Loaded By',                'text',  '','FALSE',12,'TRUE'],
    ['FLD-RP-121','PROC-RP-009','remarks',           'Remarks',                           'text',  '','FALSE',13,'TRUE'],
    // PROC-RP-010 Return
    ['FLD-RP-122','PROC-RP-010','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-123','PROC-RP-010','product_name',      'Name of the Product',               'text',  '','FALSE',2,'TRUE'],
    ['FLD-RP-124','PROC-RP-010','total_qty_returned','Total Input Quantity Returned',     'number','','FALSE',3,'TRUE'],
    ['FLD-RP-125','PROC-RP-010','uom',               'UOM',                               'dropdown','','FALSE',4,'TRUE'],
    ['FLD-RP-126','PROC-RP-010','sku',               'SKU',                               'text',  '','FALSE',5,'TRUE'],
    ['FLD-RP-127','PROC-RP-010','batch_number',      'Batch Number',                      'number','','FALSE',6,'TRUE'],
    ['FLD-RP-128','PROC-RP-010','customer_name',     'Customer Name',                     'text',  '','FALSE',7,'TRUE'],
    ['FLD-RP-129','PROC-RP-010','received_condition','Product Received Condition',        'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-130','PROC-RP-010','return_reason',     'Return (Reason)',                   'text',  '','FALSE',9,'TRUE'],
    ['FLD-RP-131','PROC-RP-010','qty_damaged',       'Total Quantity of Damaged',         'number','','FALSE',10,'TRUE'],
    // PROC-RP-011 Rework
    ['FLD-RP-132','PROC-RP-011','date',              'Date',                              'date',  '','FALSE',1,'TRUE'],
    ['FLD-RP-133','PROC-RP-011','product_name',      'Name of the Product',               'dropdown','','FALSE',2,'TRUE'],
    ['FLD-RP-134','PROC-RP-011','old_batch_number',  'Old Batch Number',                  'number','','FALSE',3,'TRUE'],
    ['FLD-RP-135','PROC-RP-011','new_batch_number',  'New Batch Number',                  'number','','FALSE',4,'TRUE'],
    ['FLD-RP-136','PROC-RP-011','total_qty_reworked','Total Input Quantity Reworked',     'number','','FALSE',5,'TRUE'],
    ['FLD-RP-137','PROC-RP-011','total_output_qty',  'Total Output Quantity',             'number','','FALSE',6,'TRUE'],
    ['FLD-RP-138','PROC-RP-011','uom',               'UOM',                               'dropdown','','FALSE',7,'TRUE'],
    ['FLD-RP-139','PROC-RP-011','type_of_reworking', 'Type of Reworking',                 'text',  '','FALSE',8,'TRUE'],
    ['FLD-RP-140','PROC-RP-011','moisture_percent',  'Moisture %',                        'number','','FALSE',9,'TRUE'],
    ['FLD-RP-141','PROC-RP-011','fineness',          'Fineness',                          'number','','FALSE',10,'TRUE'],
    ['FLD-RP-142','PROC-RP-011','remarks',           'Remarks',                           'text',  '','FALSE',11,'TRUE'],
  ];
  fldSheet.getRange(fldSheet.getLastRow()+1,1,fields.length,fields[0].length).setValues(fields);
  Logger.log('✅ Rice Powder processes & fields seeded (11 processes, ' + fields.length + ' fields)');
}

// ─── FGM Products (PROD-009) — 4 processes from Form 3 ─────────
function insertFGMProcesses(ss) {
  const now = new Date().toISOString();
  const procSheet = ss.getSheetByName('dim_processes');
  const fldSheet  = ss.getSheetByName('dim_process_fields');

  const processes = [
    ['PROC-FGM-001','PROD-009','Sort - Daily Production',  1,'Daily sorting production process','TRUE',now],
    ['PROC-FGM-002','PROD-009','Daily Production - Cooking',2,'Daily cooking production process','TRUE',now],
    ['PROC-FGM-003','PROD-009','Daily Production - Filling',3,'Daily filling production process','TRUE',now],
    ['PROC-FGM-004','PROD-009','Dispatch',                  4,'Finished goods dispatch','TRUE',now],
  ];
  procSheet.getRange(procSheet.getLastRow()+1,1,processes.length,processes[0].length).setValues(processes);

  const fields = [
    // PROC-FGM-001 Sort - Daily Production (Sorting → Verification 1)
    ['FLD-FGM-001','PROC-FGM-001','date',              'Date',                     'date',     '','FALSE',1,'TRUE'],
    ['FLD-FGM-002','PROC-FGM-001','product_name',      'Product Name',             'dropdown', '','FALSE',2,'TRUE'],
    ['FLD-FGM-003','PROC-FGM-001','total_time_hours',  'Total Time Hours',         'text',     '','FALSE',3,'TRUE'],
    ['FLD-FGM-004','PROC-FGM-001','market',            'Market',                   'dropdown', '','FALSE',4,'TRUE'],
    ['FLD-FGM-005','PROC-FGM-001','sku_kg',            'SKU (Kg)',                 'dropdown', '','FALSE',5,'TRUE'],
    ['FLD-FGM-006','PROC-FGM-001','po_qty_kg',         'PO Qty In Kg',             'number',   '','FALSE',6,'TRUE'],
    ['FLD-FGM-007','PROC-FGM-001','lot_no',            'Lot No',                   'text',     '','FALSE',7,'TRUE'],
    ['FLD-FGM-008','PROC-FGM-001','customer_name',     'Customer Name',            'dropdown', '','FALSE',8,'TRUE'],
    ['FLD-FGM-009','PROC-FGM-001','customer_batch_no', 'Customer Batch No',        'text',     '','FALSE',9,'TRUE'],
    ['FLD-FGM-010','PROC-FGM-001','jar_no',            'Jar No',                   'text',     '','FALSE',10,'TRUE'],
    ['FLD-FGM-011','PROC-FGM-001','input_qty_kg',      'Input Qty In Kg',          'number',   '','FALSE',11,'TRUE'],
    ['FLD-FGM-012','PROC-FGM-001','output_qty',        'Output QTY',               'number',   '','FALSE',12,'TRUE'],
    ['FLD-FGM-013','PROC-FGM-001','manpower_nos',      'Manpower in Nos',          'text',     '','FALSE',13,'TRUE'],
    ['FLD-FGM-014','PROC-FGM-001','rejection_qty_kg',  'Rejection Quantity in Kg', 'text',     '','FALSE',14,'TRUE'],
    ['FLD-FGM-015','PROC-FGM-001','quality_status',    'Quality Status',           'dropdown', 'Pass,Fail','FALSE',15,'TRUE'],
    ['FLD-FGM-016','PROC-FGM-001','quality_verified_by','Quality Verified By',     'text',     '','FALSE',16,'TRUE'],
    ['FLD-FGM-017','PROC-FGM-001','remarks',           'Remarks',                  'text',     '','FALSE',17,'TRUE'],
    // PROC-FGM-002 Daily Production - Cooking
    ['FLD-FGM-018','PROC-FGM-002','date',              'Date',                     'date',     '','FALSE',1,'TRUE'],
    ['FLD-FGM-019','PROC-FGM-002','temperature_deg_c', 'Temperature In Deg Celsius','text',   '','FALSE',2,'TRUE'],
    ['FLD-FGM-020','PROC-FGM-002','product_name',      'Product Name',             'dropdown', '','FALSE',3,'TRUE'],
    ['FLD-FGM-021','PROC-FGM-002','total_time_hours',  'Total Time Hours',         'text',     '','FALSE',4,'TRUE'],
    ['FLD-FGM-022','PROC-FGM-002','market',            'Market',                   'dropdown', '','FALSE',5,'TRUE'],
    ['FLD-FGM-023','PROC-FGM-002','sku_kg',            'SKU (Kg)',                 'dropdown', '','FALSE',6,'TRUE'],
    ['FLD-FGM-024','PROC-FGM-002','po_qty_kg',         'PO Qty In Kg',             'number',   '','FALSE',7,'TRUE'],
    ['FLD-FGM-025','PROC-FGM-002','lot_no',            'Lot No',                   'text',     '','FALSE',8,'TRUE'],
    ['FLD-FGM-026','PROC-FGM-002','customer_name',     'Customer Name',            'dropdown', '','FALSE',9,'TRUE'],
    ['FLD-FGM-027','PROC-FGM-002','customer_batch_no', 'Customer Batch No',        'text',     '','FALSE',10,'TRUE'],
    ['FLD-FGM-028','PROC-FGM-002','jar_no',            'Jar No',                   'text',     '','FALSE',11,'TRUE'],
    ['FLD-FGM-029','PROC-FGM-002','input_qty_kg',      'Input Qty In Kg',          'number',   '','FALSE',12,'TRUE'],
    ['FLD-FGM-030','PROC-FGM-002','output_qty',        'Output QTY',               'number',   '','FALSE',13,'TRUE'],
    ['FLD-FGM-031','PROC-FGM-002','manpower_nos',      'Manpower in Nos',          'text',     '','FALSE',14,'TRUE'],
    ['FLD-FGM-032','PROC-FGM-002','rejection_qty_kg',  'Rejection Quantity in Kg', 'text',     '','FALSE',15,'TRUE'],
    ['FLD-FGM-033','PROC-FGM-002','quality_status',    'Quality Status',           'dropdown', 'Pass,Fail','FALSE',16,'TRUE'],
    ['FLD-FGM-034','PROC-FGM-002','quality_verified_by','Quality Verified By',     'text',     '','FALSE',17,'TRUE'],
    ['FLD-FGM-035','PROC-FGM-002','remarks',           'Remarks',                  'text',     '','FALSE',18,'TRUE'],
    // PROC-FGM-003 Daily Production - Filling
    ['FLD-FGM-036','PROC-FGM-003','date',              'Date',                     'date',     '','FALSE',1,'TRUE'],
    ['FLD-FGM-037','PROC-FGM-003','no_of_bottles',     'No: of Bottles',           'number',   '','FALSE',2,'TRUE'],
    ['FLD-FGM-038','PROC-FGM-003','no_of_cartons',     'No: of Cartons',           'number',   '','FALSE',3,'TRUE'],
    ['FLD-FGM-039','PROC-FGM-003','table_no',          'Table No:',                'number',   '','FALSE',4,'TRUE'],
    ['FLD-FGM-040','PROC-FGM-003','customer_batch_no', 'Customer Batch No',        'text',     '','FALSE',5,'TRUE'],
    ['FLD-FGM-041','PROC-FGM-003','no_of_workers',     'No: of Workers',           'number',   '','FALSE',6,'TRUE'],
    ['FLD-FGM-042','PROC-FGM-003','operator',          'Operator',                 'text',     '','FALSE',7,'TRUE'],
    // PROC-FGM-004 Dispatch
    ['FLD-FGM-043','PROC-FGM-004','date',              'Date',                     'date',     '','FALSE',1,'TRUE'],
    ['FLD-FGM-044','PROC-FGM-004','product_name',      'Name of the Product',      'dropdown', '','FALSE',2,'TRUE'],
    ['FLD-FGM-045','PROC-FGM-004','customer_name',     'Customer Name',            'dropdown', '','FALSE',3,'TRUE'],
    ['FLD-FGM-046','PROC-FGM-004','customer_batch_no', 'Customer Batch No',        'text',     '','FALSE',4,'TRUE'],
    ['FLD-FGM-047','PROC-FGM-004','sku_kg',            'SKU (KG)',                 'dropdown', '','FALSE',5,'TRUE'],
    ['FLD-FGM-048','PROC-FGM-004','total_qty_dispatched','Total Quantity Dispatched','number','','FALSE',6,'TRUE'],
    ['FLD-FGM-049','PROC-FGM-004','no_cartons_dispatched','No: of Cartons Dispatched','text', '','FALSE',7,'TRUE'],
    ['FLD-FGM-050','PROC-FGM-004','quality_status',    'Quality Status',           'dropdown', 'Pass,Fail','FALSE',8,'TRUE'],
    ['FLD-FGM-051','PROC-FGM-004','verified_by',       'Verified By',              'text',     '','FALSE',9,'TRUE'],
    ['FLD-FGM-052','PROC-FGM-004','fg_loaded_by',      'FG Loaded By',             'text',     '','FALSE',10,'TRUE'],
    ['FLD-FGM-053','PROC-FGM-004','remarks',           'Remarks',                  'text',     '','FALSE',11,'TRUE'],
  ];
  fldSheet.getRange(fldSheet.getLastRow()+1,1,fields.length,fields[0].length).setValues(fields);
  Logger.log('✅ FGM processes & fields seeded (4 processes, ' + fields.length + ' fields)');
}
