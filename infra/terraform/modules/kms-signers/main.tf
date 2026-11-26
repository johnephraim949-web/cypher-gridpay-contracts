variable "name" { type = string }
variable "signers" {
  description = "Signer names, e.g. relayer, ttl-keeper, oracle-updater"
  type        = list(string)
  default     = ["relayer", "ttl-keeper", "oracle-updater"]
}
variable "signer_role_arns" {
  description = "Map of signer name => IAM role ARN allowed to use that key (kms:Sign / GetPublicKey only)"
  type        = map(string)
}
variable "admin_role_arn" {
  description = "IAM role that administers (not uses) the keys"
  type        = string
}

data "aws_caller_identity" "current" {}

# Stellar uses ed25519. AWS KMS does not offer ED25519 signing in all regions/accounts; the
# default below is ECC_NIST_P256 as a placeholder and MUST be reviewed: use a key spec your
# signer integration supports (e.g. an ed25519-capable HSM/signing service) before production.
variable "key_spec" {
  type    = string
  default = "ECC_NIST_P256"
}

resource "aws_kms_key" "signer" {
  for_each                 = toset(var.signers)
  description              = "${var.name} ${each.key} signer"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = var.key_spec
  enable_key_rotation      = false # rotation is unsupported for asymmetric keys
  deletion_window_in_days  = 30

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Admin"
        Effect    = "Allow"
        Principal = { AWS = var.admin_role_arn }
        Action    = ["kms:Describe*", "kms:Get*", "kms:List*", "kms:TagResource", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion", "kms:PutKeyPolicy"]
        Resource  = "*"
      },
      {
        Sid       = "SignOnly"
        Effect    = "Allow"
        Principal = { AWS = var.signer_role_arns[each.key] }
        Action    = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
        Resource  = "*"
      }
    ]
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "signer" {
  for_each      = aws_kms_key.signer
  name          = "alias/${var.name}-${each.key}"
  target_key_id = each.value.key_id
}

output "key_arns" { value = { for k, v in aws_kms_key.signer : k => v.arn } }
