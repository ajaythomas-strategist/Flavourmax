-- ============================================================
-- Flavourmax Manufacturing App — Supabase PostgreSQL Schema
-- Run once in Supabase Dashboard → SQL Editor
-- IMPORTANT: Disable RLS on all tables (internal app, no row-level auth needed)
--   Dashboard → Table Editor → each table → RLS → Disable
-- ============================================================

-- ─── Dimension (Master) Tables ──────────────────────────────

CREATE TABLE IF NOT EXISTS dim_companies (
  company_id     TEXT PRIMARY KEY,
  company_name   TEXT,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  gstin          TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dim_products (
  product_id      TEXT PRIMARY KEY,
  product_name    TEXT,
  category_id     TEXT,
  default_unit_id TEXT,
  description     TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dim_categories (
  category_id   TEXT PRIMARY KEY,
  category_name TEXT,
  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_ingredients (
  ingredient_id   TEXT PRIMARY KEY,
  ingredient_name TEXT,
  unit_id         TEXT,
  category        TEXT,
  min_stock_alert NUMERIC DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dim_units (
  unit_id      TEXT PRIMARY KEY,
  unit_name    TEXT,
  abbreviation TEXT,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_processes (
  process_id     TEXT PRIMARY KEY,
  product_id     TEXT,
  process_name   TEXT,
  sequence_order INTEGER,
  description    TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_process_fields (
  field_id       TEXT PRIMARY KEY,
  process_id     TEXT,
  field_name     TEXT,
  field_label    TEXT,
  field_type     TEXT,
  field_options  TEXT,
  is_required    BOOLEAN DEFAULT false,
  sequence_order INTEGER,
  is_active      BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS dim_recipes (
  recipe_id     TEXT PRIMARY KEY,
  company_id    TEXT,
  product_id    TEXT,
  ingredient_id TEXT,
  quantity      NUMERIC,
  unit_id       TEXT,
  notes         TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dim_users (
  user_id       TEXT PRIMARY KEY,
  full_name     TEXT,
  email         TEXT,
  role          TEXT,
  password_hash TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_warehouses (
  warehouse_id   TEXT PRIMARY KEY,
  warehouse_name TEXT,
  location       TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_suppliers (
  supplier_id    TEXT PRIMARY KEY,
  supplier_name  TEXT,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ
);

-- ─── Fact (Transactional) Tables ────────────────────────────

CREATE TABLE IF NOT EXISTS fact_inventory_in (
  in_id         TEXT PRIMARY KEY,
  in_date       DATE,
  ingredient_id TEXT,
  supplier      TEXT,
  quantity      NUMERIC,
  unit_id       TEXT,
  rate          NUMERIC,
  total_cost    NUMERIC,
  warehouse_id  TEXT,
  invoice_no    TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_inventory_out (
  out_id        TEXT PRIMARY KEY,
  out_date      DATE,
  ingredient_id TEXT,
  batch_id      TEXT,
  quantity      NUMERIC,
  unit_id       TEXT,
  reason        TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_inventory_balance (
  balance_id      TEXT PRIMARY KEY,
  ingredient_id   TEXT UNIQUE,
  total_in        NUMERIC DEFAULT 0,
  total_out       NUMERIC DEFAULT 0,
  current_balance NUMERIC DEFAULT 0,
  last_updated    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_production_batches (
  batch_id    TEXT PRIMARY KEY,
  batch_date  DATE,
  product_id  TEXT,
  company_id  TEXT,
  planned_qty NUMERIC,
  actual_qty  NUMERIC,
  unit_id     TEXT,
  status      TEXT DEFAULT 'Draft',
  notes       TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fact_production_process_log (
  log_id            TEXT PRIMARY KEY,
  batch_id          TEXT,
  process_id        TEXT,
  process_name      TEXT,
  step_status       TEXT,
  field_data_json   TEXT,
  input_qty         NUMERIC,
  input_unit        TEXT,
  output_qty        NUMERIC,
  output_unit       TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  completed_by      TEXT,
  is_corrected      BOOLEAN DEFAULT false,
  correction_ref_id TEXT
);

CREATE TABLE IF NOT EXISTS fact_dispatch (
  dispatch_id   TEXT PRIMARY KEY,
  dispatch_date DATE,
  company_id    TEXT,
  product_id    TEXT,
  batch_id      TEXT,
  quantity      NUMERIC,
  unit_id       TEXT,
  vehicle_no    TEXT,
  driver_name   TEXT,
  notes         TEXT,
  status        TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_sales_orders (
  order_id           TEXT PRIMARY KEY,
  order_no           TEXT,
  order_date         DATE,
  company_id         TEXT,
  product_id         TEXT,
  quantity           NUMERIC,
  unit_id            TEXT,
  price              NUMERIC,
  total_amount       NUMERIC,
  expected_delivery  DATE,
  notes              TEXT,
  status             TEXT DEFAULT 'Pending',
  batch_id           TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_sales (
  sale_id      TEXT PRIMARY KEY,
  invoice_no   TEXT,
  sale_date    DATE,
  company_id   TEXT,
  product_id   TEXT,
  batch_id     TEXT,
  quantity     NUMERIC,
  unit_id      TEXT,
  rate         NUMERIC,
  amount       NUMERIC,
  gst_percent  NUMERIC,
  gst_amount   NUMERIC,
  total_amount NUMERIC,
  status       TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_sales_return (
  return_id   TEXT PRIMARY KEY,
  return_date DATE,
  sale_id     TEXT,
  company_id  TEXT,
  product_id  TEXT,
  quantity    NUMERIC,
  reason      TEXT,
  status      TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_corrections (
  correction_id TEXT PRIMARY KEY,
  requested_at  TIMESTAMPTZ,
  requested_by  TEXT,
  source_sheet  TEXT,
  source_row_id TEXT,
  field_name    TEXT,
  field_label   TEXT,
  old_value     TEXT,
  new_value     TEXT,
  reason        TEXT,
  status        TEXT DEFAULT 'Pending',
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT
);

-- ─── Indexes for common queries ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inv_in_date        ON fact_inventory_in(in_date);
CREATE INDEX IF NOT EXISTS idx_inv_out_date        ON fact_inventory_out(out_date);
CREATE INDEX IF NOT EXISTS idx_inv_out_batch       ON fact_inventory_out(batch_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_ingredient  ON fact_inventory_balance(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_batches_date        ON fact_production_batches(batch_date);
CREATE INDEX IF NOT EXISTS idx_batches_status      ON fact_production_batches(status);
CREATE INDEX IF NOT EXISTS idx_process_log_batch   ON fact_production_process_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_date       ON fact_dispatch(dispatch_date);
CREATE INDEX IF NOT EXISTS idx_sales_date          ON fact_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_date   ON fact_sales_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_corrections_status  ON fact_corrections(status);
CREATE INDEX IF NOT EXISTS idx_recipes_product     ON dim_recipes(product_id, company_id);
CREATE INDEX IF NOT EXISTS idx_processes_product   ON dim_processes(product_id);
CREATE INDEX IF NOT EXISTS idx_proc_fields_process ON dim_process_fields(process_id);

-- ─── Disable RLS (internal app — no row-level auth needed) ──
ALTER TABLE dim_companies            DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_products             DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_categories           DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_ingredients          DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_units                DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_processes            DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_process_fields       DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_recipes              DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_users                DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_warehouses           DISABLE ROW LEVEL SECURITY;
ALTER TABLE dim_suppliers            DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_inventory_in        DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_inventory_out       DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_inventory_balance   DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_production_batches  DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_production_process_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_dispatch            DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_sales               DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_sales_orders        DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_sales_return        DISABLE ROW LEVEL SECURITY;
ALTER TABLE fact_corrections         DISABLE ROW LEVEL SECURITY;

-- ─── Grant anon + authenticated full access ──────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- ─── Schema Corrections / Updates (July 2026) ───────────────
ALTER TABLE fact_inventory_in ADD COLUMN IF NOT EXISTS lot_no TEXT;
ALTER TABLE fact_inventory_out ADD COLUMN IF NOT EXISTS lot_no TEXT;
ALTER TABLE fact_inventory_out ADD COLUMN IF NOT EXISTS warehouse_id TEXT;
ALTER TABLE fact_production_process_log ADD COLUMN IF NOT EXISTS quality_passed TEXT;
