# System Context Diagram (Text)

## Context

Golfin Garage needs one ERP platform that unifies employee operations, inventory, tickets, OJT/SOP workflows, accounting integration, AI copilots, and migration from ShopMonkey.

## Diagram

```text
[Employees/Managers/Admins]
        |
        v
  [Employee Web App (React/TypeScript)]
        |
        v
  [Cognito User Pool + JWT]
        |
        v
  [API Gateway]
        |
        v
  [Lambda API Context Handlers] -------------------------------+
    |          |            |          |          |            |
    |          |            |          |          |            |
    v          v            v          v          v            v
[Inventory] [Tickets] [SOP/OJT] [Build Planner] [Accounting] [AI Orchestrator]
    |          |            |          |          |            |
    +----------+------------+----------+----------+------------+
                            |
                            v
                 [Aurora PostgreSQL Serverless v2]
                            |
            +---------------+---------------+
            |                               |
            v                               v
         [S3 Files]                  [EventBridge Bus]
                                                |
                       +------------------------+----------------------+
                       |                                               |
                       v                                               v
              [Step Functions Workflows]                   [Async Subscribers]
                       |                                               |
                       v                                               v
            [Build Slot Optimization]                    [QuickBooks Sync Lambda]
                       |                                               |
                       v                                               v
                  [Bedrock AI]                                  [QuickBooks API]

[ShopMonkey Export Files/API] --> [Migration Lambda/StepFn] --> [Aurora + EventBridge]
```

## Trust boundaries

1. **User edge**: Employee browser to Cognito/API Gateway (public internet).
2. **Application boundary**: API Gateway to Lambda private execution.
3. **Data boundary**: Aurora and S3 inside VPC and IAM-constrained roles.
4. **External integration boundary**: QuickBooks and ShopMonkey migration connectors.

## Why this shape

- API Gateway + Lambda keeps early-stage cost low while supporting horizontal growth.
- EventBridge decouples contexts to avoid tight coupling and replatform pressure.
- Step Functions gives deterministic long-running orchestration (migration, planning, sync).
- Aurora Serverless v2 supports relational integrity and migration-heavy ERP workloads.
- Bedrock integration is isolated behind AI orchestration boundaries to control cost and risk.
