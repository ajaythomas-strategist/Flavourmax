// ============================================================
// config.js — Flavourmax Manufacturing App Configuration
// All Google Sheets references and app constants live here
// ============================================================

export const CONFIG = {
  // ── Supabase (active backend) ──────────────────────────────
  SUPABASE_URL:      'https://pyuozhqagmvjztfybwje.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5dW96aHFhZ212anp0Znlid2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTAxNzIsImV4cCI6MjA5Njc2NjE3Mn0.C1NvhEloeRuO5ZpIGFrrkBUohZomWMaYhtiiPu4KPLQ',

  // ── Google Sheets (legacy — no longer used) ────────────────
  WEBAPP_URL:     '',  // Disabled after Supabase migration
  SPREADSHEET_ID: '1LYLL-UecZ33zURiD2YHfXXhxN28dOYJE27DkzzL4vqM',
  API_KEY: '',
  CLIENT_ID: '',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  SHEETS_API_BASE: 'https://sheets.googleapis.com/v4/spreadsheets',
  SESSION_TIMEOUT_MS: 2 * 60 * 60 * 1000, // 2 hours
  ROWS_PER_PAGE: 25,
  CURRENCY_SYMBOL: '₹',
  DATE_LOCALE: 'en-IN',
};

// ─── Sheet Names ────────────────────────────────────────────
export const SHEETS = {
  // Dimension (Master) Tables
  COMPANIES:       'dim_companies',
  PRODUCTS:        'dim_products',
  CATEGORIES:      'dim_categories',
  INGREDIENTS:     'dim_ingredients',
  UNITS:           'dim_units',
  PROCESSES:       'dim_processes',
  PROCESS_FIELDS:  'dim_process_fields',
  RECIPES:         'dim_recipes',
  USERS:           'dim_users',
  WAREHOUSES:      'dim_warehouses',
  SUPPLIERS:       'dim_suppliers',

  // Fact (Transactional) Tables
  INVENTORY_IN:       'fact_inventory_in',
  INVENTORY_OUT:      'fact_inventory_out',
  INVENTORY_BALANCE:  'fact_inventory_balance',
  PRODUCTION_BATCHES: 'fact_production_batches',
  PROCESS_LOG:        'fact_production_process_log',
  DISPATCH:           'fact_dispatch',
  SALES:              'fact_sales',
  SALES_RETURN:       'fact_sales_return',
  CORRECTIONS:        'fact_corrections',
};

// ─── Sheet Column Definitions ────────────────────────────────
// Used for initialization and parsing row arrays into objects
export const COLUMNS = {
  [SHEETS.COMPANIES]: [
    'company_id','company_name','contact_person','phone','email',
    'address','gstin','is_active','created_at','updated_at'
  ],
  [SHEETS.PRODUCTS]: [
    'product_id','product_name','category_id','default_unit_id',
    'description','is_active','created_at','updated_at'
  ],
  [SHEETS.CATEGORIES]: [
    'category_id','category_name','description','is_active','created_at'
  ],
  [SHEETS.INGREDIENTS]: [
    'ingredient_id','ingredient_name','unit_id','category',
    'min_stock_alert','is_active','created_at','updated_at'
  ],
  [SHEETS.UNITS]: [
    'unit_id','unit_name','abbreviation','is_active','created_at'
  ],
  [SHEETS.PROCESSES]: [
    'process_id','product_id','process_name','sequence_order','description','is_active','created_at'
  ],
  [SHEETS.PROCESS_FIELDS]: [
    'field_id','process_id','field_name','field_label','field_type',
    'field_options','is_required','sequence_order','is_active'
  ],
  [SHEETS.RECIPES]: [
    'recipe_id','company_id','product_id','ingredient_id','quantity',
    'unit_id','notes','is_active','created_at','updated_at'
  ],
  [SHEETS.USERS]: [
    'user_id','full_name','email','role','password_hash','is_active','created_at'
  ],
  [SHEETS.WAREHOUSES]: [
    'warehouse_id','warehouse_name','location','is_active','created_at'
  ],
  [SHEETS.SUPPLIERS]: [
    'supplier_id','supplier_name','contact_person','phone','email','address','is_active','created_at','updated_at'
  ],
  [SHEETS.INVENTORY_IN]: [
    'in_id','in_date','ingredient_id','supplier','quantity','unit_id',
    'rate','total_cost','warehouse_id','invoice_no','notes','created_by','created_at'
  ],
  [SHEETS.INVENTORY_OUT]: [
    'out_id','out_date','ingredient_id','batch_id','quantity','unit_id',
    'reason','created_by','created_at'
  ],
  [SHEETS.INVENTORY_BALANCE]: [
    'balance_id','ingredient_id','total_in','total_out','current_balance','last_updated'
  ],
  [SHEETS.PRODUCTION_BATCHES]: [
    'batch_id','batch_date','product_id','company_id','planned_qty','actual_qty',
    'unit_id','status','notes','created_by','created_at','updated_at'
  ],
  [SHEETS.PROCESS_LOG]: [
    'log_id','batch_id','process_id','process_name','step_status',
    'field_data_json','input_qty','input_unit','output_qty','output_unit',
    'started_at','completed_at','completed_by','is_corrected','correction_ref_id'
  ],
  [SHEETS.DISPATCH]: [
    'dispatch_id','dispatch_date','company_id','product_id','batch_id',
    'quantity','unit_id','vehicle_no','driver_name','notes',
    'status','created_by','created_at'
  ],
  [SHEETS.SALES]: [
    'sale_id','invoice_no','sale_date','company_id','product_id','batch_id',
    'quantity','unit_id','rate','amount','gst_percent','gst_amount',
    'total_amount','status','created_by','created_at'
  ],
  [SHEETS.SALES_RETURN]: [
    'return_id','return_date','sale_id','company_id','product_id',
    'quantity','reason','status','created_by','created_at'
  ],
  [SHEETS.CORRECTIONS]: [
    'correction_id','requested_at','requested_by','source_sheet','source_row_id',
    'field_name','field_label','old_value','new_value','reason','status','reviewed_by',
    'reviewed_at','review_note'
  ],
};

// ─── ID Prefixes ─────────────────────────────────────────────
export const ID_PREFIXES = {
  [SHEETS.COMPANIES]:          'COMP',
  [SHEETS.PRODUCTS]:           'PROD',
  [SHEETS.CATEGORIES]:         'CAT',
  [SHEETS.INGREDIENTS]:        'ING',
  [SHEETS.UNITS]:              'UNIT',
  [SHEETS.PROCESSES]:          'PROC',
  [SHEETS.PROCESS_FIELDS]:     'FLD',
  [SHEETS.RECIPES]:            'REC',
  [SHEETS.USERS]:              'USR',
  [SHEETS.WAREHOUSES]:         'WH',
  [SHEETS.SUPPLIERS]:          'SUP',
  [SHEETS.INVENTORY_IN]:       'IN',
  [SHEETS.INVENTORY_OUT]:      'OUT',
  [SHEETS.INVENTORY_BALANCE]:  'BAL',
  [SHEETS.PRODUCTION_BATCHES]: 'BATCH',
  [SHEETS.PROCESS_LOG]:        'LOG',
  [SHEETS.DISPATCH]:           'DISP',
  [SHEETS.SALES]:              'SALE',
  [SHEETS.SALES_RETURN]:       'RET',
  [SHEETS.CORRECTIONS]:        'CORR',
};

// ─── Role Definitions ────────────────────────────────────────
export const ROLES = {
  ADMIN:       'Admin',
  SUPERVISOR:  'Supervisor',
  QC_STAFF:    'QC Staff',
  PRODUCTION:  'Production Staff',
  SALES:       'Sales / Dispatch',
  VIEWER:      'Viewer / Analyst',
};

// ─── Role Permissions ────────────────────────────────────────
// true = allowed, false = denied, 'own' = only own records
export const PERMISSIONS = {
  dashboard:            { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': true,  'Sales / Dispatch': true,  'Viewer / Analyst': true  },
  master_view:          { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': true  },
  master_edit:          { Admin: true, Supervisor: false,'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': false },
  // ── Who can define/edit process data-collection fields ─────
  process_fields_edit:  { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': false },
  inventory_view:       { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': true,  'Sales / Dispatch': true,  'Viewer / Analyst': true  },
  inventory_edit:       { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': false },
  production_view:      { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': true,  'Sales / Dispatch': true,  'Viewer / Analyst': true  },
  production_edit:      { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': true,  'Sales / Dispatch': false, 'Viewer / Analyst': false },
  dispatch_view:        { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': true,  'Viewer / Analyst': true  },
  dispatch_edit:        { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': true,  'Viewer / Analyst': false },
  sales_view:           { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': true,  'Viewer / Analyst': true  },
  sales_edit:           { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': true,  'Viewer / Analyst': false },
  corrections_raise:    { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': true,  'Sales / Dispatch': true,  'Viewer / Analyst': false },
  corrections_approve:  { Admin: true, Supervisor: true, 'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': false },
  reports_view:         { Admin: true, Supervisor: true, 'QC Staff': true,  'Production Staff': false, 'Sales / Dispatch': true,  'Viewer / Analyst': true  },
  users_manage:         { Admin: true, Supervisor: false,'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': false },
  settings_edit:        { Admin: true, Supervisor: false,'QC Staff': false, 'Production Staff': false, 'Sales / Dispatch': false, 'Viewer / Analyst': false },
};

// ─── GST Rates (India) ───────────────────────────────────────
export const GST_RATES = [0, 5, 12, 18, 28];

// ─── Production Batch Statuses ───────────────────────────────
export const BATCH_STATUS = {
  DRAFT:       'Draft',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  CANCELLED:   'Cancelled',
};

// ─── Process Field Types ──────────────────────────────────────
export const FIELD_TYPES = {
  TEXT:     'text',
  NUMBER:   'number',
  DATE:     'date',
  DROPDOWN: 'dropdown',
  CHECKBOX: 'checkbox',
  TEXTAREA: 'textarea',
};
