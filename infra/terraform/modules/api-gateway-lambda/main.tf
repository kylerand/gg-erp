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
  function_name = "${var.name_prefix}-work-orders-create"
  role          = aws_iam_role.work_orders_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create.handler"
  filename      = var.work_orders_lambda_zip_path
  timeout       = 15
  memory_size   = 256

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
  function_name = "${var.name_prefix}-work-orders-list"
  role          = aws_iam_role.work_orders_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list.handler"
  filename      = var.work_orders_lambda_zip_path
  timeout       = 15
  memory_size   = 256

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
  function_name = "${var.name_prefix}-work-orders-transition"
  role          = aws_iam_role.work_orders_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "transition.handler"
  filename      = var.work_orders_lambda_zip_path
  timeout       = 15
  memory_size   = 256

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
  }
  lambda_accounting_env = merge(local.lambda_common_env, {
    QB_CLIENT_ID               = var.qb_client_id
    QB_CLIENT_SECRET           = var.qb_client_secret
    QB_REDIRECT_URI            = var.qb_redirect_uri
    QB_WEBHOOK_VERIFIER_TOKEN  = var.qb_webhook_verifier_token
    FRONTEND_URL               = var.frontend_url
  })
  lambda_admin_env = merge(local.lambda_common_env, {
    COGNITO_USER_POOL_ID = var.cognito_user_pool_id
  })
}

# ─── Identity Lambda Functions ─────────────────────────────────────────────────

resource "aws_lambda_function" "identity_me" {
  function_name = "${var.name_prefix}-identity-me"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "me.handler"
  filename      = var.identity_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Customers Lambda Functions ─────────────────────────────────────────────────

resource "aws_lambda_function" "customers_list" {
  function_name = "${var.name_prefix}-customers-list"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list.handler"
  filename      = var.customers_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "customers_create" {
  function_name = "${var.name_prefix}-customers-create"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create.handler"
  filename      = var.customers_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "customers_get" {
  function_name = "${var.name_prefix}-customers-get"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "get.handler"
  filename      = var.customers_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "customers_transition" {
  function_name = "${var.name_prefix}-customers-transition"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "transition.handler"
  filename      = var.customers_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Inventory Lambda Functions ───────────────────────────────────────────────

resource "aws_lambda_function" "inventory_list_parts" {
  function_name = "${var.name_prefix}-inventory-list-parts"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-parts.handler"
  filename      = var.inventory_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_create_part" {
  function_name = "${var.name_prefix}-inventory-create-part"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create-part.handler"
  filename      = var.inventory_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_get_part" {
  function_name = "${var.name_prefix}-inventory-get-part"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "get-part.handler"
  filename      = var.inventory_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_vendors" {
  function_name = "${var.name_prefix}-inventory-list-vendors"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-vendors.handler"
  filename      = var.inventory_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "inventory_list_lots" {
  function_name = "${var.name_prefix}-inventory-list-lots"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-lots.handler"
  filename      = var.inventory_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── Tickets Lambda Functions ─────────────────────────────────────────────────

resource "aws_lambda_function" "tickets_list_tasks" {
  function_name = "${var.name_prefix}-tickets-list-tasks"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-tasks.handler"
  filename      = var.tickets_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_create_task" {
  function_name = "${var.name_prefix}-tickets-create-task"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create-task.handler"
  filename      = var.tickets_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_transition_task" {
  function_name = "${var.name_prefix}-tickets-transition-task"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "transition-task.handler"
  filename      = var.tickets_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_rework" {
  function_name = "${var.name_prefix}-tickets-list-rework"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-rework.handler"
  filename      = var.tickets_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_create_rework" {
  function_name = "${var.name_prefix}-tickets-create-rework"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create-rework.handler"
  filename      = var.tickets_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "tickets_list_sync" {
  function_name = "${var.name_prefix}-tickets-list-sync"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-sync.handler"
  filename      = var.tickets_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# ─── API GW Integrations + Routes — Identity ──────────────────────────────────

resource "aws_apigatewayv2_integration" "identity_me" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.identity_me.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "identity_me" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /auth/me"
  target    = "integrations/${aws_apigatewayv2_integration.identity_me.id}"
  authorization_type = "NONE"
}

# ─── Admin User Management Lambda Functions ────────────────────────────────────

resource "aws_lambda_function" "admin_list_users" {
  function_name = "${var.name_prefix}-admin-list-users"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "admin-list-users.handler"
  filename      = var.identity_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_admin_env }
}

resource "aws_lambda_function" "admin_create_user" {
  function_name = "${var.name_prefix}-admin-create-user"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "admin-create-user.handler"
  filename      = var.identity_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_admin_env }
}

resource "aws_lambda_function" "admin_update_user" {
  function_name = "${var.name_prefix}-admin-update-user"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "admin-update-user.handler"
  filename      = var.identity_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_admin_env }
}

resource "aws_lambda_function" "admin_delete_user" {
  function_name = "${var.name_prefix}-admin-delete-user"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "admin-delete-user.handler"
  filename      = var.identity_lambda_zip_path
  timeout       = 15
  memory_size   = 256
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
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /admin/users"
  target    = "integrations/${aws_apigatewayv2_integration.admin_list_users.id}"
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
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "POST /admin/users"
  target    = "integrations/${aws_apigatewayv2_integration.admin_create_user.id}"
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
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "PATCH /admin/users/{username}"
  target    = "integrations/${aws_apigatewayv2_integration.admin_update_user.id}"
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
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "DELETE /admin/users/{username}"
  target    = "integrations/${aws_apigatewayv2_integration.admin_delete_user.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── API GW Integrations + Routes — Customers ─────────────────────────────────

resource "aws_apigatewayv2_integration" "customers_list" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.customers_list.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_list" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /identity/customers"
  target    = "integrations/${aws_apigatewayv2_integration.customers_list.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "customers_create" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.customers_create.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_create" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "POST /identity/customers"
  target    = "integrations/${aws_apigatewayv2_integration.customers_create.id}"
  authorizer_id = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "customers_get" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.customers_get.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_get" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /identity/customers/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.customers_get.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "customers_transition" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.customers_transition.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "customers_transition" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "PATCH /identity/customers/{id}/state"
  target    = "integrations/${aws_apigatewayv2_integration.customers_transition.id}"
  authorizer_id = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

# ─── API GW Integrations + Routes — Inventory ─────────────────────────────────

resource "aws_apigatewayv2_integration" "inventory_list_parts" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.inventory_list_parts.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_parts" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /inventory/parts"
  target    = "integrations/${aws_apigatewayv2_integration.inventory_list_parts.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_create_part" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.inventory_create_part.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_create_part" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "POST /inventory/parts"
  target    = "integrations/${aws_apigatewayv2_integration.inventory_create_part.id}"
  authorizer_id = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_get_part" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.inventory_get_part.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_get_part" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /inventory/parts/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.inventory_get_part.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_vendors" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.inventory_list_vendors.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_vendors" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /inventory/vendors"
  target    = "integrations/${aws_apigatewayv2_integration.inventory_list_vendors.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "inventory_list_lots" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.inventory_list_lots.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "inventory_list_lots" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /inventory/lots"
  target    = "integrations/${aws_apigatewayv2_integration.inventory_list_lots.id}"
  authorization_type = "NONE"
}

# ─── API GW Integrations + Routes — Tickets ───────────────────────────────────

resource "aws_apigatewayv2_integration" "tickets_list_tasks" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.tickets_list_tasks.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_tasks" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /tickets/tasks"
  target    = "integrations/${aws_apigatewayv2_integration.tickets_list_tasks.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_create_task" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.tickets_create_task.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_create_task" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "POST /tickets/tasks"
  target    = "integrations/${aws_apigatewayv2_integration.tickets_create_task.id}"
  authorizer_id = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_transition_task" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.tickets_transition_task.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_transition_task" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "PATCH /tickets/tasks/{id}/transition"
  target    = "integrations/${aws_apigatewayv2_integration.tickets_transition_task.id}"
  authorizer_id = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_rework" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.tickets_list_rework.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_rework" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /tickets/rework"
  target    = "integrations/${aws_apigatewayv2_integration.tickets_list_rework.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_create_rework" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.tickets_create_rework.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_create_rework" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "POST /tickets/rework"
  target    = "integrations/${aws_apigatewayv2_integration.tickets_create_rework.id}"
  authorizer_id = local.authorizer_id
  authorization_type = local.authorizer_id != null ? "JWT" : "NONE"
}

resource "aws_apigatewayv2_integration" "tickets_list_sync" {
  api_id = aws_apigatewayv2_api.erp.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = aws_lambda_function.tickets_list_sync.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "tickets_list_sync" {
  api_id    = aws_apigatewayv2_api.erp.id
  route_key = "GET /tickets/sync"
  target    = "integrations/${aws_apigatewayv2_integration.tickets_list_sync.id}"
  authorization_type = "NONE"
}

# ─── Attachments Lambda Functions ────────────────────────────────────────────

locals {
  lambda_attachments_env = merge(local.lambda_common_env, {
    DOCUMENT_BUCKET_NAME = var.document_bucket_name
  })
}

resource "aws_lambda_function" "attachments_presign_upload" {
  function_name = "${var.name_prefix}-attachments-presign-upload"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "presign-upload.handler"
  filename      = var.attachments_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "attachments_confirm_upload" {
  function_name = "${var.name_prefix}-attachments-confirm-upload"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "confirm-upload.handler"
  filename      = var.attachments_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "attachments_list" {
  function_name = "${var.name_prefix}-attachments-list"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list.handler"
  filename      = var.attachments_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_attachments_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "attachments_presign_download" {
  function_name = "${var.name_prefix}-attachments-presign-download"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "presign-download.handler"
  filename      = var.attachments_lambda_zip_path
  timeout       = 15
  memory_size   = 256
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
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
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
  function_name = "${var.name_prefix}-sop-list"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_get" {
  function_name = "${var.name_prefix}-sop-get"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "get.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_create" {
  function_name = "${var.name_prefix}-sop-create"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_publish_version" {
  function_name = "${var.name_prefix}-sop-publish-version"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "publish-version.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_modules" {
  function_name = "${var.name_prefix}-sop-list-modules"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-modules.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_list_assignments" {
  function_name = "${var.name_prefix}-sop-list-assignments"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-assignments.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "sop_complete_assignment" {
  function_name = "${var.name_prefix}-sop-complete-assignment"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "complete-assignment.handler"
  filename      = var.sop_lambda_zip_path
  timeout       = 15
  memory_size   = 256
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

# ─── Accounting / QuickBooks Lambdas ─────────────────────────────────────────

resource "aws_lambda_function" "accounting_oauth_connect" {
  function_name = "${var.name_prefix}-accounting-oauth-connect"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "oauth-connect.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_oauth_callback" {
  function_name = "${var.name_prefix}-accounting-oauth-callback"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "oauth-callback.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_status" {
  function_name = "${var.name_prefix}-accounting-status"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "status.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_list_sync" {
  function_name = "${var.name_prefix}-accounting-list-sync"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-sync.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_retry_sync" {
  function_name = "${var.name_prefix}-accounting-retry-sync"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "retry-sync.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_trigger_sync" {
  function_name = "${var.name_prefix}-accounting-trigger-sync"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "trigger-sync.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_accounting_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "accounting_webhook" {
  function_name = "${var.name_prefix}-accounting-webhook"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "webhook.handler"
  filename      = var.accounting_lambda_zip_path
  timeout       = 15
  memory_size   = 256
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

# ============================================================
# Migration Admin Lambdas
# ============================================================

resource "aws_lambda_function" "migration_trigger_batch" {
  function_name = "${var.name_prefix}-migration-trigger-batch"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "trigger-batch.handler"
  filename      = var.migration_lambda_zip_path
  timeout       = 30
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}
resource "aws_lambda_function" "migration_list_batches" {
  function_name = "${var.name_prefix}-migration-list-batches"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-batches.handler"
  filename      = var.migration_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}
resource "aws_lambda_function" "migration_get_batch" {
  function_name = "${var.name_prefix}-migration-get-batch"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "get-batch.handler"
  filename      = var.migration_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}
resource "aws_lambda_function" "migration_cancel_batch" {
  function_name = "${var.name_prefix}-migration-cancel-batch"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "cancel-batch.handler"
  filename      = var.migration_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# Long-running migration runner — reads export from S3, runs all ETL waves
resource "aws_lambda_function" "migration_runner" {
  function_name = "${var.name_prefix}-migration-runner"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "run-migration.handler"
  filename      = var.migration_lambda_zip_path
  timeout       = 900
  memory_size   = 1024
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# Parts migration — fetches from ShopMonkey API and runs Waves C/F/G
resource "aws_lambda_function" "migrate_parts" {
  function_name = "${var.name_prefix}-migrate-parts"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "migrate-parts.handler"
  filename      = var.migration_lambda_zip_path
  timeout       = 900
  memory_size   = 1024
  environment { variables = local.lambda_common_env }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

# S3 read/write access for migration artifacts bucket
resource "aws_iam_role_policy" "erp_lambda_s3_migration" {
  count = var.migration_artifacts_bucket_name != "" ? 1 : 0
  name  = "${var.name_prefix}-erp-lambda-s3-migration"
  role  = aws_iam_role.erp_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [
        "arn:aws:s3:::${var.migration_artifacts_bucket_name}",
        "arn:aws:s3:::${var.migration_artifacts_bucket_name}/*"
      ]
    }]
  })
}

# ── Audit context ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "audit_list_events" {
  function_name = "${var.name_prefix}-audit-list-events"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-audit-events.handler"
  filename      = var.audit_lambda_zip_path
  timeout       = 30
  memory_size   = 256
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
  function_name = "${var.name_prefix}-communication-list-channels"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-channels.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_create_channel" {
  function_name = "${var.name_prefix}-communication-create-channel"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create-channel.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_messages" {
  function_name = "${var.name_prefix}-communication-list-messages"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-messages.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_replies" {
  function_name = "${var.name_prefix}-communication-list-replies"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-replies.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_send_message" {
  function_name = "${var.name_prefix}-communication-send-message"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "send-message.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_edit_message" {
  function_name = "${var.name_prefix}-communication-edit-message"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "edit-message.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_delete_message" {
  function_name = "${var.name_prefix}-communication-delete-message"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "delete-message.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_add_reaction" {
  function_name = "${var.name_prefix}-communication-add-reaction"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "add-reaction.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_remove_reaction" {
  function_name = "${var.name_prefix}-communication-remove-reaction"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "remove-reaction.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_todos" {
  function_name = "${var.name_prefix}-communication-list-todos"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-todos.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_create_todo" {
  function_name = "${var.name_prefix}-communication-create-todo"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "create-todo.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_update_todo" {
  function_name = "${var.name_prefix}-communication-update-todo"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "update-todo.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_list_notifications" {
  function_name = "${var.name_prefix}-communication-list-notifications"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "list-notifications.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_common_env }
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }
}

resource "aws_lambda_function" "communication_mark_notifications_read" {
  function_name = "${var.name_prefix}-communication-mark-notifications-read"
  role          = aws_iam_role.erp_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "mark-notifications-read.handler"
  filename      = var.communication_lambda_zip_path
  timeout       = 15
  memory_size   = 256
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
    identity_me           = aws_lambda_function.identity_me
    customers_list        = aws_lambda_function.customers_list
    customers_create      = aws_lambda_function.customers_create
    customers_get         = aws_lambda_function.customers_get
    customers_transition  = aws_lambda_function.customers_transition
    inventory_list_parts  = aws_lambda_function.inventory_list_parts
    inventory_create_part = aws_lambda_function.inventory_create_part
    inventory_get_part    = aws_lambda_function.inventory_get_part
    inventory_list_vendors = aws_lambda_function.inventory_list_vendors
    inventory_list_lots   = aws_lambda_function.inventory_list_lots
    tickets_list_tasks    = aws_lambda_function.tickets_list_tasks
    tickets_create_task   = aws_lambda_function.tickets_create_task
    tickets_transition    = aws_lambda_function.tickets_transition_task
    tickets_list_rework   = aws_lambda_function.tickets_list_rework
    tickets_create_rework = aws_lambda_function.tickets_create_rework
    tickets_list_sync     = aws_lambda_function.tickets_list_sync
    attachments_presign_upload   = aws_lambda_function.attachments_presign_upload
    attachments_confirm_upload   = aws_lambda_function.attachments_confirm_upload
    attachments_list             = aws_lambda_function.attachments_list
    attachments_presign_download = aws_lambda_function.attachments_presign_download
    sop_list                     = aws_lambda_function.sop_list
    sop_get                      = aws_lambda_function.sop_get
    sop_create                   = aws_lambda_function.sop_create
    sop_publish_version          = aws_lambda_function.sop_publish_version
    sop_list_modules             = aws_lambda_function.sop_list_modules
    sop_list_assignments         = aws_lambda_function.sop_list_assignments
    sop_complete_assignment      = aws_lambda_function.sop_complete_assignment
    accounting_oauth_connect     = aws_lambda_function.accounting_oauth_connect
    accounting_oauth_callback    = aws_lambda_function.accounting_oauth_callback
    accounting_status            = aws_lambda_function.accounting_status
    accounting_list_sync         = aws_lambda_function.accounting_list_sync
    accounting_retry_sync        = aws_lambda_function.accounting_retry_sync
    accounting_trigger_sync      = aws_lambda_function.accounting_trigger_sync
    accounting_webhook           = aws_lambda_function.accounting_webhook
    migration_trigger_batch      = aws_lambda_function.migration_trigger_batch
    migration_list_batches       = aws_lambda_function.migration_list_batches
    migration_get_batch          = aws_lambda_function.migration_get_batch
    migration_cancel_batch       = aws_lambda_function.migration_cancel_batch
    communication_list_channels          = aws_lambda_function.communication_list_channels
    communication_create_channel         = aws_lambda_function.communication_create_channel
    communication_list_messages          = aws_lambda_function.communication_list_messages
    communication_list_replies           = aws_lambda_function.communication_list_replies
    communication_send_message           = aws_lambda_function.communication_send_message
    communication_edit_message           = aws_lambda_function.communication_edit_message
    communication_delete_message         = aws_lambda_function.communication_delete_message
    communication_add_reaction           = aws_lambda_function.communication_add_reaction
    communication_remove_reaction        = aws_lambda_function.communication_remove_reaction
    communication_list_todos             = aws_lambda_function.communication_list_todos
    communication_create_todo            = aws_lambda_function.communication_create_todo
    communication_update_todo            = aws_lambda_function.communication_update_todo
    communication_list_notifications     = aws_lambda_function.communication_list_notifications
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
