variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

variable "db_secret_arn" {
  type        = string
  description = "ARN of the Aurora master credentials secret (from aurora-postgres module)"
}

variable "cognito_user_pool_id" {
  type        = string
  default     = ""
  description = "Cognito user pool ID"
}

variable "cognito_client_id" {
  type        = string
  default     = ""
  description = "Cognito app client ID"
}

variable "event_bus_name" {
  type        = string
  default     = ""
  description = "EventBridge bus name"
}

variable "document_bucket_name" {
  type        = string
  default     = ""
  description = "S3 documents bucket name"
}

# QuickBooks secret placeholder (populated manually before QB integration)
resource "aws_secretsmanager_secret" "quickbooks" {
  name                    = "/${var.name_prefix}/quickbooks/client-secret"
  description             = "QuickBooks OAuth client secret (placeholder)"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "quickbooks" {
  secret_id = aws_secretsmanager_secret.quickbooks.id
  secret_string = jsonencode({
    client_id     = "PLACEHOLDER"
    client_secret = "PLACEHOLDER"
    realm_id      = "PLACEHOLDER"
  })
}

# SSM Parameters (non-secret runtime config)
resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name  = "/${var.name_prefix}/cognito/user-pool-id"
  type  = "String"
  value = var.cognito_user_pool_id != "" ? var.cognito_user_pool_id : "PLACEHOLDER"
}

resource "aws_ssm_parameter" "cognito_client_id" {
  name  = "/${var.name_prefix}/cognito/client-id"
  type  = "String"
  value = var.cognito_client_id != "" ? var.cognito_client_id : "PLACEHOLDER"
}

resource "aws_ssm_parameter" "event_bus_name" {
  name  = "/${var.name_prefix}/eventbridge/bus-name"
  type  = "String"
  value = var.event_bus_name != "" ? var.event_bus_name : "${var.name_prefix}-erp-events"
}

resource "aws_ssm_parameter" "document_bucket" {
  name  = "/${var.name_prefix}/s3/document-bucket"
  type  = "String"
  value = var.document_bucket_name != "" ? var.document_bucket_name : "${var.name_prefix}-documents"
}

output "quickbooks_secret_arn" {
  value = aws_secretsmanager_secret.quickbooks.arn
}

output "cognito_user_pool_id_param" {
  value = aws_ssm_parameter.cognito_user_pool_id.name
}

output "event_bus_name_param" {
  value = aws_ssm_parameter.event_bus_name.name
}
