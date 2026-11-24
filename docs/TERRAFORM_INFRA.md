# Terraform Infrastructure (AWS)

Layout: `infra/terraform/modules/{networking,soroban-rpc,data-plane,kms-signers}` and `infra/terraform/envs/{staging,production}`.

## Bootstrap
1. Create an S3 bucket (versioned, encrypted) and a DynamoDB table with hash key `LockID` for state locking; replace the `REPLACE-*` names in each `envs/*/main.tf` backend block.
2. Create IAM roles for the admin and for each signer (relayer, ttl-keeper, oracle-updater); pass them via an untracked `*.tfvars` (`admin_role_arn`, `signer_role_arns`, `rpc_ami_id`).
3. `cd infra/terraform/envs/staging && terraform init && terraform plan`.

## Safety
- `prevent_destroy` on Postgres, KMS signer keys and the data KMS key; Postgres has deletion protection, PITR retention and a managed master password (Secrets Manager).
- Soroban RPC (8000) and admin/metrics (8001) ports allow only the VPC CIDR.

## Not covered / needs maintainer review
- Nothing was run (no fmt, validate, tflint, checkov, plan); expect fixes.
- GCP (Cloud KMS, GCS state) is NOT implemented; AWS only.
- WAF and TLS termination (issue's `networking` scope) are not included; only VPC, subnets, NAT.
- KMS key spec: AWS KMS lacks native Stellar ed25519 signing; the default `ECC_NIST_P256` is a placeholder and needs a design decision.
- The RPC node `user_data` is a minimal container start; NVMe mounting, stellar-core/RPC config and snapshot syncing are not implemented. Pin the AMI and image.
- No real secrets; remote-state bucket names are placeholders.
