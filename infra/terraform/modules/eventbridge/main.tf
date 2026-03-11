variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

variable "archive_retention_days" {
  type        = number
  default     = 30
  description = "Days to retain archived events (30 for dev, 365 for prod)"
}

variable "worker_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of worker Lambda for work_order_created events (optional)"
}

resource "aws_cloudwatch_event_bus" "main" {
  name = "${var.name_prefix}-erp-events"

  tags = {
    Name = "${var.name_prefix}-erp-events"
  }
}

resource "aws_cloudwatch_event_archive" "main" {
  name             = "${var.name_prefix}-erp-archive"
  event_source_arn = aws_cloudwatch_event_bus.main.arn
  retention_days   = var.archive_retention_days
}

resource "aws_sqs_queue" "dlq" {
  name                       = "${var.name_prefix}-erp-events-dlq"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 300

  tags = {
    Name = "${var.name_prefix}-erp-events-dlq"
  }
}

resource "aws_sqs_queue_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.dlq.arn
      Condition = {
        ArnEquals = {
          "aws:SourceArn" = aws_cloudwatch_event_bus.main.arn
        }
      }
    }]
  })
}

output "event_bus_name" {
  value = aws_cloudwatch_event_bus.main.name
}

output "event_bus_arn" {
  value = aws_cloudwatch_event_bus.main.arn
}

output "dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  value = aws_sqs_queue.dlq.arn
}
