#!/usr/bin/env python3
"""
Idempotent pre-apply reconciliation: imports AWS resources that exist in the
cloud but are missing from terraform state.

Handles four resource types that all bite the same way (non-atomic apply ⇒
orphans that fail future applies with 409 / AlreadyExistsException):

  1. aws_lambda_function                — derived by name convention
  2. aws_apigatewayv2_integration       — derived from config + integration_uri
  3. aws_apigatewayv2_route             — derived from config's route_key
  4. aws_cloudwatch_log_group (Lambda)  — auto-created by CloudWatch on first
                                          Lambda log, almost always exists before
                                          terraform tries to CreateLogGroup

Every lambda-facing resource in this codebase uses the convention
  function_name = "${name_prefix}-${replace(resource_key, "_", "-")}"
and routes/integrations are declared with a resource_key that mirrors the
lambda's. We lean on that.

Usage (from an env dir):
    NAME_PREFIX=gg-erp-dev AWS_REGION=us-east-2 \\
        python3 ../../../../scripts/reconcile-aws-state.py

Safe to run repeatedly. No-op when state is clean. Individual import failures
warn but don't fail the script — a renamed-then-undeclared resource shouldn't
block a deploy.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

NAME_PREFIX = os.environ.get("NAME_PREFIX")
if not NAME_PREFIX:
    sys.exit("NAME_PREFIX is required, e.g. gg-erp-dev")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-2")

# Path to the module source (for parsing route_key + integration_uri declarations).
# Defaults to the canonical layout; override with TF_MODULE_PATH if needed.
DEFAULT_MODULE_PATH = Path(__file__).parent.parent / "infra" / "terraform" / "modules" / "api-gateway-lambda" / "main.tf"
TF_MODULE_PATH = Path(os.environ.get("TF_MODULE_PATH", DEFAULT_MODULE_PATH))

TF_MODULE_PREFIX = os.environ.get("TF_MODULE_PREFIX", "module.api_gateway_lambda")


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def aws(args: list[str]) -> dict | list | str:
    """Run aws cli with region, return parsed JSON or raw text."""
    full = ["aws", "--region", AWS_REGION, *args]
    result = run(full, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args)} failed: {result.stderr.strip()}")
    out = result.stdout.strip()
    if not out:
        return {}
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


def tf_state_list() -> set[str]:
    """All resource addresses currently in terraform state."""
    result = run(["terraform", "state", "list"], check=False)
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def tf_import(address: str, resource_id: str) -> bool:
    """Run terraform import; return True on success."""
    print(f"  → Importing {address} ← {resource_id}")
    result = run(["terraform", "import", "-lock-timeout=120s", address, resource_id], check=False)
    if result.returncode != 0:
        tail = "\n      ".join(result.stderr.strip().splitlines()[-5:])
        print(f"    ↳ WARN: import failed; leaving alone.\n      {tail}")
        return False
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Resource-specific reconcilers
# ─────────────────────────────────────────────────────────────────────────────

def reconcile_lambdas(state: set[str]) -> tuple[int, int, int]:
    """Import any AWS Lambda function matching NAME_PREFIX- that's not in state."""
    print(f"→ Reconciling Lambda functions (prefix='{NAME_PREFIX}-')")
    data = aws(["lambda", "list-functions", "--max-items", "500"])
    functions = data.get("Functions", []) if isinstance(data, dict) else []
    names = sorted(
        f["FunctionName"] for f in functions
        if f.get("FunctionName", "").startswith(f"{NAME_PREFIX}-")
    )
    imported = skipped = failed = 0
    for aws_name in names:
        tf_key = aws_name.removeprefix(f"{NAME_PREFIX}-").replace("-", "_")
        address = f"{TF_MODULE_PREFIX}.aws_lambda_function.{tf_key}"
        if address in state:
            skipped += 1
            continue
        if tf_import(address, aws_name):
            imported += 1
            state.add(address)
        else:
            failed += 1
    print(f"  imported={imported} skipped={skipped} warnings={failed}")
    return imported, skipped, failed


def find_api_id() -> str | None:
    """Return the API Gateway v2 ID for this deployment."""
    data = aws(["apigatewayv2", "get-apis"])
    if not isinstance(data, dict):
        return None
    for api in data.get("Items", []):
        if api.get("Name", "").startswith(NAME_PREFIX):
            return api["ApiId"]
    return None


# Matches declarations of the form:
#   resource "aws_apigatewayv2_route" "<key>" {
#       route_key = "<route_key>"
# across whitespace/newlines. Captures (key, route_key).
ROUTE_RE = re.compile(
    r'resource\s+"aws_apigatewayv2_route"\s+"(?P<key>\w+)"\s*\{[^}]*?route_key\s*=\s*"(?P<route_key>[^"]+)"',
    re.DOTALL,
)

# Matches declarations of the form:
#   resource "aws_apigatewayv2_integration" "<key>" {
#       integration_uri = aws_lambda_function.<lambda>.invoke_arn
INTEGRATION_RE = re.compile(
    r'resource\s+"aws_apigatewayv2_integration"\s+"(?P<key>\w+)"\s*\{[^}]*?integration_uri\s*=\s*aws_lambda_function\.(?P<lambda>\w+)\.invoke_arn',
    re.DOTALL,
)


def parse_tf_config() -> tuple[dict[str, str], dict[str, str]]:
    """
    Parse main.tf and return two mappings:
      routes:       route_key → terraform resource key
      integrations: lambda_name → terraform integration resource key
    """
    if not TF_MODULE_PATH.exists():
        print(f"  ↳ WARN: module file not found at {TF_MODULE_PATH}")
        return {}, {}
    src = TF_MODULE_PATH.read_text()
    routes = {m.group("route_key"): m.group("key") for m in ROUTE_RE.finditer(src)}
    integrations = {m.group("lambda"): m.group("key") for m in INTEGRATION_RE.finditer(src)}
    return routes, integrations


def reconcile_routes(api_id: str, state: set[str], route_key_to_tf_key: dict[str, str]) -> tuple[int, int, int]:
    print(f"→ Reconciling API Gateway routes (api={api_id})")
    imported = skipped = failed = 0
    aws_routes: list[dict] = []
    next_token: str | None = None
    while True:
        args = ["apigatewayv2", "get-routes", "--api-id", api_id, "--max-results", "500"]
        if next_token:
            args += ["--next-token", next_token]
        page = aws(args)
        if not isinstance(page, dict):
            break
        aws_routes.extend(page.get("Items", []))
        next_token = page.get("NextToken")
        if not next_token:
            break

    for route in aws_routes:
        route_key = route.get("RouteKey", "")
        route_id = route.get("RouteId", "")
        tf_key = route_key_to_tf_key.get(route_key)
        if not tf_key:
            continue  # route exists in AWS but not declared in terraform — leave alone
        address = f'{TF_MODULE_PREFIX}.aws_apigatewayv2_route.{tf_key}'
        if address in state:
            skipped += 1
            continue
        if tf_import(address, f"{api_id}/{route_id}"):
            imported += 1
            state.add(address)
        else:
            failed += 1
    print(f"  imported={imported} skipped={skipped} warnings={failed}")
    return imported, skipped, failed


def reconcile_integrations(api_id: str, state: set[str], lambda_to_tf_key: dict[str, str]) -> tuple[int, int, int]:
    print(f"→ Reconciling API Gateway integrations (api={api_id})")
    imported = skipped = failed = 0
    aws_integrations: list[dict] = []
    next_token: str | None = None
    while True:
        args = ["apigatewayv2", "get-integrations", "--api-id", api_id, "--max-results", "500"]
        if next_token:
            args += ["--next-token", next_token]
        page = aws(args)
        if not isinstance(page, dict):
            break
        aws_integrations.extend(page.get("Items", []))
        next_token = page.get("NextToken")
        if not next_token:
            break

    # IntegrationUri looks like "arn:aws:lambda:us-east-2:ACCT:function:gg-erp-dev-sop-get-module"
    # or sometimes "arn:aws:apigateway:us-east-2:lambda:path/.../functions/arn:aws:lambda:.../invocations"
    lambda_arn_re = re.compile(r"function:(?P<name>[a-zA-Z0-9_-]+)")
    for integ in aws_integrations:
        uri = integ.get("IntegrationUri", "") or ""
        integ_id = integ.get("IntegrationId", "")
        match = lambda_arn_re.search(uri)
        if not match:
            continue
        lambda_name = match.group("name")
        # Map full lambda name → logical key → integration tf key
        short = lambda_name.removeprefix(f"{NAME_PREFIX}-")
        lambda_tf_key = short.replace("-", "_")
        tf_key = lambda_to_tf_key.get(lambda_tf_key)
        if not tf_key:
            continue
        address = f'{TF_MODULE_PREFIX}.aws_apigatewayv2_integration.{tf_key}'
        if address in state:
            skipped += 1
            continue
        if tf_import(address, f"{api_id}/{integ_id}"):
            imported += 1
            state.add(address)
        else:
            failed += 1
    print(f"  imported={imported} skipped={skipped} warnings={failed}")
    return imported, skipped, failed


def reconcile_log_groups(state: set[str], lambda_full_names: list[str]) -> tuple[int, int, int]:
    """
    Import any /aws/lambda/<name> log group that exists in CloudWatch but not
    in state. CloudWatch auto-creates these on first Lambda invocation, so
    they almost always pre-exist terraform's CreateLogGroup call.
    """
    print(f"→ Reconciling CloudWatch Lambda log groups")
    # List all existing log groups with the Lambda prefix.
    data = aws([
        "logs", "describe-log-groups",
        "--log-group-name-prefix", f"/aws/lambda/{NAME_PREFIX}-",
        "--limit", "50",
    ])
    aws_log_groups: set[str] = set()
    next_token: str | None = None
    while True:
        args = [
            "logs", "describe-log-groups",
            "--log-group-name-prefix", f"/aws/lambda/{NAME_PREFIX}-",
            "--limit", "50",
        ]
        if next_token:
            args += ["--next-token", next_token]
        page = aws(args)
        if not isinstance(page, dict):
            break
        for lg in page.get("logGroups", []):
            aws_log_groups.add(lg["logGroupName"])
        next_token = page.get("nextToken")
        if not next_token:
            break

    imported = skipped = failed = 0
    expected_log_groups = {f"/aws/lambda/{n}" for n in lambda_full_names}
    for log_group_name in sorted(aws_log_groups & expected_log_groups):
        # terraform address: module.observability.aws_cloudwatch_log_group.lambda["${full_name}"]
        full_name = log_group_name.removeprefix("/aws/lambda/")
        address = f'module.observability.aws_cloudwatch_log_group.lambda["{full_name}"]'
        if address in state:
            skipped += 1
            continue
        if tf_import(address, log_group_name):
            imported += 1
            state.add(address)
        else:
            failed += 1
    print(f"  imported={imported} skipped={skipped} warnings={failed}")
    return imported, skipped, failed


# ─────────────────────────────────────────────────────────────────────────────
# Entry
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"── AWS state reconciliation for '{NAME_PREFIX}' in {AWS_REGION} ──")
    state = tf_state_list()
    print(f"  terraform state has {len(state)} addresses")

    route_keys, integration_lambdas = parse_tf_config()
    print(f"  parsed config: {len(route_keys)} routes, {len(integration_lambdas)} integrations")

    # 1. Lambdas
    reconcile_lambdas(state)

    # 2. API Gateway (routes + integrations)
    api_id = find_api_id()
    if api_id:
        reconcile_integrations(api_id, state, integration_lambdas)
        reconcile_routes(api_id, state, route_keys)
    else:
        print(f"  ↳ No API Gateway v2 found with name starting with '{NAME_PREFIX}', skipping routes/integrations.")

    # 3. CloudWatch log groups — reuse the current AWS Lambda list.
    data = aws(["lambda", "list-functions", "--max-items", "500"])
    functions = data.get("Functions", []) if isinstance(data, dict) else []
    lambda_names = [
        f["FunctionName"] for f in functions
        if f.get("FunctionName", "").startswith(f"{NAME_PREFIX}-")
    ]
    reconcile_log_groups(state, lambda_names)

    print("── Reconciliation complete ──")
    return 0


if __name__ == "__main__":
    sys.exit(main())
