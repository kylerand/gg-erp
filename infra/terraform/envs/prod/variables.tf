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

variable "work_orders_lambda_zip_path" {
  description = "Path to the packaged work-orders Lambda zip artifact."
  type        = string
  default     = "apps/api/dist/work-orders-lambda.zip"
}
