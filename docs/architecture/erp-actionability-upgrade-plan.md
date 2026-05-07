# ERP Actionability Upgrade Plan

This plan tracks the UAT remediation work needed to move the ERP from polished screens to production-useful operator workflows.

## Status Rules

- `Done`: implemented in code and wired to a real route, API contract, or user-visible workflow.
- `In Progress`: partial implementation exists, but the workflow still has known gaps.
- `Not Started`: scoped from UAT, but no implementation has landed.
- `Blocked`: cannot finish without missing data, credentials, vendor setup, or a product decision.

## Priority Sequence

1. **P0:** Make global shell controls actionable.
2. **P0:** Create a unified work-order and quote command center.
3. **P1:** Make dashboard cards, KPIs, filters, and status chips deep-link to filtered real data.
4. **P1:** Replace raw-ID forms with searchable selectors and validation.
5. **P1:** Repair training content, notes, bookmarks, and completion flows.
6. **P2:** Complete inventory, purchasing, reservations, and receiving workflows.
7. **P2:** Turn reporting and admin into catalogs of real operational destinations.

## Delivery Tracker

| Slice                              | Status      | Evidence                                                                                                                                                                                                                | Remaining Work                                                                                          |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Progress dashboard                 | Done        | `docs/operations/erp-uat-progress.html`                                                                                                                                                                                 | Update after each implementation slice                                                                  |
| Global shell actionability         | In Progress | Command search, quick-create, recent routes, floor-app return link, notification deep links                                                                                                                             | Add true SSO handoff for floor tech app                                                                 |
| Unified work-order command center  | In Progress | `/work-orders/[id]` route with services, parts, time, QC, SOP, messages, accounting links, live material quantities, inline reserve/release/fulfill actions, labor logging, QC submit, and derived activity             | Add editable services, customer/cart profile drawers, quote conversion, and richer event stream history |
| Dashboard and KPI deep links       | Done        | Work-order, inventory parts/reservations, QuickBooks reference lists, reporting cards, role-dashboard KPI cards, training assignments, and audit search use URL-backed filtered destinations                            | Keep the same pattern as new catalogs and filters become stable                                         |
| Forms and selectors                | In Progress | Work-order and quote create screens use live customer, cart, opportunity, part, and recent build-package selectors with mock fallback disabled                                                                          | Add dedicated build configuration, BOM, vendor, and technician selectors once those catalogs are stable |
| Training repair                    | In Progress | Step page now loads lesson content even if optional progress/notes/bookmarks fail; missing `/images/modules/*` assets have a fallback image route; assignments support URL-backed status/search filters                 | Finish API-level notes/bookmarks hardening and verify seeded module media                               |
| Inventory and purchasing workflows | In Progress | PO receiving and work-order reservation execution are wired to live inventory APIs                                                                                                                                      | Add PO detail drill-in, reorder suggestions, import/export, and broader row actions                     |
| Reporting catalog                  | In Progress | `ERP_REPORTS` feeds named report cards, workspace navigation, command palette entries, category/search filters, live signals, and filtered drill-through links                                                          | Add saved report definitions, exports, trend history, and custom report scopes                          |
| Admin configuration catalog        | In Progress | Access, audit, and integrations pages exist; integration health uses strict live QuickBooks, sync queue, account, and reconciliation sources; `/admin/accounting` configures live QuickBooks dimension and tax mappings | Add settings-style domains for roles, templates, API keys, and webhooks once those APIs exist           |

## Implementation Notes

- Every card, button, and row should either perform an explicit action or route to a focused operational destination.
- Empty states must say what data is missing and what the operator should do next.
- Query-backed filters should update the URL, active state, result count, and empty-state copy.
- Shopmonkey's order page is the reference model for work-order detail: customer, cart, services, parts, labor, notes, payment/accounting, purchase orders, and activity in one workspace.
