variable "aws_region" {
  description = "AWS region for ERP resources"
  type        = string
  default     = "us-east-2"
}

variable "name_prefix" {
  description = "Prefix applied to resource names"
  type        = string
  default     = "gg-erp-dev"
}

# Lambda zip paths are relative to infra/terraform/envs/dev/ (where terraform is run from).
# Build artifacts are produced by: npm run build:lambdas && npm run package:lambdas

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

