variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

resource "aws_cloudwatch_log_group" "planner" {
  name              = "/aws/states/${var.name_prefix}-build-planner"
  retention_in_days = 14

  tags = {
    Name = "${var.name_prefix}-build-planner-logs"
  }
}

resource "aws_iam_role" "step_functions" {
  name = "${var.name_prefix}-step-functions-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "step_functions_logs" {
  name = "${var.name_prefix}-step-functions-logs"
  role = aws_iam_role.step_functions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogDelivery",
        "logs:CreateLogStream",
        "logs:GetLogDelivery",
        "logs:UpdateLogDelivery",
        "logs:DeleteLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutLogEvents",
        "logs:PutResourcePolicy",
        "logs:DescribeResourcePolicies",
        "logs:DescribeLogGroups"
      ]
      Resource = "*"
    }]
  })
}

# Stub ASL - full build-planner logic added in Phase 2
resource "aws_sfn_state_machine" "build_planner" {
  name     = "${var.name_prefix}-build-planner"
  role_arn = aws_iam_role.step_functions.arn
  type     = "EXPRESS"

  definition = jsonencode({
    Comment = "Build Planner State Machine (stub - Phase 2 implementation)"
    StartAt = "PlaceholderState"
    States = {
      PlaceholderState = {
        Type = "Pass"
        Result = {
          status  = "stub"
          message = "Build planner not yet implemented"
        }
        End = true
      }
    }
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.planner.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }
}

output "planner_state_machine_name" {
  value = aws_sfn_state_machine.build_planner.name
}

output "planner_state_machine_arn" {
  value = aws_sfn_state_machine.build_planner.arn
}
