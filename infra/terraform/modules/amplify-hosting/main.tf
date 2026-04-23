variable "name_prefix" { type = string }

variable "repository_url" {
  description = "GitHub repository URL (HTTPS)"
  type        = string
}

variable "github_access_token" {
  description = "GitHub personal access token for Amplify to access the repo"
  type        = string
  sensitive   = true
  default     = ""
}

variable "branch" {
  description = "Branch to deploy from"
  type        = string
  default     = "main"
}

variable "api_base_url" {
  description = "API Gateway invoke URL injected as NEXT_PUBLIC_API_BASE_URL"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito app client ID for the web app"
  type        = string
}

variable "floor_tech_url" {
  description = "Public URL of the floor-tech Amplify app; injected as NEXT_PUBLIC_FLOOR_TECH_URL into the web app."
  type        = string
  default     = ""
}

variable "cognito_domain" {
  description = "Cognito hosted UI domain (e.g. dev-auth.auth.us-east-2.amazoncognito.com) for OAuth redirect flow."
  type        = string
  default     = ""
}

variable "cognito_google_provider" {
  description = "Cognito IdP name for Google, or empty string if Google SSO is disabled."
  type        = string
  default     = ""
}

variable "web_public_url" {
  description = "Public URL of the web app (used as OAuth redirect sign-in/sign-out)."
  type        = string
  default     = ""
}

variable "floor_tech_public_url" {
  description = "Public URL of the floor-tech app (used as OAuth redirect sign-in/sign-out)."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region for Cognito config"
  type        = string
  default     = "us-east-2"
}

# ──────────────────────────────────────────────────────────────────────────────
# IAM Service Role for Amplify SSR (WEB_COMPUTE)
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "amplify" {
  name = "${var.name_prefix}-amplify-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "amplify.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "amplify_admin" {
  role       = aws_iam_role.amplify.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-Amplify"
}

# ──────────────────────────────────────────────────────────────────────────────
# Web App (Employee Dashboard)
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_amplify_app" "web" {
  name         = "${var.name_prefix}-web"
  repository   = var.repository_url
  iam_service_role_arn = aws_iam_role.amplify.arn

  dynamic "auto_branch_creation_config" {
    for_each = var.github_access_token != "" ? [1] : []
    content {
      enable_auto_build = true
    }
  }

  access_token = var.github_access_token != "" ? var.github_access_token : null

  build_spec = <<-YAML
    version: 1
    applications:
      - appRoot: apps/web
        frontend:
          phases:
            preBuild:
              commands:
                - (cd ../.. && npm ci)
            build:
              commands:
                - npx next build
          artifacts:
            baseDirectory: .next
            files:
              - '**/*'
          cache:
            paths:
              - ../../node_modules/**/*
              - .next/cache/**/*
  YAML

  platform = "WEB_COMPUTE"

  environment_variables = {
    NEXT_PUBLIC_API_BASE_URL         = var.api_base_url
    NEXT_PUBLIC_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    NEXT_PUBLIC_COGNITO_CLIENT_ID    = var.cognito_client_id
    NEXT_PUBLIC_COGNITO_DOMAIN       = var.cognito_domain
    NEXT_PUBLIC_COGNITO_GOOGLE       = var.cognito_google_provider
    NEXT_PUBLIC_AUTH_MODE            = "cognito"
    NEXT_PUBLIC_FLOOR_TECH_URL       = var.floor_tech_url
    NEXT_PUBLIC_APP_URL              = var.web_public_url
    AMPLIFY_MONOREPO_APP_ROOT        = "apps/web"
  }
}

resource "aws_amplify_branch" "web_main" {
  app_id      = aws_amplify_app.web.id
  branch_name = var.branch

  framework = "Next.js - SSR"
  stage     = "PRODUCTION"

  environment_variables = {
    NEXT_PUBLIC_AUTH_MODE = "cognito"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Floor Tech App (Mobile-Responsive Technician Interface)
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_amplify_app" "floor_tech" {
  name         = "${var.name_prefix}-floor-tech"
  repository   = var.repository_url
  iam_service_role_arn = aws_iam_role.amplify.arn

  access_token = var.github_access_token != "" ? var.github_access_token : null

  build_spec = <<-YAML
    version: 1
    applications:
      - appRoot: apps/floor-tech
        frontend:
          phases:
            preBuild:
              commands:
                - (cd ../.. && npm ci)
            build:
              commands:
                - npx next build
          artifacts:
            baseDirectory: .next
            files:
              - '**/*'
          cache:
            paths:
              - ../../node_modules/**/*
              - .next/cache/**/*
  YAML

  platform = "WEB_COMPUTE"

  environment_variables = {
    NEXT_PUBLIC_API_BASE_URL         = var.api_base_url
    NEXT_PUBLIC_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    NEXT_PUBLIC_COGNITO_CLIENT_ID    = var.cognito_client_id
    NEXT_PUBLIC_COGNITO_DOMAIN       = var.cognito_domain
    NEXT_PUBLIC_COGNITO_GOOGLE       = var.cognito_google_provider
    NEXT_PUBLIC_AUTH_MODE            = "cognito"
    NEXT_PUBLIC_APP_URL              = var.floor_tech_public_url
    AMPLIFY_MONOREPO_APP_ROOT        = "apps/floor-tech"
  }
}

resource "aws_amplify_branch" "floor_tech_main" {
  app_id      = aws_amplify_app.floor_tech.id
  branch_name = var.branch

  framework = "Next.js - SSR"
  stage     = "PRODUCTION"
}

# ──────────────────────────────────────────────────────────────────────────────
# Outputs
# ──────────────────────────────────────────────────────────────────────────────

output "web_app_id" {
  value = aws_amplify_app.web.id
}

output "web_default_domain" {
  description = "Default Amplify domain for the web app"
  value       = aws_amplify_app.web.default_domain
}

output "web_url" {
  description = "Production URL for the web app"
  value       = "https://${var.branch}.${aws_amplify_app.web.default_domain}"
}

output "floor_tech_app_id" {
  value = aws_amplify_app.floor_tech.id
}

output "floor_tech_default_domain" {
  description = "Default Amplify domain for the floor tech app"
  value       = aws_amplify_app.floor_tech.default_domain
}

output "floor_tech_url" {
  description = "Production URL for the floor tech app"
  value       = "https://${var.branch}.${aws_amplify_app.floor_tech.default_domain}"
}
