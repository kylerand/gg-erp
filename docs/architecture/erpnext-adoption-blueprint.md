# ERPNext Adoption Blueprint for GG ERP

Status: proposed architecture blueprint  
Source reference: `/Users/kylerand/code/reference_repos/erpnext`  
Target repo: `/Users/kylerand/code/gg-erp`

## Summary

ERPNext is useful for `gg-erp` as a business-architecture reference, not as a stack to clone. The main pattern to adopt is ERPNext's object-first ERP model: every business area is organized around named documents, child tables, lifecycle status, permissions, reports, workspace cards, and settings. `gg-erp` should translate that into TypeScript, Prisma, Postgres schemas, explicit APIs, domain services, and Next.js workspaces.

The practical shift is from page-first feature slices to document/workspace-driven modules. A user should be able to enter Accounting, Inventory, Selling, Buying, Manufacturing, Projects, Quality, or Support and immediately see the relevant documents, actions, reports, exceptions, and setup records for that business area.

## ERPNext Patterns To Borrow

### Module and Workspace Structure

ERPNext groups the product by business module directories such as `accounts`, `buying`, `selling`, `stock`, `manufacturing`, `projects`, `quality_management`, `support`, `setup`, and `assets`. Each module has a workspace JSON file that defines the top-level operational page: charts, number cards, grouped link cards, reports, masters, tools, and settings.

Translate this to `gg-erp` as:

- One first-class workspace per bounded context or major operator role.
- Workspace pages that combine live cards, exception queues, common document lists, reports, and setup links.
- Sidebar and command palette links derived from the same module map so navigation does not drift.
- A consistent distinction between transaction documents, master data, settings, tools, and reports.

### Document Model

ERPNext DocTypes encode the core ERP contract: fields, child tables, required inputs, list-view columns, search fields, permissions, status behavior, and submit/cancel lifecycle. Examples inspected:

- Accounting: `Account`, `GL Entry`, `Sales Invoice`
- Buying: `Purchase Order`
- Selling: `Customer`
- Stock: `Item`, `Stock Entry`
- Manufacturing: `BOM`, `Work Order`, `Job Card`

Translate this to `gg-erp` as explicit TypeScript document contracts:

- `master` documents: customer, part/item, vendor, employee, account, warehouse/location.
- `transaction` documents: quote, sales order, purchase order, stock movement, work order, job card/task, invoice, payment, inspection.
- `settings` documents: module settings, naming series, dimensions, tax/provider mappings.
- `report` definitions: query, filters, columns, default grouping, owner module.

Do not make `gg-erp` metadata-only like Frappe. Use the metadata as a navigation/report/form contract, while preserving typed services and Prisma models for persistence and business rules.

### Lifecycle Model

ERPNext heavily uses `docstatus` and document-specific status fields:

- Draft-like state for work in progress.
- Submitted state for committed business records.
- Cancelled/amended state for reversals.
- Derived workflow status for operations such as work order progress, purchase receipt progress, billing progress, or stock reservation.

Translate this to `gg-erp` with a shared document lifecycle policy:

- Introduce a common lifecycle vocabulary for transaction documents: `DRAFT`, `SUBMITTED`, `CANCELLED`, and domain-specific operational status.
- Keep domain statuses where needed, such as `WoStatus`, `PurchaseOrderState`, `QuoteStatus`, and sync states.
- Add document history/audit events for submit, cancel, amend, and state transition.
- Treat committed stock/accounting movements as append-only with reversal records instead of destructive edits.

### Business Ledgers

ERPNext uses ledgers as durable consequences of submitted documents:

- `GL Entry` records accounting impact.
- Stock ledger and stock entries record inventory movement and valuation.
- Work orders and job cards create manufacturing execution history.

Translate this to `gg-erp` as:

- Accounting ledger: durable internal ledger tables in addition to QuickBooks sync records.
- Inventory ledger: append-only stock movement records as the source of quantity history.
- Labor ledger: time entries and job-card-like task execution records.
- Quality ledger: inspection/QC results tied to work orders, parts, and customer assets.

QuickBooks should remain an integration target and reconciliation source, not the only accounting system of record for operational ERP decisions.

### Reports and Number Cards

ERPNext modules consistently expose charts, number cards, grouped report links, and operational lists. The important pattern is that every module answers:

- What needs attention now?
- What transactions are active?
- What master data supports this module?
- What reports prove performance or correctness?
- What setup/settings are needed?

Translate this to `gg-erp` with a report registry:

- Each module defines `numberCards`, `reports`, `quickActions`, `documentLists`, and `settingsLinks`.
- Reports are backed by explicit query endpoints or read models.
- QA should assert that workspace links route to real pages and do not land on placeholders.

## Whole-ERP Module Map

| ERPNext module | Main ERPNext documents/patterns | Current `gg-erp` fit | Adoption direction |
|---|---|---|---|
| Setup | Company, UOM, customer group, supplier group, territory, employee, defaults | Partially present across identity, HR, inventory, customers | Create a Setup/Admin workspace for global masters, naming series, and module defaults. |
| Accounts | Account tree, GL Entry, Sales Invoice, Payment Entry, financial reports | QuickBooks sync exists; internal ledger is thin | Add internal accounting documents/ledger and keep QuickBooks as sync/reconciliation. |
| Selling | Customer, quotation, sales order, sales invoice, pricing rules | Sales pipeline, quotes, customers exist | Add sales-order lifecycle and connect quote acceptance to work order, invoice, and customer asset flow. |
| Buying | Supplier, RFQ, supplier quotation, purchase order, purchase invoice | Vendors and purchase orders exist in inventory | Promote Buying/Purchasing as its own workspace with vendor, RFQ/quote, PO, receiving, and payable hooks. |
| Stock | Item, warehouse, stock entry, stock reconciliation, item price | Parts, stock locations, lots, reservations exist | Rename operator concept toward Item/Part catalog, add stock-entry-style movement types and inventory reports. |
| Manufacturing | BOM, routing, operation, work order, job card, workstation | Work orders, routing steps, time entries, QC gates exist | Add BOM/routing/job-card parity and make shop-floor tasks the execution view of work orders. |
| Projects | Project, task, timesheet, activity type/cost | Planning and work orders exist; projects are absent | Add later only if custom builds need cross-work-order project tracking. |
| Quality | Quality inspection, non-conformance, quality action/procedure | QC gates and SOP/OJT exist | Promote QC gates into Quality workspace with inspections, nonconformance, corrective action, and SOP links. |
| Support | Issue, maintenance, warranty, SLA | Tickets/work-orders cover service; support module absent | Model service tickets and warranty claims after support docs if customer service grows beyond work orders. |
| Assets | Asset, maintenance schedule, depreciation | Cart vehicle/assets exist in planning | Treat carts as customer assets with service history, warranty, and lifecycle state. |
| CRM | Lead, opportunity, campaign, sales stage | Sales opportunities and activities exist | Keep current sales pipeline; borrow report/workspace organization rather than ERPNext's deprecated CRM module. |
| Communication | Communications, channels, notifications | Messages module exists | Keep `gg-erp` messages as collaboration layer; link messages to documents by entity reference. |

## Target Architecture For `gg-erp`

### Business Object Registry

Add a typed registry that defines every first-class business object. This should not replace Prisma or APIs; it should bind navigation, labels, ownership, search, permissions, and reports together.

Minimum registry fields:

- `key`: stable identifier, such as `inventory.part` or `manufacturing.workOrder`.
- `label` and `pluralLabel`.
- `module`: owning workspace.
- `kind`: `master`, `transaction`, `settings`, `report`, or `tool`.
- `route`: canonical list/detail route.
- `ownerContext`: API/domain context.
- `primaryStatusField`.
- `searchFields`.
- `numberSeries` where applicable.
- `listColumns`.
- `quickActions`.

Recommended home: `packages/domain/src/erp-object-registry.ts`, consumed by web navigation, command palette, QA route discovery, and future API metadata endpoints.

### Workspace Model

Replace ad hoc sidebar children with module workspace definitions. Each workspace should expose:

- KPI/number cards.
- Operational queues.
- Document groups: transactions, masters, reports, settings.
- Setup completeness state.
- Role-specific quick actions.

Recommended home: `packages/domain/src/erp-workspaces.ts`, with the web app rendering the definitions through existing UI components.

### Document Lifecycle Standard

For transaction objects, standardize lifecycle handling:

- Draft: editable, not operationally committed.
- Submitted: committed, may create ledger/events/downstream tasks.
- Cancelled: reversal path only; no hard delete.
- Amended: new version references prior document.

Do this first in domain services and UI labels before changing schema broadly. Existing domain statuses remain in place, but submit/cancel/amend should become explicit transitions for documents where it matters.

### Ledger and Read Model Direction

Preserve `gg-erp`'s event/outbox architecture and Postgres schema ownership. Borrow ERPNext's ledger consequences:

- Inventory stock movements become the source of stock history and availability reports.
- Accounting ledger entries become the internal source for financial reports; QuickBooks sync reconciles against them.
- Labor/time and QC records become operational ledgers tied to work orders/job cards.
- Workspaces read from summary read models instead of recomputing complex state in React pages.

### API and UI Shape

Use explicit endpoints, not a generic Frappe-style document API:

- `GET /workspace/:module` for workspace cards and queues.
- `GET /metadata/erp-objects` for nav/search/report metadata if needed.
- Existing module endpoints continue to own business behavior.
- Web routes should align with document names: `/buying/purchase-orders`, `/stock/items`, `/manufacturing/work-orders`, `/quality/inspections`, `/accounting/ledger`.

## Adopt / Adapt / Avoid

### Adopt

- Module workspace structure with reports, cards, grouped links, masters, settings, and tools.
- Document lifecycle discipline for business transactions.
- Append-only consequences for accounting, inventory, labor, and quality.
- Naming-series convention for human-readable document numbers.
- Tree structures for chart of accounts, item groups, warehouses/locations, territories, and departments.
- Strong distinction between master data and transactions.

### Adapt

- DocType metadata becomes typed registry/config, not runtime schema.
- Frappe permission metadata becomes integration with current Cognito/app role policy.
- ERPNext reports become explicit query endpoints and read models.
- Submit/cancel hooks become domain service methods plus outbox/audit events.
- Workspace JSON becomes TypeScript workspace definitions rendered by the current UI.

### Avoid

- Replacing Prisma/schema-first persistence with dynamic metadata tables.
- Building one generic CRUD UI for every object before the core workflows are correct.
- Copying ERPNext's Python/Frappe controller model.
- Treating QuickBooks as the whole accounting context.
- Exposing placeholder workspace links without backed routes and QA coverage.

## Recommended Implementation Sequence

### Slice 1: ERP Object And Workspace Registry

Create the typed registry for current `gg-erp` modules and use it to drive sidebar children and command palette destinations. Start with existing objects only: work orders, parts, reservations, purchase orders, customers, dealers, training modules, quotes, opportunities, QuickBooks sync, reconciliation, messages, admin/audit, and reporting.

Acceptance criteria:

- Sidebar and command palette share a source of truth.
- Every registry route exists or is explicitly marked `planned` and hidden from production navigation.
- QA smoke asserts top-level workspace links render.

### Slice 2: Accounting As Real ERP Accounting

Split Accounting into internal ledger, QuickBooks integration, reconciliation, invoices, customers, chart of accounts, and financial reports. Add an internal ledger design before adding financial reports.

Acceptance criteria:

- QuickBooks pages remain live integration views.
- Internal accounting has its own document concepts and route map.
- Reconciliation compares internal documents to QuickBooks, not UI counters to QuickBooks.

### Slice 3: Stock/Inventory Parity

Introduce ERPNext-style stock movement types and reports around current parts, lots, reservations, receiving, and purchase orders.

Acceptance criteria:

- Stock movement history is visible per part and location.
- Receiving creates stock movement records.
- Reservations and shortages are represented in workspace cards and reports.

### Slice 4: Manufacturing Execution Parity

Map current work orders, routing steps, technician tasks, time entries, and QC gates to BOM/routing/work order/job card concepts.

Acceptance criteria:

- Work order detail shows BOM, routing, job cards/tasks, material status, labor, QC, and accounting impacts as first-class sections.
- Floor tech app remains task-first, but tasks are visibly tied to job-card/work-order execution.

### Slice 5: Quality, Assets, Buying, And Service Expansion

Add module workspaces and document models for Quality, Assets, Buying, and Support-style service as the shop workflows require them.

Acceptance criteria:

- Quality inspections and nonconformance are independent from but linked to work orders.
- Customer cart assets have lifecycle and service history.
- Buying has vendor/RFQ/PO/receiving/report structure.

## Testing And QA Strategy

- Extend route discovery to fail on navigation links that point to placeholder pages or hash-only data views.
- Add workspace smoke tests that click every visible module card and quick action.
- Add architecture tests for registry route validity once the registry exists.
- Add service-level tests for submit/cancel/amend transitions before applying lifecycle policy to more documents.
- Add report/read-model tests that prove cards are backed by API/read-model data, not mock constants.

## Decisions And Defaults

- `gg-erp` remains a TypeScript/Next.js/Prisma/Postgres/AWS system.
- ERPNext is an architectural reference, not a code dependency.
- The first implementation target should be shared object/workspace metadata because it prevents future UI drift and supports the user's complaint that pages look good but are not actionable.
- Accounting, Inventory/Stock, and Manufacturing should be the first business domains to receive deeper ERPNext-style workflow parity.
- Placeholder routes should be hidden from production navigation until backed by useful list/detail/report pages.
