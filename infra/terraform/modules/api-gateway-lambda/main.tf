variable "name_prefix" { type = string }

variable "work_orders_lambda_zip_path" {
  description = "Path to the zipped work-orders Lambda artifact."
  type        = string
  default     = "apps/api/dist/work-orders-lambda.zip"
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
    }
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
    }
  }
}

resource "aws_apigatewayv2_api" "erp" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"
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

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.erp.id
  name        = "$default"
  auto_deploy = true
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
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "work_orders_create_lambda_name" {
  value = aws_lambda_function.work_orders_create.function_name
}

output "work_orders_list_lambda_name" {
  value = aws_lambda_function.work_orders_list.function_name
}
