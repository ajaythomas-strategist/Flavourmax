# Antigravity AI Prompt — Manufacturing Unit Web Application

---

## 🏭 Project Overview

Build a full-featured, responsive **Manufacturing Management Web Application** for a food manufacturing unit that produces products such as **Pickles, Rice Powder, Jams**, and similar goods. The app must cover **Inventory, Production, Dispatch, Sales, and Sales Returns**, with complete **Google Sheets as the backend database** (no external database — all reads and writes go to Google Sheets).

The app must be **fully dynamic** — admins can add new products, ingredients, processes, process fields, and companies at any time without code changes.

---

## 🗄️ Backend: Google Sheets Structure

All data is stored in a single Google Spreadsheet. Each sheet tab represents one table. Use the Google Sheets API for all reads and writes.

### Dimension Tables (Master / Config Data)

| Sheet Name | Purpose |
|---|---|
| `dim_companies` | All client companies (20+ companies) |
| `dim_products` | All products (Pickle, Jam, Rice Powder, etc.) |
| `dim_categories` | Product categories |
| `dim_ingredients` | All raw material ingredients |
| `dim_units` | Units of measurement (kg, litre, gram, piece, etc.) |
| `dim_processes` | Production process types (Brine, Curing, Mixing, Boiling, etc.) |
| `dim_process_fields` | Dynamic fields for each process (each process can have different fields) |
| `dim_recipes` | Company-specific ingredient lists per product |
| `dim_users` | App users and roles |
| `dim_warehouses` | Storage locations |

#### `dim_companies` columns:
`company_id | company_name | contact_person | phone | email | address | gstin | is_active | created_at | updated_at`

#### `dim_products` columns:
`product_id | product_name | category_id | default_unit_id | description | is_active | created_at | updated_at`

#### `dim_ingredients` columns:
`ingredient_id | ingredient_name | unit_id | category | min_stock_alert | is_active | created_at | updated_at`

#### `dim_processes` columns:
`process_id | process_name | sequence_order | description | is_active | created_at`

#### `dim_process_fields` columns:
`field_id | process_id | field_name | field_label | field_type (text/number/date/dropdown/checkbox) | field_options (comma-separated for dropdown) | is_required | sequence_order | is_active`

#### `dim_recipes` columns:
`recipe_id | company_id | product_id | ingredient_id | quantity | unit_id | notes | is_active | created_at | updated_at`

#### `dim_users` columns:
`user_id | full_name | email | role | is_active | created_at`

---

### Fact Tables (Transactional Data)

| Sheet Name | Purpose |
|---|---|
| `fact_inventory_in` | Raw material stock received |
| `fact_inventory_out` | Raw material consumed in production |
| `fact_inventory_balance` | Running balance per ingredient |
| `fact_production_batches` | Each production batch header |
| `fact_production_process_log` | Process-wise log entries for each batch |
| `fact_dispatch` | Dispatch records |
| `fact_sales` | Sales invoices |
| `fact_sales_return` | Sales return records |
| `fact_corrections` | Audit log of all corrections made to any record |

#### `fact_production_batches` columns:
`batch_id | batch_date | product_id | company_id | planned_qty | actual_qty | unit_id | status (Draft/In Progress/Completed/Cancelled) | notes | created_by | created_at | updated_at`

#### `fact_production_process_log` columns:
`log_id | batch_id | process_id | field_id | field_value | logged_by | logged_at | is_corrected | correction_ref_id`

#### `fact_sales` columns:
`sale_id | invoice_no | sale_date | company_id | product_id | batch_id | quantity | unit_id | rate | amount | gst_percent | gst_amount | total_amount | status | created_by | created_at`

#### `fact_sales_return` columns:
`return_id | return_date | sale_id | company_id | product_id | quantity | reason | status | created_by | created_at`

#### `fact_corrections` columns:
`correction_id | corrected_at | corrected_by | source_sheet | source_row_id | field_name | old_value | new_value | reason | approved_by`

---

## 👥 User Roles & Permissions

| Role | Permissions |
|---|---|
| **Admin** | Full access — all modules, master data management, user management, corrections approval, reports |
| **Supervisor** | View all modules, approve corrections, cannot manage users or master data |
| **Production Staff** | Log production batches and processes only; view own entries |
| **Sales / Dispatch** | Manage dispatch, sales, and sales returns; view production (read-only) |
| **Viewer / Analyst** | Read-only access to all data and dashboards |

Implement role-based access control. Show/hide nav items and action buttons based on role. Store user roles in `dim_users` sheet.

---

## 📱 UI / UX Requirements

- **Responsive design** — works on desktop and mobile browsers
- **Sidebar navigation** (collapsible on mobile)
- **Clean, modern UI** — use a light color theme suitable for a manufacturing environment
- **Data tables** with search, sort, filter, and pagination on all list views
- **Loading states** on all Google Sheets API calls
- **Toast notifications** for success/error on every action
- **Confirmation dialogs** before any delete or status change
- **Form validation** — required fields, numeric ranges, date logic
- **Inline edit** capability on correction workflows

---

## 📦 Module 1: Master Data Management (Admin Only)

### 1.1 Company Management
- List all companies with search and filter by active/inactive
- Add / Edit company (all fields in `dim_companies`)
- Soft delete (set `is_active = FALSE`)
- View company-specific recipe/ingredient configuration

### 1.2 Product Management
- List all products with category filter
- Add / Edit product
- Dynamic — admin can add any new product type at any time

### 1.3 Ingredient Management
- List all ingredients with unit and stock alert
- Add / Edit ingredient
- Set minimum stock alert levels

### 1.4 Process & Field Management ⭐ (Dynamic)
This is the most critical dynamic feature:
- List all production processes (e.g., Brine Preparation, Curing, Grinding, Boiling, Filling, Quality Check)
- Add / Edit process with a sequence order
- For each process, manage its **custom fields dynamically**:
  - Add field: name, label, type (Text / Number / Date / Dropdown / Checkbox), options (if dropdown), required or optional, sequence
  - Edit / deactivate fields at any time
  - Preview how the process form will look to production staff
- Fields are rendered dynamically at production logging time — no hardcoding

### 1.5 Recipe Management (Company-Specific Ingredients)
- Select a Company + Product combination
- Add ingredients with quantities and units for that specific company-product recipe
- Edit quantities, swap ingredients
- Copy recipe from one company to another
- View recipe comparison across companies for the same product

### 1.6 Unit Management
- Manage units of measurement (add / edit)

---

## 🏗️ Module 2: Inventory Management

### 2.1 Inventory In (Stock Receipt)
- Form: Date, Ingredient, Supplier, Quantity, Unit, Rate, Total Cost, Warehouse, Invoice No, Notes
- List view with filters by date range, ingredient, warehouse
- Running balance auto-calculated

### 2.2 Inventory Out (Consumption)
- Linked to a production batch — when a batch is started, ingredients are auto-deducted based on recipe
- Manual adjustment option (with reason)
- Alert when ingredient stock falls below minimum threshold

### 2.3 Current Stock Dashboard
- Table: Ingredient | Unit | Opening Stock | Total In | Total Out | Current Balance | Min Alert
- Highlight rows where balance < min alert in red
- Export to CSV

---

## ⚙️ Module 3: Production Management

### 3.1 Batch Creation
- Form: Date, Product, Company, Planned Quantity, Unit, Notes
- System assigns unique `batch_id`
- Status: **Draft → In Progress → Completed / Cancelled**
- After batch creation, show the list of processes for that product in sequence

### 3.2 Production Process Logging ⭐ (Dynamic Forms)
- For each batch, display processes in their configured sequence order
- Each process renders its dynamically configured fields as a form
- Examples:
  - **Brine Preparation**: Salt %, Water Volume (litres), Temperature (°C), Duration (hours)
  - **Curing**: Start Date, End Date, Curing Agent, Batch Weight (kg)
  - **Grinding**: Machine ID, Mesh Size, RPM, Output Weight
  - **Quality Check**: Pass/Fail (dropdown), Moisture %, pH Level, Inspector Name
- Staff can fill and save each process step independently
- Mark each process as complete; all processes complete = batch can be marked Completed
- View batch summary with all process logs

### 3.3 Batch List & History
- Filter by date range, product, company, status
- Click batch to drill down into full process log
- Export batch report as CSV

---

## 🚚 Module 4: Dispatch Management

### 4.1 Create Dispatch
- Form: Date, Company, Product, Batch (dropdown of completed batches), Quantity, Unit, Vehicle No, Driver Name, Notes
- Validate quantity does not exceed available batch stock

### 4.2 Dispatch List
- Filter by company, date, product, status
- Mark dispatch as Delivered / Returned
- View dispatch details

---

## 💰 Module 5: Sales Management

### 5.1 Create Sale
- Form: Invoice No (auto-generated), Date, Company, Product, Dispatch Reference, Quantity, Rate per Unit, GST %, auto-calculate Amount + GST + Total
- Save to `fact_sales`

### 5.2 Sales List
- Filter by date, company, product
- Summary: Total Sales, Total GST, Net Amount
- Click row to view invoice details

### 5.3 Sales Return
- Select original Sale, enter return quantity and reason
- Update inventory balance accordingly
- List view of all returns with status (Pending / Processed)

---

## ✏️ Module 6: Data Correction Workflow ⭐

This is mandatory — users sometimes enter data incorrectly and need to correct it without deleting records.

### Correction Rules:
- **No hard deletes** on any fact table record
- Any user can **raise a correction request** on their own entries
- Admin / Supervisor must **approve or reject** corrections
- Every correction is logged in `fact_corrections` with old value, new value, who changed it, when, and why

### Correction Flow:
1. User finds wrong entry in any module (inventory, production, sales, dispatch)
2. Clicks "Request Correction" on that row
3. Fills: which field to change, new value, reason
4. Supervisor/Admin sees pending corrections in a **Correction Inbox**
5. Admin can approve (apply new value to the source row) or reject (with rejection note)
6. Both original row and correction log are preserved

### Correction Inbox (Admin/Supervisor):
- Table of pending correction requests
- One-click Approve / Reject with comment
- History of all past corrections

---

## 📊 Module 7: Dashboard & Reports (All Roles — filtered by permissions)

### Dashboard KPIs (at a glance):
- Total batches this month (by status)
- Current inventory value and low-stock alerts
- Sales this month (amount)
- Pending dispatches
- Pending correction requests

### Reports:
- **Production Report**: Batches by date range, product, company — with process log summary
- **Inventory Report**: Stock movement by ingredient and date range
- **Sales Report**: Revenue by company, product, date range
- **Dispatch Report**: Dispatch status tracking
- **Ingredient Usage Report**: How much of each ingredient was consumed per product

All reports must have:
- Date range filter
- Company / Product filter
- Export to CSV button

---

## 🔧 Technical Requirements

### Google Sheets Integration:
- Use Google Sheets API v4 with OAuth 2.0 or Service Account authentication
- All CRUD operations go through the API — no local storage of transactional data
- Implement optimistic UI updates with rollback on API failure
- Use batch reads (batchGet) to minimise API quota usage
- Cache dimension/master data in session for performance (refresh on demand)

### Auto-Generated IDs:
- All IDs (batch_id, sale_id, dispatch_id, etc.) auto-generated as sequential + date-prefixed codes (e.g., `BATCH-20260610-001`)
- ID generation reads the last row of the respective sheet to determine next sequence

### Data Integrity:
- Foreign key validation in app layer (check that company_id exists in dim_companies before saving)
- Duplicate check on critical fields (invoice number, batch ID)
- All timestamps stored as UTC ISO 8601

### Security:
- Login via email + password (store hashed passwords in `dim_users` or use Google OAuth)
- Session management — auto logout after inactivity
- Role checked on every protected action server-side (or via secure middleware)
- Correction approvals only accessible to Admin / Supervisor role

---

## 🖥️ App Pages / Navigation Structure

```
├── Dashboard
├── Master Data (Admin)
│   ├── Companies
│   ├── Products
│   ├── Ingredients
│   ├── Processes & Fields   ← Dynamic form builder
│   ├── Recipes              ← Company-product ingredient config
│   └── Units
├── Inventory
│   ├── Stock In
│   ├── Stock Out / Adjustments
│   └── Current Stock
├── Production
│   ├── New Batch
│   ├── Batch List
│   └── Process Log (per batch)
├── Dispatch
│   ├── New Dispatch
│   └── Dispatch List
├── Sales
│   ├── New Sale
│   ├── Sales List
│   └── Sales Returns
├── Corrections Inbox (Admin / Supervisor)
├── Reports
│   ├── Production Report
│   ├── Inventory Report
│   ├── Sales Report
│   └── Ingredient Usage
└── Settings
    ├── User Management (Admin)
    └── Google Sheets Config
```

---

## ⚠️ Key Constraints & Notes

1. **No external database** — Google Sheets is the sole data store.
2. **Everything is dynamic** — products, ingredients, processes, and their fields are all configurable from within the app by Admin.
3. **Company-specific recipes** — the same product (e.g., Mango Pickle) may have different ingredient compositions for different companies.
4. **Correction, not deletion** — wrong entries are corrected via an approval workflow, never hard-deleted.
5. **20+ companies** — the UI must handle large lists with search and filter, not simple dropdowns.
6. **Production processes are sequential** — each process has a defined order and must be logged step by step.
7. **Mobile-friendly** — production staff may use tablets or phones on the factory floor.

---

*Prompt prepared for Antigravity AI App Builder | Flavourmax Manufacturing Unit*
