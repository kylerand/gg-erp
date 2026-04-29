# ERP Architecture Document Index

This folder contains principal-level architecture docs for the Golfin Garage ERP.

## Core platform documents

- `erp-system-context.md`
- `bounded-contexts.md`
- `data-ownership.md`
- `flows-sync-vs-async.md`
- `aws-service-mapping.md`
- `risks-and-tradeoffs.md`
- `mvp-vs-phase2.md`
- `migration-from-shopmonkey.md`
- `decision-log.md`
- `postgresql-schema-design.md`
- `postgresql-rollout-and-seeding.md`
- `authn-authz-implementation-plan.md`
- `domain-event-model-eventbridge-outbox.md`
- `erpnext-adoption-blueprint.md`

## Module-specific design documents

### Operations and execution

- `work-order-module-design.md`
- `ticketing-rework-subsystem-design.md`
- `build-slot-planning-engine-design.md`
- `inventory-module-design.md`

### Knowledge and AI

- `sop-ojt-knowledge-module-design.md`
- `ai-layer-bedrock-knowledge-bases-design.md`

### Finance and migration

- `quickbooks-integration-layer-design.md`
- `shopmonkey-migration-export-plan.md`

## Inventory design references

- `inventory-module-design.md`
- `bounded-contexts.md` (Inventory context boundary)
- `data-ownership.md` (`inventory` schema ownership)
- `postgresql-schema-design.md` (inventory tables and constraints)
- `flows-sync-vs-async.md` (reservation + shortage event flow)

## Employee web IA/UX documents

- `employee-web-information-architecture.md`
- `employee-web-api-dependency-map.md`
- `employee-web-component-library.md`
- `employee-web-role-dashboards.md`
- `employee-web-screen-map.md`
- `employee-web-state-strategy.md`
- `employee-web-user-journeys.md`
- `employee-web-ux-risks.md`

## Employee web IA audit criteria map (explicit)

| Required audit criterion                 | Primary document(s)                        | Primary section anchors                                                                   |
| ---------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1) Navigation tree                       | `employee-web-information-architecture.md` | `Global navigation tree (MVP)`, `Top-level route contract`, `Role-conditional navigation` |
| 2) Screen inventory                      | `employee-web-screen-map.md`               | `Screen map hierarchy`, `Screen inventory (required capabilities)`                        |
| 3) Role-based home dashboards            | `employee-web-role-dashboards.md`          | Role-specific dashboard sections + alert ladders                                          |
| 4) Top user journeys                     | `employee-web-user-journeys.md`            | Journey sections 1-6 with happy/failure/audit/UX safeguards                               |
| 5) Suggested component library structure | `employee-web-component-library.md`        | `Folder/module taxonomy`, component class contracts, telemetry contract                   |
| 6) State management strategy             | `employee-web-state-strategy.md`           | `State model`, server/local/session/draft strategy, consistency/recovery rules            |
| 7) API dependency map by screen          | `employee-web-api-dependency-map.md`       | `Screen/workflow -> API dependency matrix`, critical mutation flows                       |
| 8) UX risks to avoid in shop-floor usage | `employee-web-ux-risks.md`                 | `UX risk matrix`, screen/workflow binding                                                 |

## Work-order module design audit criteria map (explicit)

| Required audit criterion                | Primary document(s)           | Primary section anchors                                                             |
| --------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| 1) Domain model                         | `work-order-module-design.md` | `1) Domain model`, `TypeScript-first domain contract (proposed)`                    |
| 2) State machine                        | `work-order-module-design.md` | `2) State machine`, `Work order state machine`, `Step-level execution machine`      |
| 3) Schema                               | `work-order-module-design.md` | `3) Schema (additive migration design)`, `Schema decisions and rationale`           |
| 4) APIs                                 | `work-order-module-design.md` | `4) API surface`, mutating header contract + endpoint matrix                        |
| 5) Step Functions orchestration example | `work-order-module-design.md` | `5) Example workflow orchestration with Step Functions`, `Example ASL (simplified)` |
| 6) Event definitions                    | `work-order-module-design.md` | `6) Event definitions`, `Event policy`                                              |
| 7) UI needs for technician + manager    | `work-order-module-design.md` | `7) UI needs (technician + manager)`                                                |
| 8) Concurrency/reassignment risks       | `work-order-module-design.md` | `8) Concurrency and reassignment risks`                                             |

## Ticketing rework audit criteria map (explicit)

| Required audit criterion                           | Primary document(s)                       | Primary section anchors                                                                                     |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1) Ticket taxonomy and severity contracts          | `ticketing-rework-subsystem-design.md`    | `1) Ticket types and severity model`, `TypeScript-first contract (proposed)`                              |
| 2) SLA, assignment, and escalation policy          | `ticketing-rework-subsystem-design.md`    | `2) SLA model`, `3) Assignment and escalation rules`                                                       |
| 3) Persistence/API/event contract completeness     | `ticketing-rework-subsystem-design.md`    | `4) Database schema (additive migration design)`, `5) API routes (MVP contract)`, `6) Event model`       |
| 4) Rollout quality and operations readiness checks | `ticketing-rework-subsystem-design.md`    | `Tests and failure matrix`, `Explicit audit logging points`, `Event emission points`, `Observability hooks` |

## SOP/OJT knowledge module audit criteria map (explicit)

| Required audit criterion                  | Primary document(s)                    | Primary section anchors                                                                                 |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1) Domain + lifecycle model               | `sop-ojt-knowledge-module-design.md`   | `1) Domain model`, `Authoring/execution lifecycle rules`                                               |
| 2) Schema and migration contract          | `sop-ojt-knowledge-module-design.md`   | `2) Database schema (additive migration design)`, `Migration files (explicit)`                         |
| 3) Retrieval and ingestion architecture   | `sop-ojt-knowledge-module-design.md`   | `5) Search model`, `6) Bedrock Knowledge Base ingestion plan`                                          |
| 4) Governance model                       | `sop-ojt-knowledge-module-design.md`   | `8) Governance and versioning model`                                                                    |
| 5) Test/audit/event/observability coverage | `sop-ojt-knowledge-module-design.md` | `9) Tests and failure cases`, `10) Audit logging points, event emission points, and observability hooks` |

## Build-slot planning engine audit criteria map (explicit)

| Required audit criterion                     | Primary document(s)                     | Primary section anchors                                                                                |
| -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1) Scheduling objective and constraints      | `build-slot-planning-engine-design.md`  | `1) Formal problem framing`, `2) Inputs, outputs, and constraints`                                   |
| 2) Data model and migration plan             | `build-slot-planning-engine-design.md`  | `3) Data model needed to support scheduling`, `Additive migration path for scheduling tables (explicit)` |
| 3) Deterministic planning algorithm contract | `build-slot-planning-engine-design.md`  | `4) Heuristic MVP algorithm`, `Determinism rules`, `6) Confidence scoring model`                     |
| 4) API + rollout quality gates               | `build-slot-planning-engine-design.md`  | `8) APIs for schedule preview and commit`, `10) Metrics to track schedule quality`, `Test and failure matrix` |

## QuickBooks integration audit criteria map (explicit)

| Required audit criterion                    | Primary document(s)                       | Primary section anchors                                                                 |
| ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| 1) Boundary ownership and decomposition     | `quickbooks-integration-layer-design.md`  | `1) Integration boundary`, `Module decomposition (with justification)`, `Data ownership rule` |
| 2) Canonical model and mapping coverage     | `quickbooks-integration-layer-design.md`  | `2) Canonical internal financial objects (TypeScript-first)`, `3) Mapping tables needed` |
| 3) Sync, idempotency, and reconciliation    | `quickbooks-integration-layer-design.md`  | `4) Sync workflows`, `4.6 Retries and idempotency`, `4.7 Reconciliation reporting workflow` |
| 4) Runtime controls and quality gates       | `quickbooks-integration-layer-design.md`  | `5) Error handling model`, `6) Audit model`, `7) API and webhook design`, `8) Test strategy` |

## ShopMonkey migration export audit criteria map (explicit)

| Required audit criterion                 | Primary document(s)                     | Primary section anchors                                                                          |
| ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1) Extraction and staging scope          | `shopmonkey-migration-export-plan.md`   | `1) Data domains to extract first`, `2) Proposed staging schema`                                |
| 2) Identity mapping and deduplication    | `shopmonkey-migration-export-plan.md`   | `3) ID mapping strategy`, `4) Duplicate resolution rules`                                        |
| 3) Cutover and rollback plan             | `shopmonkey-migration-export-plan.md`   | `5) Historical vs active data migration rules`, `7) Cutover strategy`, `8) Rollback strategy`  |
| 4) Validation and observability gates    | `shopmonkey-migration-export-plan.md`   | `6) Validation and reconciliation steps`, `Test and failure matrix`, `Audit/event/observability hooks` |

## Domain event model audit criteria map (explicit)

| Required audit criterion                   | Primary document(s)                             | Primary section anchors                                                                |
| ------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1) Canonical event contract quality        | `domain-event-model-eventbridge-outbox.md`      | `1) Event naming conventions`, `2) Payload schema conventions (TypeScript-first)`     |
| 2) Reliable publishing and idempotency     | `domain-event-model-eventbridge-outbox.md`      | `3) Outbox design`, `4) Idempotency strategy`                                          |
| 3) Consumer replay/failure resilience      | `domain-event-model-eventbridge-outbox.md`      | `5) Consumer design guidance`, `6) Failure and replay strategy`, `Anti-duplication and replay guarantees` |
| 4) Test, audit, and operability gates      | `domain-event-model-eventbridge-outbox.md`      | `6.1) Required test/failure/audit/observability hooks`, `7) Example TypeScript publisher and consumer code` |

## AI layer audit criteria map (explicit)

| Required audit criterion                    | Primary document(s)                              | Primary section anchors                                                                  |
| ------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1) Capability and RAG architecture          | `ai-layer-bedrock-knowledge-bases-design.md`     | `1) AI capability map`, `2) RAG architecture (Bedrock Knowledge Bases + ERP tools)`     |
| 2) Tool-calling and guardrail enforcement   | `ai-layer-bedrock-knowledge-bases-design.md`     | `3) Tool-calling/API architecture`, `4) Prompt patterns`, `5) Guardrails`               |
| 3) Evaluation and release thresholds        | `ai-layer-bedrock-knowledge-bases-design.md`     | `6) Evaluation plan`                                                                      |
| 4) Audit/event/observability implementation | `ai-layer-bedrock-knowledge-bases-design.md`     | `7) Logging and audit model`                                                              |
| 5) MVP value focus and delivery scope       | `ai-layer-bedrock-knowledge-bases-design.md`     | `8) First 5 highest-value AI use cases`, `Guardrail and delivery decisions summary`      |

## Standards coverage map (cross-document)

| Standard                                          | Where it is explicitly addressed                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript-first intent                           | `employee-web-component-library.md` (`Telemetry contract`), `work-order-module-design.md` (`TypeScript-first domain contract`), `ticketing-rework-subsystem-design.md` (`TypeScript-first contract`), `sop-ojt-knowledge-module-design.md` (`TypeScript-first contracts`, `TypeScript search contract`), `build-slot-planning-engine-design.md` (`Example TypeScript implementation skeleton`), `quickbooks-integration-layer-design.md` (`Canonical internal financial objects (TypeScript-first)`), `shopmonkey-migration-export-plan.md` (`Example scripts structure in TypeScript`), `domain-event-model-eventbridge-outbox.md` (`Payload schema conventions (TypeScript-first)`), `ai-layer-bedrock-knowledge-bases-design.md` (`Citation contract (TypeScript-first)`) |
| Clear modularity over cleverness                  | `employee-web-component-library.md` (`MVP design rules`), `work-order-module-design.md` (`Aggregate boundaries and design justification`), `ticketing-rework-subsystem-design.md` (`Repository/service split (justified)`), `sop-ojt-knowledge-module-design.md` (`Bounded aggregates and boundary justification`), `build-slot-planning-engine-design.md` (`Algorithm choice and rationale`), `quickbooks-integration-layer-design.md` (`Module decomposition (with justification)`), `domain-event-model-eventbridge-outbox.md` (`Outbox design`), `ai-layer-bedrock-knowledge-bases-design.md` (`Service boundaries and responsibilities`) |
| Repository/service justification where applicable | `employee-web-state-strategy.md` (`Repository/service boundary justification`), `work-order-module-design.md` (`Aggregate boundaries and design justification`), `ticketing-rework-subsystem-design.md` (`Repository/service split (justified)`), `quickbooks-integration-layer-design.md` (`Module decomposition (with justification)`), `ai-layer-bedrock-knowledge-bases-design.md` (`Service boundaries and responsibilities`) |
| Tests/failure/audit/events/observability hooks    | `employee-web-user-journeys.md` (failure paths + key events/audit points), `work-order-module-design.md` (`Test and failure matrix`, `Event definitions`), `ticketing-rework-subsystem-design.md` (`Tests and failure matrix`, `Explicit audit logging points`, `Event emission points`, `Observability hooks`), `sop-ojt-knowledge-module-design.md` (`9) Tests and failure cases`, `10) Audit logging points, event emission points, and observability hooks`), `build-slot-planning-engine-design.md` (`Test and failure matrix`), `quickbooks-integration-layer-design.md` (`5) Error handling model`, `6) Audit model`, `8) Test strategy`), `shopmonkey-migration-export-plan.md` (`Test and failure matrix`, `Audit/event/observability hooks`), `domain-event-model-eventbridge-outbox.md` (`6.1) Required test/failure/audit/observability hooks`), `ai-layer-bedrock-knowledge-bases-design.md` (`6) Evaluation plan`, `7) Logging and audit model`) |
| Migrations are not skipped                        | `work-order-module-design.md` (`3) Schema (additive migration design)`), `ticketing-rework-subsystem-design.md` (`4) Database schema (additive migration design)`), `sop-ojt-knowledge-module-design.md` (`Migration files (explicit)`), `build-slot-planning-engine-design.md` (`Additive migration path for scheduling tables (explicit)`), `quickbooks-integration-layer-design.md` (`Migration sequencing (do not skip)`), `shopmonkey-migration-export-plan.md` (`2) Proposed staging schema`, `6) Validation and reconciliation steps`), `domain-event-model-eventbridge-outbox.md` (`Migration files for outbox/inbox evolution`), `ai-layer-bedrock-knowledge-bases-design.md` (`AI metadata migration plan`) |
| Explicit assumptions called out                   | `work-order-module-design.md`, `ticketing-rework-subsystem-design.md`, `sop-ojt-knowledge-module-design.md`, `build-slot-planning-engine-design.md`, `quickbooks-integration-layer-design.md`, `shopmonkey-migration-export-plan.md`, `domain-event-model-eventbridge-outbox.md`, `ai-layer-bedrock-knowledge-bases-design.md` (all include `Explicit assumptions`) |
| MVP simplicity with extension points              | `employee-web-component-library.md` (`MVP design rules`), `work-order-module-design.md` (`MVP simplicity with extension points`), `ticketing-rework-subsystem-design.md` (`MVP simplicity with extension points`), `sop-ojt-knowledge-module-design.md` (`MVP simplicity with extension points`), `build-slot-planning-engine-design.md` (`MVP simplicity with extension points`), `quickbooks-integration-layer-design.md` (`MVP simplicity with extension points`), `shopmonkey-migration-export-plan.md` (`MVP simplicity with extension points`), `domain-event-model-eventbridge-outbox.md` (`Extension points (intentionally deferred)`), `ai-layer-bedrock-knowledge-bases-design.md` (`MVP simplicity with extension points`) |
| Exact files to create/modify when required        | `work-order-module-design.md`, `ticketing-rework-subsystem-design.md`, `sop-ojt-knowledge-module-design.md`, `build-slot-planning-engine-design.md`, `quickbooks-integration-layer-design.md`, `shopmonkey-migration-export-plan.md`, `domain-event-model-eventbridge-outbox.md`, `ai-layer-bedrock-knowledge-bases-design.md` (each includes `Exact files to create or modify` or `Exact files to create/modify`) |

## Update policy

When architecture-impacting implementation changes are introduced, update the corresponding document and include explicit rationale and tradeoffs.
