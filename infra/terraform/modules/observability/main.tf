variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

variable "log_retention_days" {
  type        = number
  default     = 14
  description = "CloudWatch log retention in days (14 for dev, 90 for prod)"
}

variable "api_gateway_id" {
  type        = string
  default     = ""
  description = "API Gateway ID for metrics (optional)"
}

locals {
  lambda_functions = ["work-orders-create", "work-orders-list", "workers"]
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(local.lambda_functions)
  name              = "/aws/lambda/${var.name_prefix}-${each.value}"
  retention_in_days = var.log_retention_days

  tags = {
    Name     = "${var.name_prefix}-${each.value}-logs"
    Function = each.value
  }
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.name_prefix}-erp-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Errors"
          region = data.aws_region.current.name
          period = 300
          stat   = "Sum"
          metrics = [
            for fn in local.lambda_functions : ["AWS/Lambda", "Errors", "FunctionName", "${var.name_prefix}-${fn}"]
          ]
          view = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Duration P99"
          region = data.aws_region.current.name
          period = 300
          stat   = "p99"
          metrics = [
            for fn in local.lambda_functions : ["AWS/Lambda", "Duration", "FunctionName", "${var.name_prefix}-${fn}"]
          ]
          view = "timeSeries"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = toset(local.lambda_functions)
  alarm_name          = "${var.name_prefix}-${each.value}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Lambda ${each.value} error rate too high"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = "${var.name_prefix}-${each.value}"
  }
}

resource "aws_xray_group" "main" {
  group_name        = "${var.name_prefix}-erp"
  filter_expression = "service(\"${var.name_prefix}\")"
}

output "log_group_prefix" {
  value = "/aws/lambda/${var.name_prefix}"
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.main.dashboard_name
}
