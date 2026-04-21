#!/usr/bin/env bash
# Fast feedback loop for hackathon sessions.
# Runs typecheck + API tests + architecture contracts.
# Does NOT run lint or migration checks — keep those for ci:validate.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

pass() { echo -e "${GREEN}✔  $1${RESET}"; }
fail() { echo -e "${RED}✘  $1${RESET}"; }
info() { echo -e "${YELLOW}→  $1${RESET}"; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

ERRORS=0

header "GG-ERP hackathon check"
echo "$(date '+%H:%M:%S')  branch: $(git branch --show-current)"

# ── 1. Typecheck ──────────────────────────────────────────────────────────────
header "1/3  Typecheck"
if npm run typecheck --silent 2>&1; then
  pass "TypeScript"
else
  fail "TypeScript — fix type errors before committing"
  ERRORS=$((ERRORS + 1))
fi

# ── 2. API tests ──────────────────────────────────────────────────────────────
header "2/3  API tests"
if npm run test:api --silent 2>&1; then
  pass "API test suite"
else
  fail "API tests — one or more tests failed"
  ERRORS=$((ERRORS + 1))
fi

# ── 3. Architecture contracts ─────────────────────────────────────────────────
header "3/3  Architecture contracts"
if npm run test:architecture --silent 2>&1; then
  pass "Architecture contracts"
else
  fail "Architecture contracts — cross-context boundary or plan-progress violation"
  ERRORS=$((ERRORS + 1))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All checks passed — safe to commit.${RESET}"
  echo ""
  info "Next: update IMPLEMENTATION_STATUS.md, then git commit + push"
  exit 0
else
  echo -e "${RED}${BOLD}${ERRORS} check(s) failed — fix before committing.${RESET}"
  exit 1
fi
