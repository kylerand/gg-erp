terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

variable "db_name" {
  type        = string
  default     = "gg_erp"
  description = "Initial database name"
}

variable "db_username" {
  type        = string
  default     = "erp_admin"
  description = "Master database username"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the Aurora cluster"
}

variable "security_group_id" {
  type        = string
  description = "Security group ID for Aurora"
}

variable "min_acu" {
  type        = number
  default     = 0.5
  description = "Minimum Aurora Capacity Units (serverless v2)"
}

variable "max_acu" {
  type        = number
  default     = 16
  description = "Maximum Aurora Capacity Units"
}

variable "deletion_protection" {
  type        = bool
  default     = false
  description = "Enable deletion protection (set true for prod)"
}

resource "random_password" "db_master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db_master" {
  name                    = "/${var.name_prefix}/db/master-credentials"
  description             = "Aurora master credentials for ${var.name_prefix}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id = aws_secretsmanager_secret.db_master.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_master.result
    dbname   = var.db_name
    engine   = "aurora-postgresql"
    host     = aws_rds_cluster.main.endpoint
    port     = 5432
    url      = "postgresql://${var.db_username}:${urlencode(random_password.db_master.result)}@${aws_rds_cluster.main.endpoint}:5432/${var.db_name}"
  })

  depends_on = [aws_rds_cluster.main]
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-aurora-subnets"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.name_prefix}-aurora-subnet-group"
  }
}

resource "aws_rds_cluster" "main" {
  cluster_identifier     = "${var.name_prefix}-aurora"
  engine                 = "aurora-postgresql"
  engine_version         = "15.8"
  database_name          = var.db_name
  master_username        = var.db_username
  master_password        = random_password.db_master.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]
  deletion_protection    = var.deletion_protection
  skip_final_snapshot    = !var.deletion_protection
  storage_encrypted      = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.main.name

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = {
    Name = "${var.name_prefix}-aurora-cluster"
  }
}

resource "aws_rds_cluster_parameter_group" "main" {
  name   = "${var.name_prefix}-aurora-pg15"
  family = "aurora-postgresql15"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier          = "${var.name_prefix}-aurora-writer"
  cluster_identifier  = aws_rds_cluster.main.id
  instance_class      = "db.serverless"
  engine              = aws_rds_cluster.main.engine
  engine_version      = aws_rds_cluster.main.engine_version
  publicly_accessible = false

  tags = {
    Name = "${var.name_prefix}-aurora-writer"
  }
}

output "cluster_identifier" {
  value = aws_rds_cluster.main.cluster_identifier
}

output "cluster_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "cluster_port" {
  value = aws_rds_cluster.main.port
}

output "master_secret_arn" {
  value = aws_secretsmanager_secret.db_master.arn
}

output "database_url" {
  description = "Full PostgreSQL connection URL — use as DATABASE_URL env var in Lambda"
  value       = jsondecode(aws_secretsmanager_secret_version.db_master.secret_string).url
  sensitive   = true
}

output "db_name" {
  value = var.db_name
}
