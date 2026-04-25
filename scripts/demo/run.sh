#!/usr/bin/env bash
# End-to-end demo video generation. Brings up dev servers in mock mode, runs
# Playwright recording and audio mux for each app, tears everything down.
#
# Usage:
#   run.sh                 # all three apps
#   run.sh erp             # only one
#   run.sh floor-tech training

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"

APPS=("$@")
if [[ ${#APPS[@]} -eq 0 ]]; then APPS=(erp floor-tech training); fi

# Map app → next.js dev port + workspace name.
declare -A PORT=( [erp]=3010 [floor-tech]=3012 [training]=3013 )
declare -A WORKSPACE=( [erp]=apps/web [floor-tech]=apps/floor-tech [training]=apps/training )

PIDS=()
cleanup() {
  echo "[run] cleaning up dev servers…"
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  # Kill any lingering next-server children bound to our ports.
  for app in "${APPS[@]}"; do
    lsof -ti tcp:${PORT[$app]} 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  done
}
trap cleanup EXIT

wait_for_port() {
  local port=$1 tries=0
  until curl -fs -o /dev/null "http://localhost:$port/" >/dev/null 2>&1; do
    tries=$((tries+1))
    if [[ $tries -gt 60 ]]; then
      echo "[run] port $port never came up" >&2
      return 1
    fi
    sleep 2
  done
  echo "[run] port $port is up"
}

# Boot each dev server with mock mode + any other required env.
for app in "${APPS[@]}"; do
  port=${PORT[$app]}
  ws=${WORKSPACE[$app]}
  echo "[run] starting $app on :$port (mock mode)…"
  (
    cd "$REPO/$ws"
    NEXT_PUBLIC_AUTH_MODE=mock \
    NEXT_TELEMETRY_DISABLED=1 \
      npx --no-install next dev --port "$port" \
      > "$ROOT/out/$app-dev.log" 2>&1
  ) &
  PIDS+=("$!")
done

# Wait for each port to respond.
for app in "${APPS[@]}"; do
  wait_for_port "${PORT[$app]}" || { echo "dev server for $app failed"; exit 1; }
done

# Run the pipeline sequentially per app (browser + audio fully independent per app).
for app in "${APPS[@]}"; do
  echo
  echo "====== $app ======"
  "$ROOT/generate-tts.sh" "$app"
  node "$ROOT/record.js" "$app"
  "$ROOT/mux.sh" "$app"
done

echo
echo "[run] all done. Outputs:"
ls -lah "$ROOT/out"/*.mp4 2>/dev/null || true
