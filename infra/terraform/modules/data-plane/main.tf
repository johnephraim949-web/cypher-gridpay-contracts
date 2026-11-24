variable "name" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "subnet_ids" { type = list(string) }
variable "kms_key_arn" {
  description = "KMS key ARN for encryption at rest"
  type        = string
}
variable "db_instance_class" {
  type    = string
  default = "db.m6g.large"
}
variable "redis_node_type" {
  type    = string
  default = "cache.m6g.large"
}
variable "prevent_destroy_note" {
  description = "Documentation only: prevent_destroy is hard-coded on the database"
  type        = string
  default     = "lifecycle.prevent_destroy is enabled on aws_db_instance.postgres"
}

resource "aws_security_group" "data" {
  name_prefix = "${var.name}-data-"
  vpc_id      = var.vpc_id
  ingress {
    description = "Postgres from VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  ingress {
    description = "Redis from VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier                  = "${var.name}-postgres"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = var.db_instance_class
  allocated_storage           = 100
  storage_encrypted           = true
  kms_key_id                  = var.kms_key_arn
  multi_az                    = true
  backup_retention_period     = 14 # enables point-in-time recovery
  deletion_protection         = true
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [aws_security_group.data.id]
  username                    = "gridpay"
  manage_master_user_password = true # password lives in Secrets Manager, never in state/values
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.name}-postgres-final"
  performance_insights_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.name}-redis"
  description                = "GridPay indexer state, webhook queues, rate limits"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.data.id]
}

output "postgres_endpoint" { value = aws_db_instance.postgres.endpoint }
output "postgres_master_secret_arn" { value = aws_db_instance.postgres.master_user_secret[0].secret_arn }
output "redis_primary_endpoint" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
