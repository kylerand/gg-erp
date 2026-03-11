variable "aws_region" {
  description = "AWS region used by Terraform modules"
  type        = string
  default     = "us-east-2"
}

variable "default_tags" {
  description = "Default tags applied to all resources"
  type        = map(string)
  default = {
    project = "gg-erp"
    managed = "terraform"
  }
}
