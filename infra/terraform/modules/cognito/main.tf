data "aws_region" "current" {}

locals {
  user_pool_name  = coalesce(var.user_pool_name, "${var.name_prefix}-user-pool")
  domain_prefix   = lower(replace(coalesce(var.domain_prefix, "${var.name_prefix}-auth"), "/[^a-z0-9-]/", "-"))
  domain          = "${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
  issuer_url      = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
  google_enabled  = var.google_client_id != "" && var.google_client_secret != ""
  identity_providers = local.google_enabled ? ["COGNITO", "Google"] : ["COGNITO"]
}

resource "aws_cognito_user_pool" "this" {
  name = local.user_pool_name

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  dynamic "lambda_config" {
    for_each = var.pre_signup_lambda_arn != "" ? [1] : []
    content {
      pre_sign_up = var.pre_signup_lambda_arn
    }
  }
}

# ─── Google Identity Provider ────────────────────────────────────────────────

resource "aws_cognito_identity_provider" "google" {
  count = local.google_enabled ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "Google"
  provider_type = "Google"

  # Google's built-in social provider accepts only client_id, client_secret,
  # and authorize_scopes. Workspace-domain restriction is enforced two ways:
  #   1. The Google OAuth client itself is marked Internal (Workspace-only).
  #   2. A PreSignUp Lambda trigger rejects any email that isn't in the
  #      allowed domain before Cognito persists the user.
  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email    = "email"
    username = "sub"
    name     = "name"
  }
}

# ─── App clients ─────────────────────────────────────────────────────────────

resource "aws_cognito_user_pool_client" "this" {
  for_each = var.app_client_names

  name         = "${var.name_prefix}-${each.value}-client"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  prevent_user_existence_errors = "ENABLED"
  supported_identity_providers  = local.identity_providers

  callback_urls = var.oauth_callback_urls
  logout_urls   = var.oauth_logout_urls

  allowed_oauth_flows_user_pool_client = length(var.oauth_callback_urls) > 0
  allowed_oauth_flows                  = length(var.oauth_callback_urls) > 0 ? ["code"] : []
  allowed_oauth_scopes                 = length(var.oauth_callback_urls) > 0 ? ["email", "openid", "profile"] : []

  # Make sure the IdP exists before any client references it.
  depends_on = [aws_cognito_identity_provider.google]
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = local.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

# ─── User Pool Groups (one per APP_ROLE) ─────────────────────────────────────

locals {
  cognito_groups = {
    admin              = "Full platform access and user management"
    shop_manager       = "Broad operational access, dispatch, reporting"
    technician         = "Work order execution and training"
    parts_manager      = "Inventory and parts order management"
    sales              = "Customer and sales quote management"
    accounting         = "Accounting sync and reconciliation"
    trainer_ojt_lead   = "Training assignments and SOP management"
    read_only_executive = "Read-only cross-domain visibility"
  }
}

resource "aws_cognito_user_group" "roles" {
  for_each = local.cognito_groups

  name         = each.key
  description  = each.value
  user_pool_id = aws_cognito_user_pool.this.id
}
