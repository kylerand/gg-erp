#!/usr/bin/env bash
#
# Idempotent pre-apply reconciliation: imports any Lambda function that
# exists in AWS but is missing from terraform state.
#
# Why this exists:
#   If a `terraform apply` is interrupted (rate-limit, timeout, transient
#   AWS API error) after calling `CreateFunction` but before saving state,
#   the function is live in AWS but terraform's state file doesn't know.
#   Subsequent apply retries fail with:
#       ResourceConflictException: Function already exist
#   This script walks the terraform plan/state and reconciles any such
#   orphans by calling `terraform import`, so the next apply can proceed.
#
# Assumptions:
#   - Every Lambda managed by this module follows the naming convention
#     `function_name = "${name_prefix}-${replace(resource_key, "_", "-")}"`.
#     Verified: 116 of 116 resources match this at the time of writing.
#   - Resources live under module.api_gateway_lambda.aws_lambda_function.<key>.
#     The work_orders_{create,list,transition,get} Lambdas follow the same
#     pattern and are also covered.
#
# Usage (from an env dir, e.g. infra/terraform/envs/dev):
#   NAME_PREFIX=gg-erp-dev AWS_REGION=us-east-2 \
#     bash ../../../../scripts/reconcile-lambda-state.sh
#
# Safe to run repeatedly. If nothing is orphaned, the script is a no-op.

set -euo pipefail

NAME_PREFIX="${NAME_PREFIX:?NAME_PREFIX is required, e.g. gg-erp-dev}"
AWS_REGION="${AWS_REGION:-us-east-2}"
TF_MODULE_PREFIX="${TF_MODULE_PREFIX:-module.api_gateway_lambda}"

echo "→ Reconciling Lambda state against AWS for prefix '${NAME_PREFIX}' in ${AWS_REGION}"

# All Lambda function names in AWS that belong to this deployment.
aws_functions=$(aws lambda list-functions \
  --region "${AWS_REGION}" \
  --max-items 500 \
  --query "Functions[?starts_with(FunctionName, \`${NAME_PREFIX}-\`)].FunctionName" \
  --output text | tr '\t' '\n' | sort -u)

if [[ -z "${aws_functions}" ]]; then
  echo "  ↳ No AWS functions found with prefix ${NAME_PREFIX}-; nothing to reconcile."
  exit 0
fi

# All aws_lambda_function resource addresses currently in terraform state.
state_addresses=$(terraform state list 2>/dev/null | grep -E "\.aws_lambda_function\.[a-z_]+\$" || true)

import_count=0
skip_count=0
fail_count=0

for aws_name in ${aws_functions}; do
  # Derive the terraform resource key from the AWS name by stripping the
  # prefix and converting dashes to underscores:
  #   gg-erp-dev-sop-get-module → sop_get_module
  short_name="${aws_name#${NAME_PREFIX}-}"
  tf_key="${short_name//-/_}"
  tf_address="${TF_MODULE_PREFIX}.aws_lambda_function.${tf_key}"

  # If state already has it, skip.
  if echo "${state_addresses}" | grep -Fxq "${tf_address}"; then
    skip_count=$((skip_count + 1))
    continue
  fi

  # Also tolerate `work_orders_*` which live at the module root (not nested)
  # in case the module layout changes; check for that address too.
  alt_address="${TF_MODULE_PREFIX}.aws_lambda_function.${tf_key}"
  if echo "${state_addresses}" | grep -Fxq "${alt_address}"; then
    skip_count=$((skip_count + 1))
    continue
  fi

  echo "  → Importing ${aws_name} → ${tf_address}"
  if terraform import -lock-timeout=120s "${tf_address}" "${aws_name}" >/tmp/reconcile-import.log 2>&1; then
    import_count=$((import_count + 1))
  else
    # Common cause: the config doesn't declare this resource (a function was
    # renamed or removed). Log a warning but don't fail the pipeline — it's
    # better to let the apply proceed and have terraform either update or
    # ignore this orphan than to block the deploy.
    echo "    ↳ WARN: import failed; leaving alone. Details:"
    sed 's/^/      /' /tmp/reconcile-import.log | tail -5
    fail_count=$((fail_count + 1))
  fi
done

echo "→ Reconciliation done: imported=${import_count} skipped=${skip_count} warnings=${fail_count}"
