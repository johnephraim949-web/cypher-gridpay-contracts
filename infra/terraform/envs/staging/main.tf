terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Remote state with locking. Bootstrap the bucket/table first (see docs/TERRAFORM_INFRA.md).
  backend "s3" {
    bucket         = "REPLACE-gridpay-tfstate"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "REPLACE-gridpay-tflock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "rpc_ami_id" { type = string }
variable "admin_role_arn" { type = string }
variable "signer_role_arns" { type = map(string) }

locals {
  name = "gridpay-staging"
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_kms_key" "data" {
  description         = "${local.name} data-at-rest"
  enable_key_rotation = true
  lifecycle {
    prevent_destroy = true
  }
}

module "networking" {
  source = "../../modules/networking"
  name   = local.name
  cidr   = "10.20.0.0/16"
  azs    = slice(data.aws_availability_zones.available.names, 0, 2)
}

module "soroban_rpc" {
  source    = "../../modules/soroban-rpc"
  name      = "${local.name}-rpc"
  vpc_id    = module.networking.vpc_id
  vpc_cidr  = module.networking.vpc_cidr
  subnet_id = module.networking.private_subnet_ids[0]
  ami_id    = var.rpc_ami_id
  network   = "testnet"
}

module "data_plane" {
  source      = "../../modules/data-plane"
  name        = local.name
  vpc_id      = module.networking.vpc_id
  vpc_cidr    = module.networking.vpc_cidr
  subnet_ids  = module.networking.private_subnet_ids
  kms_key_arn = aws_kms_key.data.arn
}

module "kms_signers" {
  source           = "../../modules/kms-signers"
  name             = local.name
  signer_role_arns = var.signer_role_arns
  admin_role_arn   = var.admin_role_arn
}

output "soroban_rpc_url" { value = module.soroban_rpc.rpc_url }
output "postgres_endpoint" { value = module.data_plane.postgres_endpoint }
output "redis_endpoint" { value = module.data_plane.redis_primary_endpoint }
output "signer_key_arns" { value = module.kms_signers.key_arns }
