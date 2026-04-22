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

variable "qb_invoice_sync_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the QB invoice sync Lambda for work_order.completed events"
}

variable "qb_customer_sync_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the QB customer sync Lambda for customer.created / customer.updated events"
}

variable "outbox_publisher_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the outbox publisher Lambda invoked on a 1-minute schedule"
}

variable "enable_outbox_publisher_schedule" {
  type        = bool
  default     = false
  description = "When true, creates the 1-minute EventBridge rule that invokes outbox_publisher_lambda_arn. Decoupled from the ARN so count is known at plan time (the ARN of a not-yet-created Lambda is unknown until apply)."
}

variable "enable_qb_invoice_sync_rule" {
  type        = bool
  default     = false
  description = "When true, creates the work_order.completed rule that targets qb_invoice_sync_lambda_arn."
}

variable "enable_qb_customer_sync_rule" {
  type        = bool
  default     = false
  description = "When true, creates the customer.created/updated rule that targets qb_customer_sync_lambda_arn."
}

# ─── EventBridge Rules — QB Invoice Sync (work_order.completed) ───────────────

resource "aws_cloudwatch_event_rule" "work_order_completed" {
  count         = var.enable_qb_invoice_sync_rule ? 1 : 0
  name          = "${var.name_prefix}-work-order-completed"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  description   = "Routes work_order.completed events to the QB invoice sync Lambda"

  event_pattern = jsonencode({
    source      = ["gg-erp"]
    detail-type = ["work_order.completed"]
  })

  tags = {
    Name = "${var.name_prefix}-work-order-completed"
  }
}

resource "aws_cloudwatch_event_target" "qb_invoice_sync" {
  count          = var.enable_qb_invoice_sync_rule ? 1 : 0
  rule           = aws_cloudwatch_event_rule.work_order_completed[0].name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = var.qb_invoice_sync_lambda_arn
  target_id      = "${var.name_prefix}-qb-invoice-sync"

  dead_letter_config {
    arn = aws_sqs_queue.dlq.arn
  }
}

resource "aws_lambda_permission" "allow_eventbridge_qb_invoice_sync" {
  count         = var.enable_qb_invoice_sync_rule ? 1 : 0
  statement_id  = "AllowEventBridgeInvokeQbInvoiceSync"
  action        = "lambda:InvokeFunction"
  function_name = var.qb_invoice_sync_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.work_order_completed[0].arn
}

# ─── EventBridge Rules — QB Customer Sync (customer.created / customer.updated)

resource "aws_cloudwatch_event_rule" "customer_changed" {
  count         = var.enable_qb_customer_sync_rule ? 1 : 0
  name          = "${var.name_prefix}-customer-changed"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  description   = "Routes customer.created and customer.updated events to the QB customer sync Lambda"

  event_pattern = jsonencode({
    source      = ["gg-erp"]
    detail-type = ["customer.created", "customer.updated"]
  })

  tags = {
    Name = "${var.name_prefix}-customer-changed"
  }
}

resource "aws_cloudwatch_event_target" "qb_customer_sync" {
  count          = var.enable_qb_customer_sync_rule ? 1 : 0
  rule           = aws_cloudwatch_event_rule.customer_changed[0].name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = var.qb_customer_sync_lambda_arn
  target_id      = "${var.name_prefix}-qb-customer-sync"

  dead_letter_config {
    arn = aws_sqs_queue.dlq.arn
  }
}

resource "aws_lambda_permission" "allow_eventbridge_qb_customer_sync" {
  count         = var.enable_qb_customer_sync_rule ? 1 : 0
  statement_id  = "AllowEventBridgeInvokeQbCustomerSync"
  action        = "lambda:InvokeFunction"
  function_name = var.qb_customer_sync_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.customer_changed[0].arn
}

# ─── EventBridge Schedule — Outbox Publisher (rate 1 minute) ──────────────────

resource "aws_cloudwatch_event_rule" "outbox_publisher_schedule" {
  count               = var.outbox_publisher_lambda_arn != "" ? 1 : 0
  name                = "${var.name_prefix}-outbox-publisher-schedule"
  schedule_expression = "rate(1 minute)"
  description         = "Triggers the outbox publisher Lambda every minute to flush pending events"

  tags = {
    Name = "${var.name_prefix}-outbox-publisher-schedule"
  }
}

resource "aws_cloudwatch_event_target" "outbox_publisher" {
  count     = var.enable_outbox_publisher_schedule ? 1 : 0
  rule      = aws_cloudwatch_event_rule.outbox_publisher_schedule[0].name
  arn       = var.outbox_publisher_lambda_arn
  target_id = "${var.name_prefix}-outbox-publisher"
}

resource "aws_lambda_permission" "allow_eventbridge_outbox_publisher" {
  count         = var.enable_outbox_publisher_schedule ? 1 : 0
  statement_id  = "AllowEventBridgeInvokeOutboxPublisher"
  action        = "lambda:InvokeFunction"
  function_name = var.outbox_publisher_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.outbox_publisher_schedule[0].arn
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

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
