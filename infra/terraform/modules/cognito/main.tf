data "aws_region" "current" {}

locals {
  user_pool_name = coalesce(var.user_pool_name, "${var.name_prefix}-user-pool")
  domain_prefix  = lower(replace(coalesce(var.domain_prefix, "${var.name_prefix}-auth"), "/[^a-z0-9-]/", "-"))
  domain         = "${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
  issuer_url     = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
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
}

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
  supported_identity_providers  = ["COGNITO"]
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
