# Antigravity AI Prompt — v2: Sequential Batch Production & Corrections
*Flavourmax Manufacturing Management System*

---

## 🎯 Context & Scope

This prompt covers two critical subsystems of the Flavourmax app that must be built with precision:

1. **Batch-wise Sequential Production** — A production batch moves through a defined sequence of processes. Each process unlocks only after the previous one is fully completed.
2. **Data Correction Workflow** — Any logged entry (process log, inventory, sales, dispatch) can be corrected through an approval-based workflow. No hard deletes — corrections are tracked with full audit trail.

The backend is **Google Sheets only** (no external database). All reads and writes go through the Google Sheets API.

---

## ⚠️ Critical Rule for All Master Data

All master data records (Products, Ingredients, Processes, Process Fields, Companies, Units, Users) must default to `is_active = TRUE` when created. Dropdowns in all transaction forms must only show records where `is_active = TRUE`. This is the rule everywhere — no exceptions.

---

## PART 1 — BATCH-WISE SEQUENTIAL PRODUCTION

### Overview

Production is done in **batches**. Each batch is for one specific product for one specific company. A batch goes through multiple production processes **in strict sequence** — a process only becomes available to fill once the previous process is marked complete by staff.

Think of it like a pipeline:

```
Batch Created
     │
     ▼
[Process 1: Raw Material Cleaning] ← ACTIVE (available to fill)
     │ ← marked complete by staff
     ▼
[Process 2: Weighing & Measuring] ← UNLOCKED (now available)
     │ ← marked complete
     ▼
[Process 3: Cooking / Processing] ← UNLOCKED
     │ ← marked complete
     ▼
[Process 4: Quality Check] ← UNLOCKED
     │ ← marked complete
     ▼
[Process 5: Packaging] ← UNLOCKED
     │ ← marked complete
     ▼
[Process 6: Labelling] ← UNLOCKED
     │ ← marked complete
     ▼
Batch → Status: COMPLETED
```

### Batch Statuses

A batch moves through these statuses in order:

| Status | Meaning |
|---|---|
| `Draft` | Created but not yet started |
| `In Progress` | At least one process has been started or completed |
| `Completed` | All processes marked complete |
| `Cancelled` | Batch cancelled at any stage (with reason) |

### Process Step Statuses (per batch)

Each process step within a batch has its own status:

| Status | Meaning | UI Display |
|---|---|---|
| `Locked` | Previous process not yet complete — cannot be filled | Grey, disabled, lock icon |
| `Active` | Previous process complete — ready to be filled | Blue/teal, highlighted, "Start" button |
| `In Progress` | Staff has started filling but not submitted | Yellow/amber, "Continue" button |
| `Completed` | Submitted and saved | Green, tick icon, "View" button |

**Rule:** Process 1 is always `Active` as soon as the batch is started. All others start as `Locked`.

---

### Google Sheets Tables for Production

#### `fact_production_batches` sheet columns:
```
batch_id | batch_date | product_id | company_id | planned_qty | actual_qty | unit_id | status | notes | created_by | created_at | updated_at
```

Auto-generate `batch_id` as: `BATCH-YYYYMMDD-NNN` (e.g. `BATCH-20260610-001`)

#### `fact_production_process_log` sheet columns:
```
log_id | batch_id | process_id | process_name | step_status | field_data_json | started_at | completed_at | completed_by | is_corrected | correction_ref_id
```

- `field_data_json`: Stores all dynamic field values as a JSON string. Example: `{"cooking_temp":"180","duration_mins":"45","method":"Boiling"}`
- `step_status`: One of `Locked`, `Active`, `In Progress`, `Completed`
- When a batch is created, insert one row per process into this table, with `step_status = Locked` for all except Process 1 which gets `Active`

---

### UI: Batch Creation Flow

**Step 1 — Create Batch form:**
Fields: Batch Date (required), Product (required, dropdown of active products), Company (required, dropdown of active companies), Planned Quantity (required), Unit (required), Notes (optional).

Button: **"Create Batch & Start"**

On submit:
- Generate `batch_id`
- Write batch header to `fact_production_batches` with status `In Progress`
- Write one row per process to `fact_production_process_log` — Process 1 as `Active`, all others as `Locked`
- Redirect user to the **Batch Process View** for this batch

---

### UI: Batch Process View (Core Screen)

This is the main working screen for a batch. It shows the full pipeline for a batch.

**Layout:**
- Header: Batch ID | Product | Company | Date | Status badge | Planned Qty
- Below: A vertical stepper or timeline showing all processes in sequence

**Each process step shows:**
- Step number (1, 2, 3…) and process name
- Status badge: Locked / Active / In Progress / Completed
- If `Locked`: grey row, lock icon, no action
- If `Active`: highlighted row with **"Start Process"** button (teal)
- If `In Progress`: highlighted row with **"Continue"** button (amber)
- If `Completed`: green row, tick icon, completed timestamp, completed by, **"View"** button and **"Request Correction"** button

**When "Start Process" is clicked:**
- Status changes to `In Progress`
- The dynamic form for that process expands inline (or opens as a modal)
- Form fields are rendered from `dim_process_fields` for this `process_id` — fully dynamic
- Each field type renders correctly:
  - `text` → text input
  - `number` → number input
  - `date` → date picker
  - `dropdown` → select with configured options
  - `checkbox` → checkbox
  - `textarea` → multiline text input
- Required fields are marked with *
- Buttons: **"Save as Draft"** (saves without completing) and **"Mark as Complete"**

**When "Mark as Complete" is clicked:**
- Validate all required fields are filled
- Save field values as JSON to `field_data_json` in `fact_production_process_log`
- Set `step_status = Completed`, record `completed_at` and `completed_by`
- **Immediately unlock the next process** (update next row's `step_status` from `Locked` to `Active`)
- Show success toast: "Process X completed. Process Y is now unlocked."
- Refresh the stepper view

**When all processes are `Completed`:**
- Show a **"Complete Batch"** button prominently
- On click: prompt for `actual_qty` (actual output quantity)
- Update batch status to `Completed` with `actual_qty` and `updated_at`
- Show confirmation banner: "Batch BATCH-20260610-001 completed successfully."

---

### UI: Batch List

Table columns: Batch ID | Date | Product | Company | Planned Qty | Actual Qty | Status | Progress | Actions

**Progress column:** Show a mini progress bar like "4/6 processes done" — count of Completed steps out of total steps.

**Actions:** View (opens Batch Process View) | Cancel (with reason, confirmation dialog)

Filters: Date range | Product | Company | Status

---

### Batch Cancel Rule

A batch can be cancelled at any stage. On cancel:
- Prompt for cancellation reason (required)
- Set batch status to `Cancelled`
- All remaining `Active` or `Locked` process steps get `step_status = Cancelled`
- Already `Completed` steps remain as-is (audit trail preserved)

---

## PART 2 — DATA CORRECTION WORKFLOW

### Core Rules

1. **No hard deletes** on any fact table record, ever.
2. Any **completed** process log step can have a correction requested.
3. Corrections go through an **approval workflow** — Admin or Supervisor must approve.
4. Every correction is logged in `fact_corrections` with full before/after audit trail.
5. Only one pending correction per field per record at a time.

---

### Google Sheets: `fact_corrections` sheet columns:
```
correction_id | requested_at | requested_by | source_sheet | source_row_id | field_name | field_label | old_value | new_value | reason | status | reviewed_at | reviewed_by | review_note
```

- `correction_id`: Auto-generated `COR-YYYYMMDD-NNN`
- `status`: `Pending` | `Approved` | `Rejected`
- `source_sheet`: The sheet name where the correction applies (e.g. `fact_production_process_log`, `fact_inventory_in`, `fact_sales`)
- `source_row_id`: The `log_id` / `sale_id` / `batch_id` of the record being corrected

---

### Where "Request Correction" Appears

The correction button appears on **any saved/completed record** across these modules:

| Module | Where button appears |
|---|---|
| Production | On each `Completed` process step in the Batch Process View |
| Inventory | On each row in Stock In and Stock Out list views |
| Sales | On each row in Sales List |
| Dispatch | On each row in Dispatch List |

---

### Correction Request Flow (Staff Side)

1. Staff clicks **"Request Correction"** on a completed record
2. A modal opens showing:
   - Record details (read-only): Batch ID / Sale ID / etc., date, product, company
   - Field to correct: Dropdown listing all fields of that record (e.g., for a process log: all dynamic field names from `dim_process_fields`)
   - **Old Value**: Auto-populated (read-only) — shows current saved value
   - **New Value**: Editable input (type matches the field type)
   - **Reason**: Required text area — why is this being corrected?
3. Submit button: **"Submit Correction Request"**
4. On submit: Write a new row to `fact_corrections` with `status = Pending`
5. Toast: "Correction request submitted. Awaiting approval."
6. The record row in the list shows a **yellow "Pending Correction"** badge until resolved

---

### Corrections Inbox (Admin / Supervisor Only)

**URL:** `#corrections/inbox`

**Two tabs:**
- **Pending** — corrections awaiting review
- **History** — all past corrections (approved + rejected)

**Pending tab table columns:**

| Column | Description |
|---|---|
| Correction ID | e.g. COR-20260610-001 |
| Requested At | Date + time |
| Requested By | User name |
| Module | Which module (Production / Sales / Inventory / Dispatch) |
| Record | Source record ID |
| Field | Which field is being corrected |
| Old Value | Current saved value |
| New Value | Proposed new value |
| Reason | Why the correction was requested |
| Actions | Approve / Reject buttons |

**Approve flow:**
- Admin clicks **"Approve"**
- A dialog asks: "Add a reviewer note (optional)"
- On confirm:
  - Apply the new value to the source record in the appropriate sheet
  - For process log corrections: update the `field_data_json` in `fact_production_process_log` with the new value for that specific field key
  - Update the correction row: `status = Approved`, `reviewed_at`, `reviewed_by`, `review_note`
  - Set `is_corrected = TRUE` and `correction_ref_id = correction_id` on the source row
  - Remove "Pending Correction" badge from the source record
  - Toast: "Correction approved and applied."

**Reject flow:**
- Admin clicks **"Reject"**
- Dialog opens: "Rejection reason" (required)
- On confirm:
  - Update correction row: `status = Rejected`, `reviewed_at`, `reviewed_by`, `review_note`
  - Remove "Pending Correction" badge
  - Toast: "Correction request rejected."

**History tab:**
- Same table but includes all Approved and Rejected corrections
- Searchable by correction ID, user, record ID, field name
- CSV export

---

### Correction Visibility Rules

| Role | Can Request Correction | Can Approve/Reject | Can View History |
|---|---|---|---|
| Admin | Yes (any record) | Yes | Yes |
| Supervisor | Yes (own entries) | Yes | Yes |
| Production Staff | Yes (own entries only) | No | Own requests only |
| Sales / Dispatch | Yes (own entries only) | No | Own requests only |
| Viewer | No | No | No |

---

### Correction Badge on Records

Anywhere a record has a **pending** correction request, show a small amber badge: `⏳ Correction Pending`. Once approved or rejected, the badge is removed. If approved, show a small grey tag: `✎ Corrected` with a tooltip showing correction ID and date.

---

## PART 3 — PRODUCTION PROCESS VIEW: CORRECTION INTEGRATION

On the **Batch Process View**, for each `Completed` process step:

- Show: ✅ Completed by [Name] on [Date/Time]
- If that step has a **pending correction**: show `⏳ Correction Pending` badge and disable "Request Correction" (can't submit two at once)
- If that step was previously corrected: show `✎ Corrected` badge — clicking it shows correction details (what was changed, by whom, when)
- The "Request Correction" button is always visible on completed steps — it opens the correction modal described above

---

## PART 4 — UX RULES FOR THIS FLOW

1. **Never let staff skip a process** — the "Start Process" button must be disabled/hidden for Locked steps.
2. **Save as Draft is non-blocking** — staff can save partial data without completing the step. The step stays `In Progress`.
3. **Completed steps are read-only** — after "Mark as Complete", the form fields become non-editable. Changes only happen via Correction Workflow.
4. **Show progress everywhere** — on the Batch List, on the Dashboard "Recent Batches" panel, show how many steps are done out of total.
5. **Auto-save draft every 2 minutes** — while a process form is open and being filled, auto-save to `In Progress` silently.
6. **Confirmation before "Mark as Complete"** — show a dialog: "Are you sure you want to mark [Process Name] as complete? This cannot be undone without a correction request." Confirm / Cancel.
7. **Mobile-friendly stepper** — on small screens, the process pipeline collapses to a tap-to-expand accordion per step.

---

## PART 5 — DASHBOARD UPDATES

Add to the dashboard:

- **Active Batches** card: Count of batches with status `In Progress`, clicking navigates to Batch List filtered to In Progress
- **Batches Completed This Month** card
- **Pending Corrections** card: Count, clicking navigates to Corrections Inbox
- **Recent Batches** panel: Show last 5 batches with mini progress bar (X/Y processes done) and status badge

---

## Summary of Google Sheets Writes in This Flow

| Action | Sheet Written |
|---|---|
| Create batch | `fact_production_batches` (1 row) + `fact_production_process_log` (N rows, one per process) |
| Start a process | `fact_production_process_log` — update `step_status = In Progress`, `started_at` |
| Save draft | `fact_production_process_log` — update `field_data_json`, keep `step_status = In Progress` |
| Complete a process | `fact_production_process_log` — update `step_status = Completed`, `field_data_json`, `completed_at`, `completed_by` + unlock next row (`step_status = Active`) |
| Complete a batch | `fact_production_batches` — update `status = Completed`, `actual_qty`, `updated_at` |
| Cancel a batch | `fact_production_batches` — `status = Cancelled` + `fact_production_process_log` — remaining rows `step_status = Cancelled` |
| Submit correction | `fact_corrections` (1 new row, `status = Pending`) |
| Approve correction | `fact_corrections` — update status + apply value change to source sheet row |
| Reject correction | `fact_corrections` — update status |

---

*Prompt v2 — Flavourmax Manufacturing Management System*
*Focus: Sequential Batch Production Flow + Correction Workflow*
