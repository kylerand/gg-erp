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

# ─── Google SSO ──────────────────────────────────────────────────────────────

variable "google_client_id" {
  description = "Google OAuth 2.0 client ID. When empty, Google IdP is not created."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 client secret"
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_hosted_domain" {
  description = "Google Workspace domain to restrict sign-in to (sent as hd= param). Empty disables the restriction."
  type        = string
  default     = ""
}

variable "oauth_callback_urls" {
  description = "Allowed OAuth callback URLs for the app clients' hosted-UI flow"
  type        = list(string)
  default     = []
}

variable "oauth_logout_urls" {
  description = "Allowed OAuth logout URLs for the app clients' hosted-UI flow"
  type        = list(string)
  default     = []
}

variable "pre_signup_lambda_arn" {
  description = "ARN of Lambda to invoke as PreSignUp trigger. Empty disables the trigger."
  type        = string
  default     = ""
}
