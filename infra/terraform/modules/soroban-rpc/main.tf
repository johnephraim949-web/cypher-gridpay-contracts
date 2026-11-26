variable "name" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "subnet_id" { type = string }
variable "instance_type" {
  description = "Instance type with local NVMe (i4i/i3en family recommended)"
  type        = string
  default     = "i4i.2xlarge"
}
variable "ami_id" {
  description = "AMI with Docker; supplied by the operator"
  type        = string
}
variable "network" {
  description = "testnet or mainnet"
  type        = string
  default     = "testnet"
  validation {
    condition     = contains(["testnet", "mainnet"], var.network)
    error_message = "network must be testnet or mainnet."
  }
}
variable "rpc_image" {
  description = "Soroban RPC image; pin a tag or digest"
  type        = string
  default     = "stellar/stellar-rpc:latest"
}

# RPC (8000), admin/metrics (8001) reachable ONLY from inside the VPC CIDR.
resource "aws_security_group" "rpc" {
  name_prefix = "${var.name}-rpc-"
  vpc_id      = var.vpc_id

  ingress {
    description = "Soroban RPC from VPC only"
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  ingress {
    description = "Admin/metrics from VPC only"
    from_port   = 8001
    to_port     = 8001
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    description = "Stellar network peers and history archives"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"] # tflint/checkov: required to reach public Stellar peers
  }
}

resource "aws_instance" "rpc" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.rpc.id]
  monitoring             = true
  ebs_optimized          = true

  metadata_options {
    http_tokens = "required"
  }
  root_block_device {
    encrypted = true
  }

  # NOTE: snapshot syncing is delegated to the container's catch-up from history archives.
  # Local NVMe formatting/mounting and the exact container config are NOT implemented here.
  user_data = <<-EOT
    #!/bin/bash
    docker run -d --restart=always --name soroban-rpc \
      -p 8000:8000 -p 8001:8001 ${var.rpc_image}
  EOT

  tags = { Name = var.name, Network = var.network }
}

output "private_ip" { value = aws_instance.rpc.private_ip }
output "rpc_url" { value = "http://${aws_instance.rpc.private_ip}:8000" }
