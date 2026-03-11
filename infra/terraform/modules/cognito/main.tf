data "aws_region" "current" {}

locals {
  user_pool_name = coalesce(var.user_pool_name, "${var.name_prefix}-user-pool")
  domain_prefix  = lower(regexreplace(coalesce(var.domain_prefix, "${var.name_prefix}-auth"), "[^a-z0-9-]", "-"))
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
