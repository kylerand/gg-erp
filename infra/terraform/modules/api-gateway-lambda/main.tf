variable "name_prefix" { type = string }

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for Lambda VPC configuration"
}

variable "lambda_security_group_id" {
  type        = string
  description = "Security group ID for Lambda functions in VPC"
}

variable "work_orders_lambda_zip_path" {
  description = "Path to the zipped work-orders Lambda artifact."
  type        = string
  default     = "apps/api/dist/work-orders-lambda.zip"
}

variable "customers_lambda_zip_path" {
  description = "Path to the zipped customers Lambda artifact."
  type        = string
  default     = "apps/api/dist/customers-lambda.zip"
}

variable "inventory_lambda_zip_path" {
  description = "Path to the zipped inventory Lambda artifact."
  type        = string
  default     = "apps/api/dist/inventory-lambda.zip"
}

variable "tickets_lambda_zip_path" {
  description = "Path to the zipped tickets Lambda artifact."
  type        = string
  default     = "apps/api/dist/tickets-lambda.zip"
}

variable "attachments_lambda_zip_path" {
  description = "Path to the zipped attachments Lambda artifact."
  type        = string
  default     = "apps/api/dist/attachments-lambda.zip"
}

variable "sop_lambda_zip_path" {
  description = "Path to the zipped SOP/OJT Lambda artifact."
  type        = string
  default     = "apps/api/dist/sop-lambda.zip"
}

variable "accounting_lambda_zip_path" {
  description = "Path to the zipped accounting (QB OAuth + sync) Lambda artifact."
  type        = string
  default     = "apps/api/dist/accounting-lambda.zip"
}

variable "migration_lambda_zip_path" {
  description = "Path to the zipped migration admin Lambda artifact."
  type        = string
  default     = "apps/api/dist/migration-lambda.zip"
}

variable "identity_lambda_zip_path" {
  description = "Path to the zipped identity Lambda artifact."
  type        = string
  default     = "apps/api/dist/identity-lambda.zip"
}

variable "communication_lambda_zip_path" {
  description = "Path to the zipped communication Lambda artifact."
  type        = string
  default     = "apps/api/dist/communication-lambda.zip"
}

variable "audit_lambda_zip_path" {
  description = "Path to the zipped audit Lambda artifact."
  type        = string
  default     = "apps/api/dist/audit-lambda.zip"
}

variable "copilot_lambda_zip_path" {
  description = "Path to the zipped copilot Lambda artifact."
  type        = string
  default     = "apps/api/dist/copilot-lambda.zip"
}

variable "sales_lambda_zip_path" {
  description = "Path to the zipped sales Lambda artifact."
  type        = string
  default     = "apps/api/dist/sales-lambda.zip"
}

variable "scheduling_lambda_zip_path" {
  description = "Path to the zipped scheduling Lambda artifact."
  type        = string
  default     = "apps/api/dist/scheduling-lambda.zip"
}

variable "workspace_lambda_zip_path" {
  description = "Path to the zipped workspace Lambda artifact."
  type        = string
  default     = "apps/api/dist/workspace-lambda.zip"
}

variable "lambda_artifacts_bucket_name" {
  description = <<-EOT
    S3 bucket holding the per-context Lambda zips (e.g. `lambdas/inventory-lambda.zip`).
    When set, Lambda functions read their code from S3 instead of uploading through the
    Lambda API. Faster, no 50MB direct-upload limit, cleaner rollback (just flip s3_key),
    and reduces the partial-apply drift surface since S3 upload is decoupled from
    `UpdateFunctionCode`. Leave empty to fall back to `filename = *_lambda_zip_path`.
  EOT
  type        = string
  default     = ""
}

variable "workers_lambda_zip_path" {
  description = "Path to the zipped workers Lambda artifact (outbox-publisher, payment-sync, reconciliation)."
  type        = string
  default     = "apps/api/dist/workers-lambda.zip"
}

variable "sentry_dsn" {
  description = "Sentry DSN injected into every Lambda. Leave empty to disable Sentry (handler wrapper becomes a no-op)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "qb_client_id" {
  description = "QuickBooks app client ID for OAuth2"
  type        = string
  default     = ""
  sensitive   = true
}

variable "qb_client_secret" {
  description = "QuickBooks app client secret for OAuth2"
  type        = string
  default     = ""
  sensitive   = true
}

variable "qb_redirect_uri" {
  description = "QuickBooks OAuth redirect URI (must match QB app settings)"
  type        = string
  default     = ""
}

variable "frontend_url" {
  description = "Frontend URL for OAuth redirect after QB connection"
  type        = string
  default     = ""
}

variable "cognito_user_pool_endpoint" {
  description = "Cognito issuer URL for JWT authorizer (e.g. https://cognito-idp.{region}.amazonaws.com/{userPoolId})"
  type        = string
  default     = ""
}

variable "cognito_user_pool_id" {
  description = "Cognito user pool ID for admin operations"
  type        = string
  default     = ""
}

variable "cognito_user_pool_arn" {
  description = "Cognito user pool ARN for IAM policies"
  type        = string
  default     = ""
}

variable "cognito_audience" {
  description = "Cognito app client ID(s) to validate in the JWT audience claim"
  type        = list(string)
  default     = []
}

variable "database_url" {
  description = "PostgreSQL connection URL injected into all Lambda functions as DATABASE_URL"
  type        = string
  sensitive   = true
  default     = ""
}

variable "document_bucket_name" {
  description = "S3 document bucket name injected into attachment Lambda functions"
  type        = string
  default     = ""
}

variable "migration_artifacts_bucket_name" {
  description = "S3 bucket for Shopmonkey migration export artifacts"
  type        = string
  default     = ""
}

variable "qb_webhook_verifier_token" {
  description = "QuickBooks webhook verifier token for HMAC signature validation"
  type        = string
  default     = ""
  sensitive   = true
}

resource "aws_iam_role" "work_orders_lambda" {
  name = "${var.name_prefix}-work-orders-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "work_orders_lambda_basic_execution" {
  role       = aws_iam_role.work_orders_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "work_orders_lambda_vpc" {
  role       = aws_iam_role.work_orders_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "work_orders_create" {
  function_name    = "${var.name_prefix}-work-orders-create"
  role             = aws_iam_role.work_orders_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/work-orders-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.work_orders_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.work_orders_lambda_zip_path)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      NODE_ENV                    = "production"
      PRISMA_QUERY_ENGINE_LIBRARY = "/var/task/libquery_engine-rhel-openssl-3.0.x.so.node"
      DATABASE_URL                = var.database_url
      DB_DATABASE_URL             = var.database_url
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "work_orders_list" {
  function_name    = "${var.name_prefix}-work-orders-list"
  role             = aws_iam_role.work_orders_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/work-orders-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.work_orders_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.work_orders_lambda_zip_path)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      NODE_ENV                    = "production"
      PRISMA_QUERY_ENGINE_LIBRARY = "/var/task/libquery_engine-rhel-openssl-3.0.x.so.node"
      DATABASE_URL                = var.database_url
      DB_DATABASE_URL             = var.database_url
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "work_orders_transition" {
  function_name    = "${var.name_prefix}-work-orders-transition"
  role             = aws_iam_role.work_orders_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "transition.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/work-orders-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.work_orders_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.work_orders_lambda_zip_path)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      NODE_ENV                    = "production"
      PRISMA_QUERY_ENGINE_LIBRARY = "/var/task/libquery_engine-rhel-openssl-3.0.x.so.node"
      DATABASE_URL                = var.database_url
      DB_DATABASE_URL             = var.database_url
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "work_orders_get" {
  function_name    = "${var.name_prefix}-work-orders-get"
  role             = aws_iam_role.work_orders_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/work-orders-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.work_orders_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.work_orders_lambda_zip_path)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      NODE_ENV                    = "production"
      PRISMA_QUERY_ENGINE_LIBRARY = "/var/task/libquery_engine-rhel-openssl-3.0.x.so.node"
      DATABASE_URL                = var.database_url
      DB_DATABASE_URL             = var.database_url
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_api" "erp" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "authorization", "x-correlation-id", "x-actor-id", "idempotency-key"]
    max_age       = 86400
  }
}

resource "aws_apigatewayv2_integration" "work_orders_create" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.work_orders_create.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "work_orders_list" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.work_orders_list.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "work_orders_create" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "POST /planning/work-orders"
  target    = "integrations/${aws_apigatewayv2_integration.work_orders_create.id}"
}

resource "aws_apigatewayv2_route" "work_orders_list" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /planning/work-orders"
  target    = "integrations/${aws_apigatewayv2_integration.work_orders_list.id}"
}

resource "aws_apigatewayv2_integration" "work_orders_transition" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.work_orders_transition.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "work_orders_transition" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "PATCH /planning/work-orders/{id}/state"
  target    = "integrations/${aws_apigatewayv2_integration.work_orders_transition.id}"
}

resource "aws_apigatewayv2_integration" "work_orders_get" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.work_orders_get.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "work_orders_get" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /work-orders/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.work_orders_get.id}"
}

resource "aws_lambda_permission" "allow_api_gateway_get_wo" {
  statement_id  = "AllowExecutionFromApiGatewayGetWO"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.work_orders_get.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*/work-orders/*"
}

resource "aws_lambda_permission" "allow_api_gateway_transition_wo" {
  statement_id  = "AllowExecutionFromApiGatewayTransitionWO"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.work_orders_transition.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*/planning/work-orders/*/state"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.erp.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    # Soft caps to prevent runaway costs or accidental DDoS. Tune up after the
    # migration cutover if real traffic exceeds these.
    throttling_burst_limit   = 1000
    throttling_rate_limit    = 500
    detailed_metrics_enabled = true
  }
}

# ─── Cognito JWT Authorizer ────────────────────────────────────────────────────

resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  count            = var.cognito_user_pool_endpoint != "" ? 1 : 0
  api_id           = aws_apigatewayv2_api.erp.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.name_prefix}-cognito-jwt-authorizer"

  jwt_configuration {
    audience = var.cognito_audience
    issuer   = var.cognito_user_pool_endpoint
  }
}

locals {
  authorizer_id = var.cognito_user_pool_endpoint != "" ? aws_apigatewayv2_authorizer.cognito_jwt[0].id : null
}

# ─── Shared Lambda IAM Role (customers / inventory / tickets) ─────────────────

resource "aws_iam_role" "erp_lambda" {
  name = "${var.name_prefix}-erp-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "erp_lambda_basic" {
  role       = aws_iam_role.erp_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "erp_lambda_vpc" {
  role       = aws_iam_role.erp_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ─── Shared Lambda configuration ───────────────────────────────────────────────

locals {
  lambda_common_env = {
    NODE_ENV                    = "production"
    PRISMA_QUERY_ENGINE_LIBRARY = "/var/task/libquery_engine-rhel-openssl-3.0.x.so.node"
    DATABASE_URL                = var.database_url
    DB_DATABASE_URL             = var.database_url
    SENTRY_DSN                  = var.sentry_dsn
  }
  lambda_accounting_env = merge(local.lambda_common_env, {
    QB_CLIENT_ID              = var.qb_client_id
    QB_CLIENT_SECRET          = var.qb_client_secret
    QB_REDIRECT_URI           = var.qb_redirect_uri
    QB_WEBHOOK_VERIFIER_TOKEN = var.qb_webhook_verifier_token
    FRONTEND_URL              = var.frontend_url
  })
  lambda_admin_env = merge(local.lambda_common_env, {
    COGNITO_USER_POOL_ID = var.cognito_user_pool_id
  })
}

# ─── Workspace Lambda Functions ───────────────────────────────────────────────

resource "aws_lambda_function" "workspace_today" {
  function_name    = "${var.name_prefix}-workspace-today"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "today.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/workspace-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.workspace_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.workspace_lambda_zip_path)
  timeout          = 15
  memory_size      = 256

  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "workspace_today" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.workspace_today.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "workspace_today" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /workspace/today"
  target             = "integrations/${aws_apigatewayv2_integration.workspace_today.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

# ─── Identity Lambda Functions ─────────────────────────────────────────────────

resource "aws_lambda_function" "identity_me" {
  function_name    = "${var.name_prefix}-identity-me"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "me.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "identity_list_dealers" {
  function_name    = "${var.name_prefix}-identity-list-dealers"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-dealers.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "identity_list_employees" {
  function_name    = "${var.name_prefix}-identity-list-employees"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-employees.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Customers Lambda Functions ─────────────────────────────────────────────────

resource "aws_lambda_function" "customers_list" {
  function_name    = "${var.name_prefix}-customers-list"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/customers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.customers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.customers_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "customers_create" {
  function_name    = "${var.name_prefix}-customers-create"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/customers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.customers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.customers_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "customers_get" {
  function_name    = "${var.name_prefix}-customers-get"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/customers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.customers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.customers_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "customers_transition" {
  function_name    = "${var.name_prefix}-customers-transition"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "transition.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/customers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.customers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.customers_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Inventory Lambda Functions ───────────────────────────────────────────────

resource "aws_lambda_function" "inventory_list_parts" {
  function_name    = "${var.name_prefix}-inventory-list-parts"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-parts.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_create_part" {
  function_name    = "${var.name_prefix}-inventory-create-part"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-part.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_get_part" {
  function_name    = "${var.name_prefix}-inventory-get-part"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-part.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_vendors" {
  function_name    = "${var.name_prefix}-inventory-list-vendors"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-vendors.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_purchase_orders" {
  function_name    = "${var.name_prefix}-inventory-list-purchase-orders"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-purchase-orders.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_lots" {
  function_name    = "${var.name_prefix}-inventory-list-lots"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-lots.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_reservations" {
  function_name    = "${var.name_prefix}-inventory-list-reservations"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-reservations.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_create_reservation" {
  function_name    = "${var.name_prefix}-inventory-create-reservation"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-reservation.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_release_reservation" {
  function_name    = "${var.name_prefix}-inventory-release-reservation"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "release-reservation.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_consume_reservation" {
  function_name    = "${var.name_prefix}-inventory-consume-reservation"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "consume-reservation.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_get_part_chain" {
  function_name    = "${var.name_prefix}-inventory-get-part-chain"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-part-chain.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_plan_material_by_stage" {
  function_name    = "${var.name_prefix}-inventory-plan-material-by-stage"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "plan-material-by-stage.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_manufacturers" {
  function_name    = "${var.name_prefix}-inventory-list-manufacturers"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-manufacturers.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_create_manufacturer" {
  function_name    = "${var.name_prefix}-inventory-create-manufacturer"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-manufacturer.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/inventory-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.inventory_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.inventory_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Tickets Lambda Functions ─────────────────────────────────────────────────

resource "aws_lambda_function" "tickets_list_tasks" {
  function_name    = "${var.name_prefix}-tickets-list-tasks"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-tasks.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_create_task" {
  function_name    = "${var.name_prefix}-tickets-create-task"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-task.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_transition_task" {
  function_name    = "${var.name_prefix}-tickets-transition-task"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "transition-task.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_get_qc_gates" {
  function_name    = "${var.name_prefix}-tickets-get-qc-gates"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-qc-gates.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_batch_submit_qc_gates" {
  function_name    = "${var.name_prefix}-tickets-batch-submit-qc-gates"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "batch-submit-qc-gates.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_time_entries" {
  function_name    = "${var.name_prefix}-tickets-list-time-entries"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-time-entries.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_create_time_entry" {
  function_name    = "${var.name_prefix}-tickets-create-time-entry"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-time-entry.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_update_time_entry" {
  function_name    = "${var.name_prefix}-tickets-update-time-entry"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "update-time-entry.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_delete_time_entry" {
  function_name    = "${var.name_prefix}-tickets-delete-time-entry"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "delete-time-entry.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_all_time_entries" {
  function_name    = "${var.name_prefix}-tickets-list-all-time-entries"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-all-time-entries.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_routing_steps" {
  function_name    = "${var.name_prefix}-tickets-list-routing-steps"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-routing-steps.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_transition_routing_step" {
  function_name    = "${var.name_prefix}-tickets-transition-routing-step"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "transition-routing-step.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_rework" {
  function_name    = "${var.name_prefix}-tickets-list-rework"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-rework.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_create_rework" {
  function_name    = "${var.name_prefix}-tickets-create-rework"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-rework.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_sync" {
  function_name    = "${var.name_prefix}-tickets-list-sync"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-sync.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_all_work_orders" {
  function_name    = "${var.name_prefix}-tickets-list-all-work-orders"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-all-work-orders.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_technician_tasks" {
  function_name    = "${var.name_prefix}-tickets-list-technician-tasks"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-technician-tasks.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_transition_technician_task" {
  function_name    = "${var.name_prefix}-tickets-transition-technician-task"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "transition-technician-task.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/tickets-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.tickets_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.tickets_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Scheduling Lambda Functions ──────────────────────────────────────────────

resource "aws_lambda_function" "scheduling_list_slots" {
  function_name    = "${var.name_prefix}-scheduling-list-slots"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-slots.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/scheduling-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.scheduling_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.scheduling_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "scheduling_list_labor_capacity" {
  function_name    = "${var.name_prefix}-scheduling-list-labor-capacity"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-labor-capacity.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/scheduling-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.scheduling_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.scheduling_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── API GW Integrations + Routes — Identity ──────────────────────────────────

resource "aws_apigatewayv2_integration" "identity_me" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.identity_me.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "identity_me" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /auth/me"
  target             = "integrations/${aws_apigatewayv2_integration.identity_me.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "identity_list_dealers" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.identity_list_dealers.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "identity_list_dealers" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /identity/dealers"
  target             = "integrations/${aws_apigatewayv2_integration.identity_list_dealers.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "identity_list_employees" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.identity_list_employees.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "identity_list_employees" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /hr/employees"
  target             = "integrations/${aws_apigatewayv2_integration.identity_list_employees.id}"
  authorization_type = "NONE"
}

# ─── Admin User Management Lambda Functions ────────────────────────────────────

resource "aws_lambda_function" "admin_list_users" {
  function_name    = "${var.name_prefix}-admin-list-users"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "admin-list-users.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_admin_env }
}

resource "aws_lambda_function" "admin_create_user" {
  function_name    = "${var.name_prefix}-admin-create-user"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "admin-create-user.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_admin_env }
}

resource "aws_lambda_function" "admin_update_user" {
  function_name    = "${var.name_prefix}-admin-update-user"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "admin-update-user.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_admin_env }
}

resource "aws_lambda_function" "admin_delete_user" {
  function_name    = "${var.name_prefix}-admin-delete-user"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "admin-delete-user.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/identity-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.identity_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.identity_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_admin_env }
}

# ─── API GW — Admin User Management Permissions ───────────────────────────────

resource "aws_lambda_permission" "admin_list_users" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_list_users.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_permission" "admin_create_user" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_create_user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_permission" "admin_update_user" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_update_user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_permission" "admin_delete_user" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_delete_user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

# ─── API GW Integrations + Routes — Admin User Management ─────────────────────

resource "aws_apigatewayv2_integration" "admin_list_users" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.admin_list_users.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "admin_list_users" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /admin/users"
  target             = "integrations/${aws_apigatewayv2_integration.admin_list_users.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "admin_create_user" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.admin_create_user.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "admin_create_user" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /admin/users"
  target             = "integrations/${aws_apigatewayv2_integration.admin_create_user.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "admin_update_user" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.admin_update_user.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "admin_update_user" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /admin/users/{username}"
  target             = "integrations/${aws_apigatewayv2_integration.admin_update_user.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "admin_delete_user" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.admin_delete_user.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "admin_delete_user" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "DELETE /admin/users/{username}"
  target             = "integrations/${aws_apigatewayv2_integration.admin_delete_user.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── API GW Integrations + Routes — Customers ─────────────────────────────────

resource "aws_apigatewayv2_integration" "customers_list" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.customers_list.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_list" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /identity/customers"
  target             = "integrations/${aws_apigatewayv2_integration.customers_list.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "customers_create" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.customers_create.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_create" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /identity/customers"
  target             = "integrations/${aws_apigatewayv2_integration.customers_create.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "customers_get" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.customers_get.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_get" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /identity/customers/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.customers_get.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "customers_transition" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.customers_transition.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_transition" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /identity/customers/{id}/state"
  target             = "integrations/${aws_apigatewayv2_integration.customers_transition.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── API GW Integrations + Routes — Inventory ─────────────────────────────────

resource "aws_apigatewayv2_integration" "inventory_list_parts" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_list_parts.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_parts" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/parts"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_list_parts.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_create_part" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_create_part.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_create_part" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /inventory/parts"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_create_part.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_get_part" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_get_part.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_get_part" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/parts/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_get_part.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_vendors" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_list_vendors.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_vendors" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/vendors"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_list_vendors.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_purchase_orders" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_list_purchase_orders.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_purchase_orders" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/purchase-orders"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_list_purchase_orders.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_lots" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_list_lots.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_lots" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/lots"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_list_lots.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_reservations" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_list_reservations.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_reservations" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/reservations"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_list_reservations.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_create_reservation" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_create_reservation.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_create_reservation" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /inventory/reservations"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_create_reservation.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_release_reservation" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_release_reservation.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_release_reservation" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /inventory/reservations/{id}/release"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_release_reservation.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_consume_reservation" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_consume_reservation.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_consume_reservation" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /inventory/reservations/{id}/consume"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_consume_reservation.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_get_part_chain" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_get_part_chain.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_get_part_chain" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/parts/{id}/chain"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_get_part_chain.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_plan_material_by_stage" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_plan_material_by_stage.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_plan_material_by_stage" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/planning/material-by-stage"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_plan_material_by_stage.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_manufacturers" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_list_manufacturers.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_manufacturers" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /inventory/manufacturers"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_list_manufacturers.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_create_manufacturer" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.inventory_create_manufacturer.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_create_manufacturer" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /inventory/manufacturers"
  target             = "integrations/${aws_apigatewayv2_integration.inventory_create_manufacturer.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── API GW Integrations + Routes — Tickets ───────────────────────────────────

resource "aws_apigatewayv2_integration" "tickets_list_tasks" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_tasks.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_tasks" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/tasks"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_tasks.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_create_task" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_create_task.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_create_task" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /tickets/tasks"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_create_task.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_transition_task" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_transition_task.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_transition_task" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /tickets/tasks/{id}/transition"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_transition_task.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_get_qc_gates" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_get_qc_gates.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_get_qc_gates" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/work-orders/{workOrderId}/qc-gates"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_get_qc_gates.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_batch_submit_qc_gates" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_batch_submit_qc_gates.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_batch_submit_qc_gates" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /tickets/work-orders/{workOrderId}/qc-gates/batch-submit"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_batch_submit_qc_gates.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_time_entries" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_time_entries.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_time_entries" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/work-orders/{workOrderId}/time-entries"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_time_entries.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_all_time_entries" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_all_time_entries.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_all_time_entries" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/time-entries"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_all_time_entries.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_create_time_entry" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_create_time_entry.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_create_time_entry" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /tickets/time-entries"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_create_time_entry.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}
resource "aws_apigatewayv2_route" "tickets_create_time_entry_for_work_order" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /tickets/work-orders/{workOrderId}/time-entries"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_create_time_entry.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_update_time_entry" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_update_time_entry.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_update_time_entry" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /tickets/time-entries/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_update_time_entry.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}
resource "aws_apigatewayv2_route" "tickets_update_time_entry_for_work_order" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /tickets/work-orders/{workOrderId}/time-entries/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_update_time_entry.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_delete_time_entry" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_delete_time_entry.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_delete_time_entry" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "DELETE /tickets/time-entries/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_delete_time_entry.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}
resource "aws_apigatewayv2_route" "tickets_delete_time_entry_for_work_order" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "DELETE /tickets/work-orders/{workOrderId}/time-entries/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_delete_time_entry.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_routing_steps" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_routing_steps.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_routing_steps" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /planning/routing-steps"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_routing_steps.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_transition_routing_step" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_transition_routing_step.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_transition_routing_step" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /planning/routing-steps/{id}/state"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_transition_routing_step.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_rework" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_rework.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_rework" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/rework"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_rework.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_create_rework" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_create_rework.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_create_rework" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /tickets/rework"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_create_rework.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_sync" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_sync.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_sync" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/sync"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_sync.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_all_work_orders" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_all_work_orders.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_all_work_orders" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/work-orders"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_all_work_orders.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_technician_tasks" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_list_technician_tasks.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_technician_tasks" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /tickets/technician-tasks"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_list_technician_tasks.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_transition_technician_task" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.tickets_transition_technician_task.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_transition_technician_task" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /tickets/technician-tasks/{id}/state"
  target             = "integrations/${aws_apigatewayv2_integration.tickets_transition_technician_task.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── API GW Integrations + Routes — Scheduling ────────────────────────────────

resource "aws_apigatewayv2_integration" "scheduling_list_slots" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.scheduling_list_slots.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "scheduling_list_slots" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /scheduling/slots"
  target             = "integrations/${aws_apigatewayv2_integration.scheduling_list_slots.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "scheduling_list_labor_capacity" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.scheduling_list_labor_capacity.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "scheduling_list_labor_capacity" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /scheduling/labor-capacity"
  target             = "integrations/${aws_apigatewayv2_integration.scheduling_list_labor_capacity.id}"
  authorization_type = "NONE"
}

# ─── Attachments Lambda Functions ────────────────────────────────────────────

locals {
  lambda_attachments_env = merge(local.lambda_common_env, {
    DOCUMENT_BUCKET_NAME = var.document_bucket_name
  })
}

resource "aws_lambda_function" "attachments_presign_upload" {
  function_name    = "${var.name_prefix}-attachments-presign-upload"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "presign-upload.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/attachments-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.attachments_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.attachments_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "attachments_confirm_upload" {
  function_name    = "${var.name_prefix}-attachments-confirm-upload"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "confirm-upload.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/attachments-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.attachments_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.attachments_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "attachments_list" {
  function_name    = "${var.name_prefix}-attachments-list"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/attachments-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.attachments_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.attachments_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "attachments_presign_download" {
  function_name    = "${var.name_prefix}-attachments-presign-download"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "presign-download.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/attachments-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.attachments_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.attachments_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# S3 read/write policy for attachment Lambdas
resource "aws_iam_role_policy" "erp_lambda_s3_documents" {
  name = "${var.name_prefix}-erp-lambda-s3-documents"
  role = aws_iam_role.erp_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.document_bucket_name}/*"
      }
    ]
  })
}

# Secrets Manager access for QB token management
resource "aws_iam_role_policy" "erp_lambda_secrets_manager" {
  name = "${var.name_prefix}-erp-lambda-secrets-manager"
  role = aws_iam_role.erp_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret"
        ]
        Resource = "arn:aws:secretsmanager:*:*:secret:/gg-erp/*/qb/*"
      }
    ]
  })
}

# Cognito admin operations for user management
resource "aws_iam_role_policy" "erp_lambda_cognito_admin" {
  count = var.cognito_user_pool_arn != "" ? 1 : 0
  name  = "${var.name_prefix}-erp-lambda-cognito-admin"
  role  = aws_iam_role.erp_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminEnableUser",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:ListGroups"
        ]
        Resource = var.cognito_user_pool_arn
      }
    ]
  })
}

# ─── API GW Integrations + Routes — Attachments ───────────────────────────────

resource "aws_apigatewayv2_integration" "attachments_presign_upload" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.attachments_presign_upload.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "attachments_presign_upload" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /attachments/presign"
  target             = "integrations/${aws_apigatewayv2_integration.attachments_presign_upload.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "attachments_confirm_upload" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.attachments_confirm_upload.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "attachments_confirm_upload" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PUT /attachments/{id}/confirm"
  target             = "integrations/${aws_apigatewayv2_integration.attachments_confirm_upload.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "attachments_list" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.attachments_list.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "attachments_list" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /attachments"
  target             = "integrations/${aws_apigatewayv2_integration.attachments_list.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "attachments_presign_download" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.attachments_presign_download.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "attachments_presign_download" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /attachments/{id}/download"
  target             = "integrations/${aws_apigatewayv2_integration.attachments_presign_download.id}"
  authorization_type = "NONE"
}

# ─── SOP / OJT Lambdas ────────────────────────────────────────────────────────

resource "aws_lambda_function" "sop_list" {
  function_name    = "${var.name_prefix}-sop-list"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_get" {
  function_name    = "${var.name_prefix}-sop-get"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_create" {
  function_name    = "${var.name_prefix}-sop-create"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_publish_version" {
  function_name    = "${var.name_prefix}-sop-publish-version"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "publish-version.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_modules" {
  function_name    = "${var.name_prefix}-sop-list-modules"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-modules.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_assignments" {
  function_name    = "${var.name_prefix}-sop-list-assignments"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-assignments.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_complete_assignment" {
  function_name    = "${var.name_prefix}-sop-complete-assignment"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "complete-assignment.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sop_list" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_list.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_list" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop"
  target             = "integrations/${aws_apigatewayv2_integration.sop_list.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_get" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_get.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_get" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sop_get.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_create" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_create.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_create" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sop"
  target             = "integrations/${aws_apigatewayv2_integration.sop_create.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "sop_publish_version" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_publish_version.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_publish_version" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sop/{id}/versions"
  target             = "integrations/${aws_apigatewayv2_integration.sop_publish_version.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "sop_list_modules" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_list_modules.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_list_modules" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /ojt/modules"
  target             = "integrations/${aws_apigatewayv2_integration.sop_list_modules.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_list_assignments" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_list_assignments.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_list_assignments" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /ojt/assignments"
  target             = "integrations/${aws_apigatewayv2_integration.sop_list_assignments.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_complete_assignment" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_complete_assignment.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_complete_assignment" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /ojt/assignments/{id}/complete"
  target             = "integrations/${aws_apigatewayv2_integration.sop_complete_assignment.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── SOP Training / OJT Additional Lambdas ─────────────────────────────────────

resource "aws_lambda_function" "sop_get_module" {
  function_name    = "${var.name_prefix}-sop-get-module"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-module.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_get_module_progress" {
  function_name    = "${var.name_prefix}-sop-get-module-progress"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-module-progress.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_update_step_progress" {
  function_name    = "${var.name_prefix}-sop-update-step-progress"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "update-step-progress.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_submit_quiz" {
  function_name    = "${var.name_prefix}-sop-submit-quiz"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "submit-quiz.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_notes" {
  function_name    = "${var.name_prefix}-sop-list-notes"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-notes.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_upsert_note" {
  function_name    = "${var.name_prefix}-sop-upsert-note"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "upsert-note.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_bookmarks" {
  function_name    = "${var.name_prefix}-sop-list-bookmarks"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-bookmarks.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_toggle_bookmark" {
  function_name    = "${var.name_prefix}-sop-toggle-bookmark"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "toggle-bookmark.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_inspection_templates" {
  function_name    = "${var.name_prefix}-sop-list-inspection-templates"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-inspection-templates.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_get_inspection_template" {
  function_name    = "${var.name_prefix}-sop-get-inspection-template"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-inspection-template.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sop-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sop_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sop_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── API GW Integrations + Routes — SOP Additional ─────────────────────────────

resource "aws_apigatewayv2_integration" "sop_get_module" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_get_module.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_get_module" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/modules/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sop_get_module.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_get_module_progress" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_get_module_progress.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_get_module_progress" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/modules/{id}/progress/{employeeId}"
  target             = "integrations/${aws_apigatewayv2_integration.sop_get_module_progress.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_update_step_progress" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_update_step_progress.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_update_step_progress" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PUT /sop/modules/{id}/step-progress"
  target             = "integrations/${aws_apigatewayv2_integration.sop_update_step_progress.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "sop_submit_quiz" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_submit_quiz.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_submit_quiz" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sop/modules/{id}/quiz"
  target             = "integrations/${aws_apigatewayv2_integration.sop_submit_quiz.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "sop_list_notes" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_list_notes.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_list_notes" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/notes"
  target             = "integrations/${aws_apigatewayv2_integration.sop_list_notes.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_upsert_note" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_upsert_note.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_upsert_note" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sop/notes"
  target             = "integrations/${aws_apigatewayv2_integration.sop_upsert_note.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "sop_list_bookmarks" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_list_bookmarks.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_list_bookmarks" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/bookmarks"
  target             = "integrations/${aws_apigatewayv2_integration.sop_list_bookmarks.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_toggle_bookmark" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_toggle_bookmark.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_toggle_bookmark" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sop/bookmarks"
  target             = "integrations/${aws_apigatewayv2_integration.sop_toggle_bookmark.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "sop_list_inspection_templates" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_list_inspection_templates.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_list_inspection_templates" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/inspection-templates"
  target             = "integrations/${aws_apigatewayv2_integration.sop_list_inspection_templates.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sop_get_inspection_template" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.sop_get_inspection_template.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "sop_get_inspection_template" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sop/inspection-templates/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sop_get_inspection_template.id}"
  authorization_type = "NONE"
}

# ─── Accounting / QuickBooks Lambdas ─────────────────────────────────────────

resource "aws_lambda_function" "accounting_oauth_connect" {
  function_name    = "${var.name_prefix}-accounting-oauth-connect"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "oauth-connect.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_oauth_callback" {
  function_name    = "${var.name_prefix}-accounting-oauth-callback"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "oauth-callback.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_status" {
  function_name    = "${var.name_prefix}-accounting-status"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "status.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_list_sync" {
  function_name    = "${var.name_prefix}-accounting-list-sync"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-sync.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_retry_sync" {
  function_name    = "${var.name_prefix}-accounting-retry-sync"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "retry-sync.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_trigger_sync" {
  function_name    = "${var.name_prefix}-accounting-trigger-sync"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "trigger-sync.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_webhook" {
  function_name    = "${var.name_prefix}-accounting-webhook"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "webhook.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "accounting_oauth_connect" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_oauth_connect.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_oauth_connect" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/oauth/connect"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_oauth_connect.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_oauth_callback" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_oauth_callback.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_oauth_callback" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/oauth/callback"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_oauth_callback.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_status" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_status.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_status" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/status"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_status.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_list_sync" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_list_sync.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_list_sync" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/invoice-sync"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_list_sync.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_retry_sync" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_retry_sync.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_retry_sync" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /accounting/invoice-sync/{id}/retry"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_retry_sync.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_trigger_sync" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_trigger_sync.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_trigger_sync" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /accounting/invoice-sync"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_trigger_sync.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_webhook" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_webhook.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_webhook" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /accounting/webhook"
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_webhook.id}"
}

# ─── Accounting Additional Lambdas ────────────────────────────────────────────

resource "aws_lambda_function" "accounting_list_customer_syncs" {
  function_name    = "${var.name_prefix}-accounting-list-customer-syncs"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-customer-syncs.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_list_reconciliation_runs" {
  function_name    = "${var.name_prefix}-accounting-list-reconciliation-runs"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-reconciliation-runs.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_list_accounts" {
  function_name    = "${var.name_prefix}-accounting-list-accounts"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-accounts.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_get_failure_summary" {
  function_name    = "${var.name_prefix}-accounting-get-failure-summary"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-failure-summary.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/accounting-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.accounting_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.accounting_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── API GW Integrations + Routes — Accounting Additional ─────────────────────

resource "aws_apigatewayv2_integration" "accounting_list_customer_syncs" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_list_customer_syncs.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_list_customer_syncs" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/customers"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_list_customer_syncs.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_list_reconciliation_runs" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_list_reconciliation_runs.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_list_reconciliation_runs" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/reconciliation/runs"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_list_reconciliation_runs.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_list_accounts" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_list_accounts.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_list_accounts" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/integration-accounts"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_list_accounts.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "accounting_get_failure_summary" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.accounting_get_failure_summary.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "accounting_get_failure_summary" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /accounting/failures/summary"
  target             = "integrations/${aws_apigatewayv2_integration.accounting_get_failure_summary.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ============================================================
# Migration Admin Lambdas
# ============================================================

resource "aws_lambda_function" "migration_trigger_batch" {
  function_name    = "${var.name_prefix}-migration-trigger-batch"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "trigger-batch.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}
resource "aws_lambda_function" "migration_list_batches" {
  function_name    = "${var.name_prefix}-migration-list-batches"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-batches.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}
resource "aws_lambda_function" "migration_get_batch" {
  function_name    = "${var.name_prefix}-migration-get-batch"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-batch.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}
resource "aws_lambda_function" "migration_cancel_batch" {
  function_name    = "${var.name_prefix}-migration-cancel-batch"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "cancel-batch.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# Long-running migration runner — reads export from S3, runs all ETL waves
resource "aws_lambda_function" "migration_runner" {
  function_name    = "${var.name_prefix}-migration-runner"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "run-migration.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 900
  memory_size      = 1024
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# Parts migration — fetches from ShopMonkey API and runs Waves C/F/G
resource "aws_lambda_function" "migrate_parts" {
  function_name    = "${var.name_prefix}-migrate-parts"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "migrate-parts.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 900
  memory_size      = 1024
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "run_schema_migration" {
  function_name    = "${var.name_prefix}-run-schema-migration"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "run-schema-migration.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 300
  memory_size      = 512
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "seed_inventory_master" {
  function_name    = "${var.name_prefix}-seed-inventory-master"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "seed-inventory-master.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/migration-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.migration_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.migration_lambda_zip_path)
  timeout          = 300
  memory_size      = 1024
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Worker Lambdas (outbox publisher, payment sync, reconciliation) ─────────

resource "aws_lambda_function" "workers_outbox_publisher" {
  function_name    = "${var.name_prefix}-workers-outbox-publisher"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "outbox-publisher.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/workers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.workers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.workers_lambda_zip_path)
  timeout          = 60
  memory_size      = 512
  environment {
    variables = merge(local.lambda_common_env, {
      EVENT_BUS_NAME = "${var.name_prefix}-erp-events"
    })
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "workers_payment_sync" {
  function_name    = "${var.name_prefix}-workers-payment-sync"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "payment-sync.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/workers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.workers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.workers_lambda_zip_path)
  timeout          = 120
  memory_size      = 512
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "workers_reconciliation" {
  function_name    = "${var.name_prefix}-workers-reconciliation"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "reconciliation.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/workers-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.workers_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.workers_lambda_zip_path)
  timeout          = 120
  memory_size      = 512
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# Grant worker Lambdas permission to publish events to the EventBridge bus.
resource "aws_iam_role_policy" "erp_lambda_eventbridge_publish" {
  name = "${var.name_prefix}-erp-lambda-eventbridge-publish"
  role = aws_iam_role.erp_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["events:PutEvents"]
      Resource = "*"
    }]
  })
}

# S3 read/write access for migration artifacts bucket
resource "aws_iam_role_policy" "erp_lambda_s3_migration" {
  count = var.migration_artifacts_bucket_name != "" ? 1 : 0
  name  = "${var.name_prefix}-erp-lambda-s3-migration"
  role  = aws_iam_role.erp_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [
        "arn:aws:s3:::${var.migration_artifacts_bucket_name}",
        "arn:aws:s3:::${var.migration_artifacts_bucket_name}/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "erp_lambda_bedrock" {
  name = "${var.name_prefix}-erp-lambda-bedrock"
  role = aws_iam_role.erp_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        "arn:aws:bedrock:*:*:inference-profile/us.anthropic.*"
      ]
    }]
  })
}

# ── Audit context ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "audit_list_events" {
  function_name    = "${var.name_prefix}-audit-list-events"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-audit-events.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/audit-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.audit_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.audit_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "audit_list_events" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.audit_list_events.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "audit_list_events" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /audit/events"
  target             = "integrations/${aws_apigatewayv2_integration.audit_list_events.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "audit_list_events" {
  function_name = aws_lambda_function.audit_list_events.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

# ── Communication context ────────────────────────────────────────────────────

resource "aws_lambda_function" "communication_list_channels" {
  function_name    = "${var.name_prefix}-communication-list-channels"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-channels.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_create_channel" {
  function_name    = "${var.name_prefix}-communication-create-channel"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-channel.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_messages" {
  function_name    = "${var.name_prefix}-communication-list-messages"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-messages.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_replies" {
  function_name    = "${var.name_prefix}-communication-list-replies"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-replies.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_send_message" {
  function_name    = "${var.name_prefix}-communication-send-message"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "send-message.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_edit_message" {
  function_name    = "${var.name_prefix}-communication-edit-message"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "edit-message.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_delete_message" {
  function_name    = "${var.name_prefix}-communication-delete-message"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "delete-message.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_add_reaction" {
  function_name    = "${var.name_prefix}-communication-add-reaction"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "add-reaction.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_remove_reaction" {
  function_name    = "${var.name_prefix}-communication-remove-reaction"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "remove-reaction.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_todos" {
  function_name    = "${var.name_prefix}-communication-list-todos"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-todos.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_create_todo" {
  function_name    = "${var.name_prefix}-communication-create-todo"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-todo.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_update_todo" {
  function_name    = "${var.name_prefix}-communication-update-todo"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "update-todo.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_notifications" {
  function_name    = "${var.name_prefix}-communication-list-notifications"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-notifications.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_mark_notifications_read" {
  function_name    = "${var.name_prefix}-communication-mark-notifications-read"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "mark-notifications-read.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/communication-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.communication_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.communication_lambda_zip_path)
  timeout          = 15
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "communication_list_channels" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_list_channels.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_list_channels" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /communication/channels"
  target             = "integrations/${aws_apigatewayv2_integration.communication_list_channels.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "communication_create_channel" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_create_channel.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_create_channel" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /communication/channels"
  target             = "integrations/${aws_apigatewayv2_integration.communication_create_channel.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_list_messages" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_list_messages.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_list_messages" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /communication/channels/{channelId}/messages"
  target             = "integrations/${aws_apigatewayv2_integration.communication_list_messages.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "communication_list_replies" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_list_replies.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_list_replies" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /communication/messages/{messageId}/replies"
  target             = "integrations/${aws_apigatewayv2_integration.communication_list_replies.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "communication_send_message" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_send_message.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_send_message" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /communication/channels/{channelId}/messages"
  target             = "integrations/${aws_apigatewayv2_integration.communication_send_message.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_edit_message" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_edit_message.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_edit_message" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /communication/messages/{messageId}"
  target             = "integrations/${aws_apigatewayv2_integration.communication_edit_message.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_delete_message" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_delete_message.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_delete_message" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "DELETE /communication/messages/{messageId}"
  target             = "integrations/${aws_apigatewayv2_integration.communication_delete_message.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_add_reaction" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_add_reaction.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_add_reaction" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /communication/messages/{messageId}/reactions"
  target             = "integrations/${aws_apigatewayv2_integration.communication_add_reaction.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_remove_reaction" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_remove_reaction.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_remove_reaction" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "DELETE /communication/messages/{messageId}/reactions/{emoji}"
  target             = "integrations/${aws_apigatewayv2_integration.communication_remove_reaction.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_list_todos" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_list_todos.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_list_todos" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /communication/channels/{channelId}/todos"
  target             = "integrations/${aws_apigatewayv2_integration.communication_list_todos.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "communication_create_todo" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_create_todo.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_create_todo" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /communication/channels/{channelId}/todos"
  target             = "integrations/${aws_apigatewayv2_integration.communication_create_todo.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_update_todo" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_update_todo.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_update_todo" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /communication/todos/{todoId}"
  target             = "integrations/${aws_apigatewayv2_integration.communication_update_todo.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "communication_list_notifications" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_list_notifications.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_list_notifications" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /communication/notifications"
  target             = "integrations/${aws_apigatewayv2_integration.communication_list_notifications.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "communication_mark_notifications_read" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.communication_mark_notifications_read.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "communication_mark_notifications_read" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /communication/notifications/read"
  target             = "integrations/${aws_apigatewayv2_integration.communication_mark_notifications_read.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "migration_trigger_batch" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.migration_trigger_batch.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "migration_trigger_batch" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /migration/batches"
  target             = "integrations/${aws_apigatewayv2_integration.migration_trigger_batch.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "migration_list_batches" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.migration_list_batches.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "migration_list_batches" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /migration/batches"
  target             = "integrations/${aws_apigatewayv2_integration.migration_list_batches.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "migration_get_batch" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.migration_get_batch.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "migration_get_batch" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /migration/batches/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.migration_get_batch.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "migration_cancel_batch" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.migration_cancel_batch.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "migration_cancel_batch" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /migration/batches/{id}/cancel"
  target             = "integrations/${aws_apigatewayv2_integration.migration_cancel_batch.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

locals {
  erp_lambdas = {
    workspace_today                       = aws_lambda_function.workspace_today
    identity_me                           = aws_lambda_function.identity_me
    identity_list_dealers                 = aws_lambda_function.identity_list_dealers
    identity_list_employees               = aws_lambda_function.identity_list_employees
    work_orders_get                       = aws_lambda_function.work_orders_get
    customers_list                        = aws_lambda_function.customers_list
    customers_create                      = aws_lambda_function.customers_create
    customers_get                         = aws_lambda_function.customers_get
    customers_transition                  = aws_lambda_function.customers_transition
    inventory_list_parts                  = aws_lambda_function.inventory_list_parts
    inventory_create_part                 = aws_lambda_function.inventory_create_part
    inventory_get_part                    = aws_lambda_function.inventory_get_part
    inventory_get_part_chain              = aws_lambda_function.inventory_get_part_chain
    inventory_list_vendors                = aws_lambda_function.inventory_list_vendors
    inventory_list_purchase_orders        = aws_lambda_function.inventory_list_purchase_orders
    inventory_list_lots                   = aws_lambda_function.inventory_list_lots
    inventory_list_reservations           = aws_lambda_function.inventory_list_reservations
    inventory_create_reservation          = aws_lambda_function.inventory_create_reservation
    inventory_release_reservation         = aws_lambda_function.inventory_release_reservation
    inventory_consume_reservation         = aws_lambda_function.inventory_consume_reservation
    inventory_list_manufacturers          = aws_lambda_function.inventory_list_manufacturers
    inventory_create_manufacturer         = aws_lambda_function.inventory_create_manufacturer
    inventory_plan_material_by_stage      = aws_lambda_function.inventory_plan_material_by_stage
    tickets_list_tasks                    = aws_lambda_function.tickets_list_tasks
    tickets_create_task                   = aws_lambda_function.tickets_create_task
    tickets_transition                    = aws_lambda_function.tickets_transition_task
    tickets_get_qc_gates                  = aws_lambda_function.tickets_get_qc_gates
    tickets_batch_submit_qc_gates         = aws_lambda_function.tickets_batch_submit_qc_gates
    tickets_list_time_entries             = aws_lambda_function.tickets_list_time_entries
    tickets_create_time_entry             = aws_lambda_function.tickets_create_time_entry
    tickets_update_time_entry             = aws_lambda_function.tickets_update_time_entry
    tickets_delete_time_entry             = aws_lambda_function.tickets_delete_time_entry
    tickets_list_all_time_entries         = aws_lambda_function.tickets_list_all_time_entries
    tickets_list_routing_steps            = aws_lambda_function.tickets_list_routing_steps
    tickets_transition_routing_step       = aws_lambda_function.tickets_transition_routing_step
    tickets_list_rework                   = aws_lambda_function.tickets_list_rework
    tickets_create_rework                 = aws_lambda_function.tickets_create_rework
    tickets_list_sync                     = aws_lambda_function.tickets_list_sync
    tickets_list_all_work_orders          = aws_lambda_function.tickets_list_all_work_orders
    tickets_list_technician_tasks         = aws_lambda_function.tickets_list_technician_tasks
    tickets_transition_technician_task    = aws_lambda_function.tickets_transition_technician_task
    scheduling_list_slots                 = aws_lambda_function.scheduling_list_slots
    scheduling_list_labor_capacity        = aws_lambda_function.scheduling_list_labor_capacity
    attachments_presign_upload            = aws_lambda_function.attachments_presign_upload
    attachments_confirm_upload            = aws_lambda_function.attachments_confirm_upload
    attachments_list                      = aws_lambda_function.attachments_list
    attachments_presign_download          = aws_lambda_function.attachments_presign_download
    sop_list                              = aws_lambda_function.sop_list
    sop_get                               = aws_lambda_function.sop_get
    sop_create                            = aws_lambda_function.sop_create
    sop_publish_version                   = aws_lambda_function.sop_publish_version
    sop_list_modules                      = aws_lambda_function.sop_list_modules
    sop_list_assignments                  = aws_lambda_function.sop_list_assignments
    sop_complete_assignment               = aws_lambda_function.sop_complete_assignment
    sop_get_module                        = aws_lambda_function.sop_get_module
    sop_get_module_progress               = aws_lambda_function.sop_get_module_progress
    sop_update_step_progress              = aws_lambda_function.sop_update_step_progress
    sop_submit_quiz                       = aws_lambda_function.sop_submit_quiz
    sop_list_notes                        = aws_lambda_function.sop_list_notes
    sop_upsert_note                       = aws_lambda_function.sop_upsert_note
    sop_list_bookmarks                    = aws_lambda_function.sop_list_bookmarks
    sop_toggle_bookmark                   = aws_lambda_function.sop_toggle_bookmark
    sop_list_inspection_templates         = aws_lambda_function.sop_list_inspection_templates
    sop_get_inspection_template           = aws_lambda_function.sop_get_inspection_template
    accounting_oauth_connect              = aws_lambda_function.accounting_oauth_connect
    accounting_oauth_callback             = aws_lambda_function.accounting_oauth_callback
    accounting_status                     = aws_lambda_function.accounting_status
    accounting_list_sync                  = aws_lambda_function.accounting_list_sync
    accounting_retry_sync                 = aws_lambda_function.accounting_retry_sync
    accounting_trigger_sync               = aws_lambda_function.accounting_trigger_sync
    accounting_webhook                    = aws_lambda_function.accounting_webhook
    accounting_list_customer_syncs        = aws_lambda_function.accounting_list_customer_syncs
    accounting_list_reconciliation_runs   = aws_lambda_function.accounting_list_reconciliation_runs
    accounting_list_accounts              = aws_lambda_function.accounting_list_accounts
    accounting_get_failure_summary        = aws_lambda_function.accounting_get_failure_summary
    workers_outbox_publisher              = aws_lambda_function.workers_outbox_publisher
    workers_payment_sync                  = aws_lambda_function.workers_payment_sync
    workers_reconciliation                = aws_lambda_function.workers_reconciliation
    seed_inventory_master                 = aws_lambda_function.seed_inventory_master
    migration_trigger_batch               = aws_lambda_function.migration_trigger_batch
    migration_list_batches                = aws_lambda_function.migration_list_batches
    migration_get_batch                   = aws_lambda_function.migration_get_batch
    migration_cancel_batch                = aws_lambda_function.migration_cancel_batch
    communication_list_channels           = aws_lambda_function.communication_list_channels
    communication_create_channel          = aws_lambda_function.communication_create_channel
    communication_list_messages           = aws_lambda_function.communication_list_messages
    communication_list_replies            = aws_lambda_function.communication_list_replies
    communication_send_message            = aws_lambda_function.communication_send_message
    communication_edit_message            = aws_lambda_function.communication_edit_message
    communication_delete_message          = aws_lambda_function.communication_delete_message
    communication_add_reaction            = aws_lambda_function.communication_add_reaction
    communication_remove_reaction         = aws_lambda_function.communication_remove_reaction
    communication_list_todos              = aws_lambda_function.communication_list_todos
    communication_create_todo             = aws_lambda_function.communication_create_todo
    communication_update_todo             = aws_lambda_function.communication_update_todo
    communication_list_notifications      = aws_lambda_function.communication_list_notifications
    communication_mark_notifications_read = aws_lambda_function.communication_mark_notifications_read
  }
}

resource "aws_lambda_permission" "allow_api_gateway_erp" {
  for_each      = local.erp_lambdas
  statement_id  = "AllowExecution-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*/*"
}



resource "aws_lambda_permission" "allow_api_gateway_create" {
  statement_id  = "AllowExecutionFromApiGatewayCreate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.work_orders_create.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*/planning/work-orders"
}

resource "aws_lambda_permission" "allow_api_gateway_list" {
  statement_id  = "AllowExecutionFromApiGatewayList"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.work_orders_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*/planning/work-orders"
}

# ── Sales context ─────────────────────────────────────────────────────────────

resource "aws_lambda_function" "sales_list_opportunities" {
  function_name    = "${var.name_prefix}-sales-list-opportunities"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-opportunities.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_list_opportunities" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_list_opportunities.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_list_opportunities" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/opportunities"
  target             = "integrations/${aws_apigatewayv2_integration.sales_list_opportunities.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_list_opportunities" {
  function_name = aws_lambda_function.sales_list_opportunities.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_get_opportunity" {
  function_name    = "${var.name_prefix}-sales-get-opportunity"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-opportunity.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_get_opportunity" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_get_opportunity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_get_opportunity" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/opportunities/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sales_get_opportunity.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_get_opportunity" {
  function_name = aws_lambda_function.sales_get_opportunity.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_create_opportunity" {
  function_name    = "${var.name_prefix}-sales-create-opportunity"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-opportunity.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_create_opportunity" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_create_opportunity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_create_opportunity" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/opportunities"
  target             = "integrations/${aws_apigatewayv2_integration.sales_create_opportunity.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_create_opportunity" {
  function_name = aws_lambda_function.sales_create_opportunity.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_update_opportunity" {
  function_name    = "${var.name_prefix}-sales-update-opportunity"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "update-opportunity.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_update_opportunity" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_update_opportunity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_update_opportunity" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /sales/opportunities/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sales_update_opportunity.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_update_opportunity" {
  function_name = aws_lambda_function.sales_update_opportunity.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_transition_opportunity" {
  function_name    = "${var.name_prefix}-sales-transition-opportunity"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "transition-opportunity.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_transition_opportunity" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_transition_opportunity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_transition_opportunity" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/opportunities/{id}/stage"
  target             = "integrations/${aws_apigatewayv2_integration.sales_transition_opportunity.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_transition_opportunity" {
  function_name = aws_lambda_function.sales_transition_opportunity.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_list_quotes" {
  function_name    = "${var.name_prefix}-sales-list-quotes"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-quotes.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_list_quotes" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_list_quotes.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_list_quotes" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/quotes"
  target             = "integrations/${aws_apigatewayv2_integration.sales_list_quotes.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_list_quotes" {
  function_name = aws_lambda_function.sales_list_quotes.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_get_quote" {
  function_name    = "${var.name_prefix}-sales-get-quote"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-quote.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_get_quote" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_get_quote.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_get_quote" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/quotes/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sales_get_quote.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_get_quote" {
  function_name = aws_lambda_function.sales_get_quote.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_create_quote" {
  function_name    = "${var.name_prefix}-sales-create-quote"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-quote.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_create_quote" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_create_quote.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_create_quote" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/quotes"
  target             = "integrations/${aws_apigatewayv2_integration.sales_create_quote.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_create_quote" {
  function_name = aws_lambda_function.sales_create_quote.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_update_quote" {
  function_name    = "${var.name_prefix}-sales-update-quote"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "update-quote.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_update_quote" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_update_quote.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_update_quote" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PATCH /sales/quotes/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.sales_update_quote.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_update_quote" {
  function_name = aws_lambda_function.sales_update_quote.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_update_quote_lines" {
  function_name    = "${var.name_prefix}-sales-update-quote-lines"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "update-quote-lines.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_update_quote_lines" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_update_quote_lines.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_update_quote_lines" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "PUT /sales/quotes/{id}/lines"
  target             = "integrations/${aws_apigatewayv2_integration.sales_update_quote_lines.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_update_quote_lines" {
  function_name = aws_lambda_function.sales_update_quote_lines.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_send_quote" {
  function_name    = "${var.name_prefix}-sales-send-quote"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "send-quote.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_send_quote" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_send_quote.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_send_quote" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/quotes/{id}/send"
  target             = "integrations/${aws_apigatewayv2_integration.sales_send_quote.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_send_quote" {
  function_name = aws_lambda_function.sales_send_quote.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_accept_quote" {
  function_name    = "${var.name_prefix}-sales-accept-quote"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "accept-quote.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_accept_quote" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_accept_quote.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_accept_quote" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/quotes/{id}/accept"
  target             = "integrations/${aws_apigatewayv2_integration.sales_accept_quote.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_accept_quote" {
  function_name = aws_lambda_function.sales_accept_quote.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_reject_quote" {
  function_name    = "${var.name_prefix}-sales-reject-quote"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "reject-quote.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_reject_quote" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_reject_quote.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_reject_quote" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/quotes/{id}/reject"
  target             = "integrations/${aws_apigatewayv2_integration.sales_reject_quote.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_reject_quote" {
  function_name = aws_lambda_function.sales_reject_quote.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_list_activities" {
  function_name    = "${var.name_prefix}-sales-list-activities"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-activities.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_list_activities" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_list_activities.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_list_activities" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/activities"
  target             = "integrations/${aws_apigatewayv2_integration.sales_list_activities.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_list_activities" {
  function_name = aws_lambda_function.sales_list_activities.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_create_activity" {
  function_name    = "${var.name_prefix}-sales-create-activity"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-activity.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_create_activity" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_create_activity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_create_activity" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/activities"
  target             = "integrations/${aws_apigatewayv2_integration.sales_create_activity.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_create_activity" {
  function_name = aws_lambda_function.sales_create_activity.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_pipeline_stats" {
  function_name    = "${var.name_prefix}-sales-pipeline-stats"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "pipeline-stats.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_pipeline_stats" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_pipeline_stats.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_pipeline_stats" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/pipeline-stats"
  target             = "integrations/${aws_apigatewayv2_integration.sales_pipeline_stats.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_pipeline_stats" {
  function_name = aws_lambda_function.sales_pipeline_stats.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_forecast" {
  function_name    = "${var.name_prefix}-sales-forecast"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "forecast.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_forecast" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_forecast.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_forecast" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/forecast"
  target             = "integrations/${aws_apigatewayv2_integration.sales_forecast.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_forecast" {
  function_name = aws_lambda_function.sales_forecast.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_dashboard" {
  function_name    = "${var.name_prefix}-sales-dashboard"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "dashboard.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_dashboard" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_dashboard.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_dashboard" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/dashboard"
  target             = "integrations/${aws_apigatewayv2_integration.sales_dashboard.id}"
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "sales_dashboard" {
  function_name = aws_lambda_function.sales_dashboard.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

# ── Sales AI Agent ───────────────────────────────────────────────────────────

resource "aws_lambda_function" "sales_agent_chat" {
  function_name    = "${var.name_prefix}-sales-agent-chat"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "agent-chat.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 120
  memory_size      = 512
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_agent_chat" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_agent_chat.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_agent_chat" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /sales/agent/chat"
  target             = "integrations/${aws_apigatewayv2_integration.sales_agent_chat.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "sales_agent_chat" {
  function_name = aws_lambda_function.sales_agent_chat.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_agent_sessions" {
  function_name    = "${var.name_prefix}-sales-agent-sessions"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "agent-sessions.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_agent_sessions" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_agent_sessions.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_agent_sessions" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/agent/sessions"
  target             = "integrations/${aws_apigatewayv2_integration.sales_agent_sessions.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "sales_agent_sessions" {
  function_name = aws_lambda_function.sales_agent_sessions.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "sales_agent_session_detail" {
  function_name    = "${var.name_prefix}-sales-agent-session-detail"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "agent-session-detail.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/sales-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.sales_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.sales_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "sales_agent_session_detail" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sales_agent_session_detail.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sales_agent_session_detail" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /sales/agent/sessions/{sessionId}"
  target             = "integrations/${aws_apigatewayv2_integration.sales_agent_session_detail.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "sales_agent_session_detail" {
  function_name = aws_lambda_function.sales_agent_session_detail.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

# =============================================================================
# Global Copilot Lambdas
# =============================================================================

resource "aws_lambda_function" "copilot_chat" {
  function_name    = "${var.name_prefix}-copilot-chat"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "chat.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/copilot-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.copilot_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.copilot_lambda_zip_path)
  timeout          = 120
  memory_size      = 512
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "copilot_chat" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.copilot_chat.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "copilot_chat" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "POST /copilot/chat"
  target             = "integrations/${aws_apigatewayv2_integration.copilot_chat.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "copilot_chat" {
  function_name = aws_lambda_function.copilot_chat.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "copilot_sessions" {
  function_name    = "${var.name_prefix}-copilot-sessions"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "sessions.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/copilot-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.copilot_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.copilot_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "copilot_sessions" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.copilot_sessions.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "copilot_sessions" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /copilot/sessions"
  target             = "integrations/${aws_apigatewayv2_integration.copilot_sessions.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "copilot_sessions" {
  function_name = aws_lambda_function.copilot_sessions.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

resource "aws_lambda_function" "copilot_session_detail" {
  function_name    = "${var.name_prefix}-copilot-session-detail"
  role             = aws_iam_role.erp_lambda.arn
  runtime          = "nodejs20.x"
  handler          = "session-detail.handler"
  s3_bucket        = var.lambda_artifacts_bucket_name != "" ? var.lambda_artifacts_bucket_name : null
  s3_key           = var.lambda_artifacts_bucket_name != "" ? "lambdas/copilot-lambda.zip" : null
  filename         = var.lambda_artifacts_bucket_name == "" ? var.copilot_lambda_zip_path : null
  source_code_hash = filebase64sha256(var.copilot_lambda_zip_path)
  timeout          = 30
  memory_size      = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_apigatewayv2_integration" "copilot_session_detail" {
  api_id                 = aws_apigatewayv2_api.erp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.copilot_session_detail.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "copilot_session_detail" {
  api_id             = aws_apigatewayv2_api.erp.id
  route_key          = "GET /copilot/sessions/{sessionId}"
  target             = "integrations/${aws_apigatewayv2_integration.copilot_session_detail.id}"
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "copilot_session_detail" {
  function_name = aws_lambda_function.copilot_session_detail.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.erp.execution_arn}/*/*"
}

output "api_base_url" {
  value = trimsuffix(aws_apigatewayv2_stage.default.invoke_url, "/")
}

output "work_orders_create_lambda_name" {
  value = aws_lambda_function.work_orders_create.function_name
}

output "work_orders_list_lambda_name" {
  value = aws_lambda_function.work_orders_list.function_name
}

output "api_gateway_id" {
  value = aws_apigatewayv2_api.erp.id
}

output "cognito_authorizer_id" {
  value = length(aws_apigatewayv2_authorizer.cognito_jwt) > 0 ? aws_apigatewayv2_authorizer.cognito_jwt[0].id : null
}

output "workers_outbox_publisher_lambda_arn" {
  value = aws_lambda_function.workers_outbox_publisher.arn
}

output "workers_payment_sync_lambda_arn" {
  value = aws_lambda_function.workers_payment_sync.arn
}

output "workers_reconciliation_lambda_arn" {
  value = aws_lambda_function.workers_reconciliation.arn
}

output "all_lambda_function_names" {
  description = <<-EOT
    Every Lambda function name managed by this module. Feed into the observability
    module for CloudWatch alarms.

    IMPORTANT: values must be derivable from plan-time-known strings, not from
    resource attributes. `v.function_name` is unknown-until-apply for any resource
    being created in this plan, which makes `for_each` over this list explode with
    `Invalid for_each argument`. Every Lambda in `local.erp_lambdas` follows the
    convention `function_name = "$${var.name_prefix}-$${replace(key, "_", "-")}"`
    (verified: 116 of 116 resources match), so we compose the name from the map
    key instead of reading the resource. Also include the work_orders Lambdas
    that live under a different IAM role and therefore aren't in erp_lambdas.
  EOT
  value = concat(
    [for k, _ in local.erp_lambdas : "${var.name_prefix}-${replace(k, "_", "-")}"],
    [
      "${var.name_prefix}-work-orders-create",
      "${var.name_prefix}-work-orders-list",
      "${var.name_prefix}-work-orders-transition",
    ],
  )
}
