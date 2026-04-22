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

variable "monitored_lambda_names" {
  type        = list(string)
  default     = []
  description = "Full Lambda function names (including name_prefix) to create CloudWatch alarms + log groups for. If empty, falls back to the legacy short-list."
}

locals {
  # Legacy short list used when no full names are passed in (back-compat for existing state).
  legacy_lambda_short_names = ["work-orders-create", "work-orders-list", "workers"]

  monitored_full_names = length(var.monitored_lambda_names) > 0 ? var.monitored_lambda_names : [
    for short in local.legacy_lambda_short_names : "${var.name_prefix}-${short}"
  ]
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(local.monitored_full_names)
  name              = "/aws/lambda/${each.value}"
  retention_in_days = var.log_retention_days

  tags = {
    Name     = "${each.value}-logs"
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
            for fn in local.monitored_full_names : ["AWS/Lambda", "Errors", "FunctionName", fn]
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
            for fn in local.monitored_full_names : ["AWS/Lambda", "Duration", "FunctionName", fn]
          ]
          view = "timeSeries"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = toset(local.monitored_full_names)
  alarm_name          = "${each.value}-errors"
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
    FunctionName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration_p99" {
  for_each            = toset(local.monitored_full_names)
  alarm_name          = "${each.value}-duration-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 10000 # 10s — if cold start + work exceeds this, investigate
  alarm_description   = "Lambda ${each.value} P99 duration above 10s"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
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
