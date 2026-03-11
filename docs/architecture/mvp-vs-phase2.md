# MVP vs Phase 2 Split

## MVP scope (ship first)

- Employee web app shell (auth + dashboard + operational navigation)
- Ticket lifecycle and assignment
- Inventory records + reservation mechanics
- SOP/OJT document + progress tracking integration
- Build-slot planning workflow with deterministic scoring baseline
- QuickBooks integration for customers, invoices, payments, items/products, vendors/bills, GL sync
- ShopMonkey migration for master/open records + historical backfill framework
- Audit log pipeline and observability baseline
- App-layer row-level authorization controls with deterministic deny reasons/audit hooks
- Bedrock-backed capabilities:
  - SOP/OJT assistant (RAG)
  - Ticket summarization
  - Build-slot planning copilot
  - Inventory anomaly detection
  - Natural-language ERP search

## Phase 2 scope

- Advanced planning optimization (multi-objective + what-if simulation)
- Additional accounting automations and exception workflows
- Rich BI read models and self-service analytics
- Expanded AI toolset with human-in-the-loop approvals
- Optional staging environment + stronger deployment gates
- PostgreSQL Row-Level Security (RLS) policies for identity-scoped operational tables (keeping app-layer guards as defense-in-depth)

## MVP acceptance test matrix

| Capability | Must-pass tests |
|---|---|
| Tickets | Create/update/close + role-based authorization failures |
| Inventory | Reserve/release idempotency + shortage handling |
| Planning | Deterministic slot output for same input + timeout failure path |
| QuickBooks sync | Retry and DLQ on provider outage + reconciliation report |
| Migration | Batch import resume and record-level error isolation |
| AI | Guardrail blocks unsafe prompts + request/audit correlation |
| Audit/Obs | Every mutation traceable with actor + correlation id |
