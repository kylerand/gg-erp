# Prisma Lambda Deployment Guide

## Problem
Prisma requires a native query engine binary that must match the Lambda execution environment.

## Lambda Environment
- Runtime: nodejs20.x
- Architecture: arm64 (graviton2)
- Required Prisma engine: `rhel-openssl-3.0.x` (Lambda Amazon Linux 2023 arm64)

## Configuration

### 1. Update `packages/db/prisma/schema.prisma`
Add a `binaryTargets` entry to the `generator client` block:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```

### 2. Lambda environment variable
Set in Terraform Lambda resource (`infra/terraform/modules/api-gateway-lambda/main.tf`):
```hcl
environment {
  variables = {
    PRISMA_QUERY_ENGINE_LIBRARY = "/var/task/libquery_engine-rhel-openssl-3.0.x.so.node"
  }
}
```

### 3. esbuild configuration
The Prisma client auto-generates code referencing the query engine by path.
When bundling with esbuild, the `.node` binary file must be copied alongside `index.js`:
```typescript
// In scripts/build-lambdas.ts, after build completes:
const { copyFileSync, readdirSync } = require('fs');
// Copy .node engine file from node_modules/.prisma/client/
```

### 4. During local development
Use `native` target (selected automatically). The `rhel-openssl-3.0.x` binary is only
needed in the Lambda bundle and is ignored during local `tsx` execution.

## CI Considerations
`npm run db:schema:check` runs `prisma generate` which will attempt to download both
binary targets if not present. Set `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` in CI
to skip the second target download during check-only workflows.
