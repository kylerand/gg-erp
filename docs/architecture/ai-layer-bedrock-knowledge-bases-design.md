# AI Layer Design (Bedrock + Knowledge Bases)

This document defines the MVP architecture for the ERP AI layer using Amazon Bedrock and Bedrock Knowledge Bases, aligned with existing ERP context boundaries, audit requirements, and role-scoped data access.

It is intentionally TypeScript-first, guardrail-heavy for operational safety, and explicit about what is in MVP vs extension points.

## Explicit assumptions

1. AI is advisory in MVP: it can summarize, explain, and draft, but it **cannot directly mutate operational records**.
2. Existing identity/authz and row-level access patterns in `packages/auth` and `apps/api/src/middleware` remain the authorization source of truth.
3. SOP content lives in S3 and is indexed via Bedrock Knowledge Bases.
4. Structured operational data (work orders, inventory, scheduling, accounting) is retrieved through ERP read adapters/tools, not by embedding entire transactional tables.
5. Every AI request has a `correlationId` and actor context.
6. Human approval is mandatory before any write-capable action can execute (including generated invoice note persistence).
7. Responses should include source citations when evidence exists; otherwise they must explicitly state that evidence is unavailable.
8. Migration strategy is additive only; no destructive AI schema changes in MVP rollout.
9. Baseline model/provider remains available as fallback during phased Bedrock rollout.

## Exact files to create or modify (implementation contract)

These are the concrete files to create/modify during implementation (not in this documentation-only task):

- `apps/api/src/migrations/<next_sequence>_ai_layer_bedrock_kb.sql` (create)
- `apps/api/src/contexts/ai/ai.contracts.ts` (create)
- `apps/api/src/contexts/ai/bedrockRuntime.adapter.ts` (create)
- `apps/api/src/contexts/ai/knowledgeBase.adapter.ts` (create)
- `apps/api/src/contexts/ai/erpReadTools.adapter.ts` (create)
- `apps/api/src/contexts/ai/toolRegistry.ts` (create)
- `apps/api/src/contexts/ai/approval.repository.ts` (create)
- `apps/api/src/contexts/ai/metadata.repository.ts` (create)
- `apps/api/src/contexts/ai/approval.service.ts` (create)
- `apps/api/src/contexts/ai/ai.service.ts` (modify)
- `apps/api/src/contexts/ai/ai.routes.ts` (modify)
- `apps/api/src/contexts/ai/baselineAi.provider.ts` (modify; retain as fallback adapter)
- `apps/api/src/app.ts` (modify wiring)
- `apps/api/src/audit/auditPoints.ts` (modify with AI approval/audit actions)
- `apps/api/src/events/catalog.ts` (modify AI event catalog binding)
- `packages/ai/src/ports/ai-provider.ts` (modify for tool/citation aware contract)
- `packages/ai/src/services/orchestrate-query.ts` (create)
- `packages/ai/src/services/prompt-patterns.ts` (create)
- `packages/ai/src/services/response-guardrails.ts` (create)
- `packages/ai/src/services/citation-policy.ts` (create)
- `packages/ai/src/index.ts` (modify exports)
- `packages/domain/src/events.ts` (modify for AI domain events)
- `apps/api/src/tests/ai-failure-cases.test.ts` (modify)
- `apps/api/src/tests/ai-guardrails.test.ts` (create)
- `apps/api/src/tests/ai-role-access.test.ts` (create)
- `apps/api/src/tests/ai-citation-contract.test.ts` (create)
- `apps/api/src/tests/ai-write-approval.test.ts` (create)

This architecture update only documents these changes; implementation follows in a separate execution phase.

## Standards alignment snapshot (explicit)

- **TypeScript-first interfaces:** AI request/response/tool/citation/approval contracts are TypeScript interfaces and enums first.
- **Clear modular boundaries:** route layer, orchestration service, adapters (Bedrock/KB/read tools), and metadata repositories are separated by responsibility.
- **Repository/adapter usage is justified:** repositories only for AI metadata + approval persistence; adapters for external systems (Bedrock, KB, ERP read APIs).
- **Tests/failure cases are explicit:** failure matrix includes authz denial, citation absence, provider failure, and approval bypass attempts.
- **Audit/event/observability hooks are mandatory:** every request/tool call/approval decision emits audit + event + telemetry hooks.
- **Migration discipline maintained:** additive migration (`<next_sequence>_ai_layer_bedrock_kb.sql`) introduces AI metadata tables.
- **MVP-simple with extension points:** starts with read-only tools, single orchestrator, and constrained capability map; expandable via tool registry.
- **Assumptions are explicit:** see `Explicit assumptions`.
- **Exact files are listed:** see `Exact files to create or modify`.

### MVP simplicity with extension points

| MVP choice | Why simple now | Extension point |
|---|---|---|
| Single AI orchestration service for all capabilities | Centralized guardrails and audit behavior | Capability-specific orchestrators when throughput/scaling requires |
| Read-only tool allow-list | Eliminates accidental operational mutation risk | Add write tools gated by explicit approval tokens |
| Bedrock Knowledge Base for SOP corpus | Fast path for grounded SOP retrieval | Add hybrid retrieval (KB + pgvector/OpenSearch custom index) |
| Deterministic response contract with citations array | Easy downstream validation and UI rendering | Rich evidence graph / citation confidence scoring |

## 1) AI capability map

| Capability | Primary users | Retrieval mode | Tools/APIs used | Output contract | Write handling | Citation expectation |
|---|---|---|---|---|---|---|
| SOP retrieval | Technicians, managers | Bedrock Knowledge Base semantic retrieval | `knowledgeBase.retrieveSop` | direct answer + SOP excerpts | none | required when SOP evidence exists |
| Issue triage | Service manager, dispatcher | Hybrid: KB + ticket/work-order context | `tickets.getIssueContext`, `workOrders.getHistory`, `knowledgeBase.retrieveSop` | triage category, urgency, recommended next checks | recommendations only; no ticket state mutation | required for root-cause claims |
| Work order summarization | Technicians, shift leads | Structured records + optional SOP snippets | `workOrders.getDetails`, `workOrders.getNotes` | concise shift handoff summary | none | cite work-order notes/events when referenced |
| Manager dashboard explanations | Managers | Structured dashboard metrics + trend notes | `reports.getManagerDashboardFacts` | explanation of KPI deltas and anomalies | none | cite metrics/record IDs for claims |
| Shortage explanation | Inventory + planning managers | Structured inventory/work-order joins + SOP fallback | `inventory.getShortageContext`, `procurement.getEta` | shortage reason + impact + next best actions | action suggestions only | required for quantities/ETA claims |
| Scheduling risk insights | Planning manager | Structured capacity + dependency data | `planning.getRiskInputs`, `workOrders.getDependencies` | ranked risks with rationale and mitigation suggestions | none | required for risk-driving facts |
| Invoice note drafting | Accounting | Structured invoice/order context + policy KB | `accounting.getInvoiceContext`, `knowledgeBase.retrievePolicy` | draft note text + confidence/flags | persistence requires human approval | required for policy and amount-specific statements |

## 2) RAG architecture (Bedrock Knowledge Bases + ERP tools)

### Architecture flow

1. `POST /ai/query` receives capability, actor context, scope, and target references.
2. AI service resolves allowed capability set for actor role and scope.
3. Query planner chooses retrieval plan:
   - SOP-heavy intent -> Knowledge Base retrieval first.
   - Operational explanation intent -> ERP read tools first, KB as policy/SOP augmentation.
4. Retrieval adapters execute with row-scope filters.
5. Prompt composer builds grounded prompt with:
   - role/scope context
   - retrieved facts
   - citation candidates
   - guardrail policy block
6. Bedrock model generates structured response.
7. Output validator enforces:
   - no direct operational mutation directives
   - citation completeness checks
   - role/scope-safe content checks
8. Response + retrieval metadata + tool traces are persisted to AI metadata tables and audit log.

### Retrieval strategy

- **SOP corpus (unstructured):** Bedrock Knowledge Base with chunking metadata (`docId`, section heading, revision, effective date).
- **Operational records (structured):** deterministic ERP read tool adapters (inventory/work-order/planning/tickets/accounting).
- **Grounding policy:** model sees only retrieved excerpts/facts, not unrestricted database dumps.
- **Freshness policy:** KB sync on SOP publish/update; operational tool reads are real-time query adapters.

### Citation contract (TypeScript-first)

```ts
export type CitationSourceType = 'SOP' | 'WORK_ORDER' | 'TICKET' | 'INVENTORY' | 'PLANNING' | 'ACCOUNTING';

export interface AiCitation {
  sourceType: CitationSourceType;
  sourceId: string;
  locator?: string; // SOP section, note id, event id, etc.
  excerpt?: string;
  confidence: number; // 0..1
}

export interface ProposedAction {
  type: 'NONE' | 'CREATE' | 'UPDATE';
  target: 'TICKET' | 'WORK_ORDER' | 'INVOICE_NOTE';
  rationale: string;
  requiresApproval: boolean;
}

export interface AiResponse {
  answer: string;
  citations: AiCitation[];
  warnings: string[];
  proposedActions: ProposedAction[];
}
```

## 3) Tool-calling/API architecture

### Service boundaries and responsibilities

- **Route boundary (`ai.routes.ts`):** request validation, authz/scope requirements, correlation wiring.
- **Orchestration boundary (`ai.service.ts` + `packages/ai`):** capability routing, prompt assembly, guardrail enforcement, response normalization.
- **Adapter boundary:** Bedrock runtime adapter, Knowledge Base adapter, ERP read tool adapter.
- **Repository boundary:** only AI metadata and approval persistence (`metadata.repository.ts`, `approval.repository.ts`).

Repository/adapter use is intentional:
- Use **adapters** for external system dependencies (Bedrock/KB/ERP context APIs).
- Use **repositories** only where transactional persistence is needed (request traces, approvals, evaluation rows).
- Avoid duplicating domain repositories for inventory/tickets/work-orders inside AI module.

### Proposed API surface (MVP)

- `POST /ai/query` -> run capability query (read-only + draft generation).
- `POST /ai/approvals` -> approve/reject proposed write action.
- `POST /ai/execute-approved` -> execute approved write action with approval token (strictly optional in MVP; can remain disabled initially).
- `GET /ai/requests/:id` -> fetch request, citations, tool trace, and approval status.

### Tool registry policy

```ts
export type ToolMode = 'READ' | 'PROPOSED_WRITE';

export interface AiToolDefinition {
  name: string;
  mode: ToolMode;
  requiredPermissions: string[];
  requiredScopeLevel: 'org' | 'shop' | 'team';
}
```

- MVP allow-list starts with read tools only.
- Any `PROPOSED_WRITE` tool call is blocked unless:
  1) capability permits draft-to-write flow,
  2) actor has permissions,
  3) valid human approval token is present.

## 4) Prompt patterns

### Global system prompt policy (applies to all capabilities)

1. Use only provided retrieved evidence and tool outputs.
2. If evidence is insufficient, explicitly say so.
3. Do not claim that operational changes were performed.
4. Provide citations for factual claims when available.
5. Emit `proposedActions` as suggestions only unless approval token is present.

### Capability prompt templates

- **SOP retrieval template:** instruction + SOP chunk context + “answer with cited SOP sections”.
- **Issue triage template:** issue facts + historical ticket/work-order context + SOP troubleshooting checklist.
- **Work-order summary template:** event timeline + technician notes + unresolved blockers.
- **Manager explanation template:** dashboard metrics + trend windows + anomaly context.
- **Shortage explanation template:** required qty, available qty, allocations, inbound ETAs, substitution policy.
- **Scheduling risk template:** slot capacity, dependencies, shortages, technician constraints.
- **Invoice drafting template:** invoice/order context + tone/policy guidance + mandatory disclaimer for human review.

### Output formatting policy

- Responses must be structured JSON internally before rendering.
- UI-facing formatter converts JSON to markdown/text while preserving citation references.

## 5) Guardrails (hard constraints enforcement)

| Constraint | Enforcement mechanism | Failure behavior |
|---|---|---|
| Human approval for write actions | Tool registry mode + approval token check + approval table validation | Block execution; return `WRITE_APPROVAL_REQUIRED` |
| Auditability | Mandatory audit record + metadata persistence for every request/tool/approval | Fail closed if audit write fails |
| Role-aware data access | Permission + row-scope checks before every retrieval/tool call | Return `403` + `AUTH_ROW_SCOPE_DENIED` |
| No hallucinated operational changes | Read-only default, no direct mutation tools, output validator strips mutation claims | Return guarded response with warning |
| Cite source records/SOPs when possible | Citation validator requires citations for fact-heavy outputs | Return `CITATION_INSUFFICIENT` warning/error by policy |

Additional safety controls:
- Prompt-injection defense: ignore instructions in retrieved data that attempt policy override.
- PII/control filtering: redact restricted fields from tool results before prompting.
- Cost guardrails: token/request budget by capability with request cancellation thresholds.

## 6) Evaluation plan

### Offline evaluation (pre-release gate)

Create curated eval sets per capability:
- SOP Q&A set (coverage and citation correctness)
- Issue triage set (severity/routing correctness)
- Work-order summary set (completeness vs verbosity)
- Manager explanation set (metric grounding)
- Shortage/scheduling set (factual constraint alignment)
- Invoice note drafting set (policy + tone compliance)

### Metrics and thresholds

| Metric | Target (MVP gate) |
|---|---|
| Citation coverage for factual outputs | >= 90% |
| Grounded factual accuracy | >= 85% |
| Unauthorized data leakage rate | 0% |
| Write action approval bypass rate | 0% |
| Hallucinated mutation statement rate | 0% |
| p95 latency (`/ai/query`) | <= 4.0s for cached/simple, <= 8.0s for hybrid retrieval |

### Failure-case test matrix (required)

- Missing/invalid actor scope -> deny.
- Tool adapter timeout -> graceful degraded response + audit.
- Bedrock or KB failure -> retry policy then deterministic fallback/error.
- Citation missing for fact claim -> block or warning based on capability policy.
- Attempted write without approval token -> hard block.
- Stale approval token or mismatched payload hash -> hard block.

## 7) Logging and audit model

### Audit records

Every AI interaction emits `audit.audit_logs` with:
- actor, action, correlationId
- capability, prompt version
- tool calls attempted/executed
- approval decision state
- outcome (`succeeded`, `blocked`, `failed`)

### Domain events (proposed additions)

- `ai.request.started`
- `ai.request.completed`
- `ai.request.blocked`
- `ai.tool_call.executed`
- `ai.tool_call.blocked`
- `ai.approval.requested`
- `ai.approval.granted`
- `ai.approval.rejected`

### Observability hooks

- Traces: `ai.query`, `ai.retrieve`, `ai.prompt`, `ai.validate`, `ai.approval`.
- Metrics: `ai.request.success`, `ai.request.failure`, `ai.request.blocked`, `ai.citation.missing`, `ai.approval.required`.
- Structured logs: include `correlationId`, `requestId`, `capability`, `modelId`, token counts, and latency buckets.

### AI metadata migration plan

Migration: `apps/api/src/migrations/<next_sequence>_ai_layer_bedrock_kb.sql` (additive)

Proposed tables:
- `ai.ai_requests` (request envelope, actor/scope snapshot, capability, model, status, timing)
- `ai.ai_retrieval_hits` (KB/tool retrieval artifacts and confidence)
- `ai.ai_citations` (normalized response citations)
- `ai.ai_tool_calls` (tool name, mode, args hash, status, latency)
- `ai.ai_approval_requests` (proposed action, approver, state, payload hash, expiry)
- `ai.ai_eval_results` (offline/online eval run outputs)

Rollout sequence:
1. Deploy migration with tables and indexes.
2. Write metadata in shadow mode (no behavioral change).
3. Enable guardrail-based blocking decisions.
4. Enable approval workflow endpoints.

## 8) First 5 highest-value AI use cases

Ranked for MVP delivery impact:

1. **SOP retrieval**  
   Highest immediate floor impact for technician speed and consistency; low mutation risk.
2. **Issue triage**  
   Reduces manager bottlenecks by improving first-pass categorization and urgency routing.
3. **Work order summarization**  
   Improves handoff quality and reduces missed context between shifts.
4. **Shortage explanation**  
   Directly supports inventory + planning decision speed with evidence-backed root cause.
5. **Scheduling risk insights**  
   Prevents avoidable delays by surfacing capacity/dependency/shortage risk earlier.

Also in-scope (covered in capability map, lower initial rollout priority):
- Manager dashboard explanations
- Invoice note drafting (draft-only until approval flow is proven stable)

---

## Guardrail and delivery decisions summary

- **No autonomous operational writes in MVP.**
- **All write-like actions are draft + approval gated.**
- **Role/scope checks are mandatory at every retrieval/tool boundary.**
- **Citations are first-class in response contracts and validation.**
- **Audit/event/observability are required for every AI request lifecycle stage.**
