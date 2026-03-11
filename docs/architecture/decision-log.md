# Architecture Decision Log

## ADR-001: Use TypeScript monorepo at `gg/erp`
- **Status:** Accepted
- **Decision:** Create a new top-level monorepo rooted at `erp/`.
- **Rationale:** Avoid coupling with legacy/prototype repos while reusing concepts.
- **Tradeoff:** Requires explicit integration documentation across existing repositories.

## ADR-002: API Gateway + Lambda for backend compute
- **Status:** Accepted
- **Decision:** Serverless API runtime for bounded-context handlers.
- **Rationale:** Cost-effective at early traffic and naturally scalable.
- **Tradeoff:** Cold starts and event-debugging complexity must be managed.

## ADR-003: Aurora PostgreSQL Serverless v2 as primary store
- **Status:** Accepted
- **Decision:** Single relational source with context-owned schemas.
- **Rationale:** ERP workflows need strong consistency and migration-safe SQL.
- **Tradeoff:** Requires migration discipline and query governance.

## ADR-004: EventBridge + Step Functions for async orchestration
- **Status:** Accepted
- **Decision:** Event bus for decoupling; Step Functions for long-running workflows.
- **Rationale:** Clear failure semantics and replay support for ERP processes.
- **Tradeoff:** More moving parts than synchronous-only architecture.

## ADR-005: Bedrock AI from MVP behind orchestration boundary
- **Status:** Accepted
- **Decision:** Central AI orchestration module mediates all Bedrock calls.
- **Rationale:** Consistent guardrails, auditability, and cost controls.
- **Tradeoff:** Additional indirection for teams shipping AI features.

## ADR-006: Dev + Prod environment strategy for early stage
- **Status:** Accepted
- **Decision:** Start with two environments to minimize cost.
- **Rationale:** Fits current stage while preserving a path to add staging later.
- **Tradeoff:** Higher release discipline required (contract tests, canaries).

## ADR-007: Migration strategy from ShopMonkey is phased
- **Status:** Accepted
- **Decision:** Master/open first, historical backfill later.
- **Rationale:** Reduces cutover risk and shortens time-to-value.
- **Tradeoff:** Requires temporary dual-system reconciliation during transition.
