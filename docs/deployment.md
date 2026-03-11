# Deployment Guide

## Prerequisites

### One-time Bootstrap
Run the Terraform bootstrap to create the remote state backend:
```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

This creates:
- S3 bucket: `gg-erp-terraform-state` (Terraform state files)
- DynamoDB table: `gg-erp-terraform-locks` (state file locking)

After bootstrap, uncomment the `backend "s3"` blocks in:
- `infra/terraform/envs/dev/main.tf`
- `infra/terraform/envs/prod/main.tf`

### GitHub Actions Secrets
Set these secrets in GitHub repository settings:

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | ARN of the GitHub Actions OIDC IAM role (from bootstrap) |
| `DATABASE_URL` | PostgreSQL connection URL for migrations |

### GitHub Actions Variables (non-secret)
| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region to deploy to |

## Manual Deployment

### Build and package Lambdas
```bash
npm run build:lambdas    # Bundle with esbuild → dist/lambdas/{name}/index.js
npm run package:lambdas  # Zip bundles → dist/lambdas/{name}.zip
```

### Deploy to dev
```bash
cd infra/terraform/envs/dev
terraform init
terraform plan -var="name_prefix=gg-erp-dev"
terraform apply -var="name_prefix=gg-erp-dev"
```

### Run migrations
```bash
DATABASE_URL="postgresql://..." npm run db:deploy
```

## CI/CD Pipeline

### CI (`.github/workflows/ci.yml`)
Runs on every push and PR:
- Lint, test, typecheck
- Prisma schema integrity check
- Migration integrity check
- Bootstrap scaffold check

### CD (`.github/workflows/cd.yml`)
Runs on push to `main` or manual trigger:
1. All CI gates must pass
2. Build Lambda artifacts
3. Upload zips to S3
4. `terraform plan` + `terraform apply`
5. `npm run db:deploy` (Prisma migrate deploy)
6. Smoke test against live API

## Environment Configuration

| Environment | Branch | Name Prefix | Aurora ACU | Log Retention |
|-------------|--------|-------------|------------|---------------|
| Dev | any | `gg-erp-dev` | 0.5–16 | 14 days |
| Prod | main | `gg-erp-prod` | 0.5–64 | 90 days |

## Rollback

### Lambda rollback
```bash
aws lambda update-function-code \
  --function-name gg-erp-prod-work-orders-create \
  --s3-bucket gg-erp-prod-lambda-artifacts \
  --s3-key lambdas/work-orders-create.zip \
  --architectures arm64
```

### Database rollback
Prisma does not support automatic rollback of applied migrations.
For emergencies: restore Aurora from automated snapshot (available up to 35 days).
