variable "name_prefix" {
  description = "Prefix applied to resource names"
  type        = string
}

variable "lambda_zip_path" {
  description = "Path to the zipped auth (Cognito triggers) Lambda artifact."
  type        = string
  default     = "apps/api/dist/auth-lambda.zip"
}

variable "allowed_email_domain" {
  description = "Email domain that the PreSignUp trigger restricts federated sign-ins to. Empty disables the check."
  type        = string
  default     = "golfingarage.com"
}

variable "sentry_dsn" {
  description = "Sentry DSN injected into the Lambda. Leave empty to disable."
  type        = string
  default     = ""
  sensitive   = true
}

# Intentionally NO `cognito_user_pool_arn` input here. The aws_lambda_permission
# that grants Cognito invocation rights lives at the env level, not in this
# module — otherwise module.cognito (which needs this module's Lambda ARN for
# its lambda_config) and this module would form a dependency cycle.

resource "aws_iam_role" "this" {
  name = "${var.name_prefix}-auth-trigger-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "pre_signup" {
  function_name    = "${var.name_prefix}-auth-pre-signup"
  role             = aws_iam_role.this.arn
  runtime          = "nodejs20.x"
  handler          = "pre-signup.handler"
  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)
  timeout          = 5
  memory_size      = 128

  environment {
    variables = {
      NODE_ENV             = "production"
      SENTRY_DSN           = var.sentry_dsn
      ALLOWED_EMAIL_DOMAIN = var.allowed_email_domain
    }
  }
}

output "pre_signup_lambda_arn" {
  value = aws_lambda_function.pre_signup.arn
}

output "pre_signup_lambda_name" {
  value = aws_lambda_function.pre_signup.function_name
}
