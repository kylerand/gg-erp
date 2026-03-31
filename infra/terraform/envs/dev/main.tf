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
    key            = "dev/terraform.tfstate"
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
  single_nat_gateway = true
}

module "aurora_postgres" {
  source              = "../../modules/aurora-postgres"
  name_prefix         = var.name_prefix
  subnet_ids          = module.vpc.private_subnet_ids
  security_group_id   = module.vpc.aurora_security_group_id
  min_acu             = 0.5
  max_acu             = 16
  deletion_protection = false
}

module "s3" {
  source      = "../../modules/s3"
  name_prefix = var.name_prefix
}

module "cognito" {
  source      = "../../modules/cognito"
  name_prefix = var.name_prefix
}

module "eventbridge" {
  source                 = "../../modules/eventbridge"
  name_prefix            = var.name_prefix
  archive_retention_days = 30
}

module "step_functions" {
  source      = "../../modules/step-functions"
  name_prefix = var.name_prefix
}

module "observability" {
  source             = "../../modules/observability"
  name_prefix        = var.name_prefix
  log_retention_days = 14
}

module "secrets" {
  source               = "../../modules/secrets"
  name_prefix          = var.name_prefix
  db_secret_arn        = module.aurora_postgres.master_secret_arn
  event_bus_name       = module.eventbridge.event_bus_name
  document_bucket_name = module.s3.document_bucket_name
}

module "api_gateway_lambda" {
  source                      = "../../modules/api-gateway-lambda"
  name_prefix                 = var.name_prefix
  work_orders_lambda_zip_path = var.work_orders_lambda_zip_path
  customers_lambda_zip_path   = var.customers_lambda_zip_path
  inventory_lambda_zip_path   = var.inventory_lambda_zip_path
  tickets_lambda_zip_path     = var.tickets_lambda_zip_path
  attachments_lambda_zip_path = var.attachments_lambda_zip_path
  sop_lambda_zip_path         = var.sop_lambda_zip_path
  accounting_lambda_zip_path  = var.accounting_lambda_zip_path
  migration_lambda_zip_path   = var.migration_lambda_zip_path
  identity_lambda_zip_path    = var.identity_lambda_zip_path
  cognito_user_pool_endpoint  = module.cognito.issuer_url
  cognito_audience            = [module.cognito.app_client_ids["web"]]
  database_url                = module.aurora_postgres.database_url
  document_bucket_name        = module.s3.document_bucket_name
  qb_client_id                = var.qb_client_id
  qb_client_secret            = var.qb_client_secret
  qb_redirect_uri             = var.qb_redirect_uri
  qb_webhook_verifier_token   = var.qb_webhook_verifier_token
  frontend_url                = length(module.amplify_hosting) > 0 ? module.amplify_hosting[0].web_url : "https://localhost:3000"
  private_subnet_ids          = module.vpc.private_subnet_ids
  lambda_security_group_id    = module.vpc.lambda_security_group_id
}

module "amplify_hosting" {
  count                = var.github_access_token != "" ? 1 : 0
  source               = "../../modules/amplify-hosting"
  name_prefix          = var.name_prefix
  repository_url       = var.repository_url
  github_access_token  = var.github_access_token
  branch               = "main"
  api_base_url         = module.api_gateway_lambda.api_base_url
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.app_client_ids["web"]
  aws_region           = var.aws_region
}
