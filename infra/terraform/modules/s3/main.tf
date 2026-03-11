variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

locals {
  buckets = {
    documents           = "${var.name_prefix}-documents"
    migration_artifacts = "${var.name_prefix}-migration-artifacts"
    lambda_artifacts    = "${var.name_prefix}-lambda-artifacts"
  }
}

resource "aws_s3_bucket" "buckets" {
  for_each = local.buckets
  bucket   = each.value

  tags = {
    Name    = each.value
    Purpose = each.key
  }
}

resource "aws_s3_bucket_versioning" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "buckets" {
  for_each                = local.buckets
  bucket                  = aws_s3_bucket.buckets[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.buckets["documents"].id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

output "document_bucket_name" {
  value = aws_s3_bucket.buckets["documents"].bucket
}

output "document_bucket_arn" {
  value = aws_s3_bucket.buckets["documents"].arn
}

output "migration_bucket_name" {
  value = aws_s3_bucket.buckets["migration_artifacts"].bucket
}

output "migration_bucket_arn" {
  value = aws_s3_bucket.buckets["migration_artifacts"].arn
}

output "lambda_artifacts_bucket_name" {
  value = aws_s3_bucket.buckets["lambda_artifacts"].bucket
}

output "lambda_artifacts_bucket_arn" {
  value = aws_s3_bucket.buckets["lambda_artifacts"].arn
}
