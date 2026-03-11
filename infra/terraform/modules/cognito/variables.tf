variable "name_prefix" {
  description = "Prefix applied to Cognito resource names"
  type        = string
}

variable "user_pool_name" {
  description = "Optional override for the Cognito user pool name"
  type        = string
  default     = null
}

variable "domain_prefix" {
  description = "Optional override for Cognito hosted UI domain prefix"
  type        = string
  default     = null
}

variable "app_client_names" {
  description = "App client names to create in the user pool"
  type        = set(string)
  default     = ["api", "web"]

  validation {
    condition     = length(var.app_client_names) > 0
    error_message = "app_client_names must include at least one client name."
  }
}
