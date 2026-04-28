terraform {
  required_version = ">= 1.4.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Run bootstrap first: cd infra/terraform/bootstrap && terraform apply
  # Then: terraform init -migrate-state
  backend "s3" {
    bucket         = "gg-erp-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "gg-erp-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

module "vpc" {
  source             = "../../modules/vpc"
  name_prefix        = var.name_prefix
  single_nat_gateway = false
}

module "aurora_postgres" {
  source              = "../../modules/aurora-postgres"
  name_prefix         = var.name_prefix
  subnet_ids          = module.vpc.private_subnet_ids
  security_group_id   = module.vpc.aurora_security_group_id
  min_acu             = 0.5
  max_acu             = 64
  deletion_protection = true
}

module "s3" {
  source      = "../../modules/s3"
  name_prefix = var.name_prefix
}

module "cognito_triggers" {
  source               = "../../modules/cognito-triggers"
  name_prefix          = var.name_prefix
  lambda_zip_path      = var.auth_lambda_zip_path
  allowed_email_domain = "golfingarage.com"
  sentry_dsn           = var.sentry_dsn
}

module "cognito" {
  source      = "../../modules/cognito"
  name_prefix = var.name_prefix

  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
  google_hosted_domain = "golfingarage.com"
  oauth_callback_urls = [
    "https://golfingarage.m4nos.com/auth/callback",
    "https://floor.golfingarage.m4nos.com/auth/callback",
  ]
  oauth_logout_urls = [
    "https://golfingarage.m4nos.com/auth",
    "https://floor.golfingarage.m4nos.com/auth",
  ]
  pre_signup_lambda_arn = module.cognito_triggers.pre_signup_lambda_arn
}

resource "aws_lambda_permission" "cognito_invoke_pre_signup" {
  statement_id  = "AllowCognitoInvokePreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = module.cognito_triggers.pre_signup_lambda_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = module.cognito.user_pool_arn
}

module "eventbridge" {
  source                           = "../../modules/eventbridge"
  name_prefix                      = var.name_prefix
  archive_retention_days           = 365
  outbox_publisher_lambda_arn      = module.api_gateway_lambda.workers_outbox_publisher_lambda_arn
  enable_outbox_publisher_schedule = true
}

module "step_functions" {
  source      = "../../modules/step-functions"
  name_prefix = var.name_prefix
}

module "observability" {
  source                 = "../../modules/observability"
  name_prefix            = var.name_prefix
  log_retention_days     = 90
  monitored_lambda_names = module.api_gateway_lambda.all_lambda_function_names
}

module "secrets" {
  source               = "../../modules/secrets"
  name_prefix          = var.name_prefix
  db_secret_arn        = module.aurora_postgres.master_secret_arn
  event_bus_name       = module.eventbridge.event_bus_name
  document_bucket_name = module.s3.document_bucket_name
}

module "api_gateway_lambda" {
  source                          = "../../modules/api-gateway-lambda"
  name_prefix                     = var.name_prefix
  work_orders_lambda_zip_path     = var.work_orders_lambda_zip_path
  customers_lambda_zip_path       = var.customers_lambda_zip_path
  inventory_lambda_zip_path       = var.inventory_lambda_zip_path
  tickets_lambda_zip_path         = var.tickets_lambda_zip_path
  attachments_lambda_zip_path     = var.attachments_lambda_zip_path
  sop_lambda_zip_path             = var.sop_lambda_zip_path
  accounting_lambda_zip_path      = var.accounting_lambda_zip_path
  migration_lambda_zip_path       = var.migration_lambda_zip_path
  identity_lambda_zip_path        = var.identity_lambda_zip_path
  communication_lambda_zip_path   = var.communication_lambda_zip_path
  audit_lambda_zip_path           = var.audit_lambda_zip_path
  sales_lambda_zip_path           = var.sales_lambda_zip_path
  copilot_lambda_zip_path         = var.copilot_lambda_zip_path
  scheduling_lambda_zip_path      = var.scheduling_lambda_zip_path
  workspace_lambda_zip_path       = var.workspace_lambda_zip_path
  workers_lambda_zip_path         = var.workers_lambda_zip_path
  sentry_dsn                      = var.sentry_dsn
  cognito_user_pool_endpoint      = module.cognito.issuer_url
  cognito_user_pool_id            = module.cognito.user_pool_id
  cognito_user_pool_arn           = module.cognito.user_pool_arn
  cognito_audience                = [module.cognito.app_client_ids["web"]]
  database_url                    = module.aurora_postgres.database_url
  document_bucket_name            = module.s3.document_bucket_name
  migration_artifacts_bucket_name = module.s3.migration_bucket_name
  lambda_artifacts_bucket_name    = module.s3.lambda_artifacts_bucket_name
  qb_client_id                    = var.qb_client_id
  qb_client_secret                = var.qb_client_secret
  qb_redirect_uri                 = var.qb_redirect_uri
  qb_webhook_verifier_token       = var.qb_webhook_verifier_token
  frontend_url                    = module.amplify_hosting.web_url
  private_subnet_ids              = module.vpc.private_subnet_ids
  lambda_security_group_id        = module.vpc.lambda_security_group_id
}

module "amplify_hosting" {
  source                  = "../../modules/amplify-hosting"
  name_prefix             = var.name_prefix
  repository_url          = var.repository_url
  github_access_token     = var.github_access_token
  branch                  = "main"
  api_base_url            = module.api_gateway_lambda.api_base_url
  cognito_user_pool_id    = module.cognito.user_pool_id
  cognito_client_id       = module.cognito.app_client_ids["web"]
  cognito_domain          = module.cognito.domain
  cognito_google_provider = module.cognito.google_identity_provider_name
  web_public_url          = "https://golfingarage.m4nos.com"
  floor_tech_public_url   = "https://floor.golfingarage.m4nos.com"
  aws_region              = var.aws_region
  floor_tech_url          = "https://floor.golfingarage.m4nos.com"
}
