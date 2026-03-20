variable "aws_region" {
  description = "AWS region for production"
  type        = string
  default     = "us-east-2"
}

variable "name_prefix" {
  description = "Prefix applied to production resources"
  type        = string
  default     = "gg-erp-prod"
}

# Lambda zip paths

variable "work_orders_lambda_zip_path" {
  description = "Path to the packaged work-orders Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/work-orders-lambda.zip"
}

variable "customers_lambda_zip_path" {
  description = "Path to the packaged customers Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/customers-lambda.zip"
}

variable "inventory_lambda_zip_path" {
  description = "Path to the packaged inventory Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/inventory-lambda.zip"
}

variable "tickets_lambda_zip_path" {
  description = "Path to the packaged tickets Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/tickets-lambda.zip"
}

variable "attachments_lambda_zip_path" {
  description = "Path to the packaged attachments Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/attachments-lambda.zip"
}

variable "sop_lambda_zip_path" {
  description = "Path to the packaged SOP/OJT Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/sop-lambda.zip"
}

variable "accounting_lambda_zip_path" {
  description = "Path to the packaged accounting Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/accounting-lambda.zip"
}

variable "migration_lambda_zip_path" {
  description = "Path to the packaged migration admin Lambda zip artifact."
  type        = string
  default     = "../../../../apps/api/dist/migration-lambda.zip"
}

# QuickBooks OAuth

variable "qb_client_id" {
  description = "QuickBooks app client ID for OAuth2"
  type        = string
  default     = ""
  sensitive   = true
}

variable "qb_client_secret" {
  description = "QuickBooks app client secret for OAuth2"
  type        = string
  default     = ""
  sensitive   = true
}

variable "qb_redirect_uri" {
  description = "QuickBooks OAuth redirect URI"
  type        = string
  default     = ""
}

# Frontend (Amplify Hosting)

variable "repository_url" {
  description = "GitHub repository URL for Amplify to clone"
  type        = string
  default     = "https://github.com/kylerand/gg-erp"
}

variable "github_access_token" {
  description = "GitHub personal access token for Amplify repo access"
  type        = string
  sensitive   = true
  default     = ""
}
