# AWS Services by Module

| Module | Primary AWS Services | Why this is the right choice now |
|---|---|---|
| API edge | API Gateway + Lambda | Low idle cost and fast feature iteration. |
| Identity & access | Cognito + Lambda authorizer checks | Managed auth with role extension in app DB. |
| Core data | Aurora PostgreSQL Serverless v2 | Relational integrity + scale headroom without early overprovisioning. |
| Events | EventBridge | Native routing and decoupling for context boundaries. |
| Workflows | Step Functions + Lambda tasks | Deterministic orchestration for planning/migration/sync. |
| Files | S3 | SOP files, migration payloads, and exports with lifecycle policies. |
| AI | Bedrock (guarded via orchestration Lambda) | Native AWS integration and controlled model access. |
| Observability | CloudWatch Logs/Metrics + X-Ray | Standard telemetry stack with minimal operational burden. |
| Secrets/config | AWS Secrets Manager + SSM Parameter Store | Separation of secrets and runtime configuration. |

## Cost controls for MVP

- Lambda provisioned concurrency disabled by default; enable per hot path only if needed.
- Aurora Serverless v2 minimum ACU tuned to low baseline.
- EventBridge event detail kept minimal and versioned.
- S3 lifecycle to tier historical migration artifacts.

## Scaling path without replatforming

- Increase Lambda concurrency selectively for hotspot contexts.
- Split high-volume event subscribers into dedicated Lambdas.
- Introduce read replicas/materialized read stores for heavy dashboards.
- Keep workflow definitions versioned to evolve planning logic safely.
