# Risks and Tradeoffs

| Risk / Tradeoff | Why it matters | Mitigation |
|---|---|---|
| Eventual consistency between contexts | Dashboard views may lag writes | Explicit freshness indicators + replayable projections |
| QuickBooks API variability | External failures can stall accounting workflows | Outbox pattern + retry policy + reconciliation job |
| Planner complexity growth | Optimization can become opaque and hard to debug | Deterministic scoring + run snapshots + explainability output |
| Bedrock cost and prompt risk | AI usage can drift in cost/quality | Per-feature budgets, tool allow-list, prompt/version governance |
| Migration data quality from ShopMonkey | Legacy data can violate new constraints | Staging schema, validation reports, reject queue |
| Too many abstractions too early | Slows MVP delivery | Start modular, add abstractions only where repeated pain appears |
| Serverless cold starts | Latency spikes in low-traffic paths | Cache warmers for critical paths only |
| Schema evolution pressure | Multiple teams can conflict on DB changes | Context-owned schemas + migration review gate |
| Dev/prod only environment strategy | Less pre-prod safety than staging | Strong contract tests + canary release + feature flags |
| Single-tenant assumptions | Future expansion may need tenancy model | Add tenant_id-compatible contracts early without enabling multi-tenant now |

## Principal tradeoff summary

MVP prioritizes delivery speed and cost-efficiency while preserving strong extension points (events, workflow contracts, context-owned schemas). This intentionally accepts some eventual consistency and operational maturity tradeoffs that are planned for phase 2 hardening.
