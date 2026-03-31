variable "github_org" {
  type        = string
  default     = "kylerand"
  description = "GitHub organization name"
}

variable "github_repo" {
  type        = string
  default     = "gg-erp"
  description = "GitHub repository name"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.name_prefix}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/main",
            "repo:${var.github_org}/${var.github_repo}:environment:*"
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions_terraform" {
  name = "${var.name_prefix}-github-actions-terraform"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = [
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket",
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"
        ]
        Resource = [
          "arn:aws:s3:::${var.name_prefix}-terraform-state",
          "arn:aws:s3:::${var.name_prefix}-terraform-state/*",
          "arn:aws:dynamodb:*:*:table/${var.name_prefix}-terraform-locks"
        ]
      },
      {
        Sid    = "InfraManagement"
        Effect = "Allow"
        Action = [
          "lambda:*",
          "apigateway:*",
          "cognito-idp:*",
          "rds:*",
          "ec2:*",
          "events:*",
          "states:*",
          "amplify:*",
          "logs:*",
          "cloudwatch:*",
          "xray:*",
          "sqs:*",
          "sns:*",
          "kms:*",
          "iam:GetRole", "iam:GetRolePolicy", "iam:CreateRole", "iam:DeleteRole",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy",
          "iam:DetachRolePolicy", "iam:PassRole", "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole",
          "iam:GetPolicy", "iam:ListPolicyVersions",
          "iam:CreateServiceLinkedRole"
        ]
        Resource = "*"
      },
      {
        Sid    = "S3Artifacts"
        Effect = "Allow"
        Action = ["s3:*"]
        Resource = [
          "arn:aws:s3:::${var.name_prefix}-*",
          "arn:aws:s3:::${var.name_prefix}-*/*"
        ]
      },
      {
        Sid    = "SecretsAndSSM"
        Effect = "Allow"
        Action = [
          "secretsmanager:*",
          "ssm:*"
        ]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}
