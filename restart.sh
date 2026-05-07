#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PREFERRED_BUN_BIN="${HOME}/.bun-1.3.11/bin/bun"
LISTEN_HOST="${HAPI_LISTEN_HOST:-127.0.0.1}"
LISTEN_PORT="${HAPI_LISTEN_PORT:-3006}"

if [[ -x "${PREFERRED_BUN_BIN}" ]]; then
    BUN_BIN="${PREFERRED_BUN_BIN}"
elif command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
else
    echo "[restart] error: bun not found"
    exit 1
fi

export PATH="$(dirname "${BUN_BIN}"):${PATH}"

echo "[restart] repo: $ROOT_DIR"
echo "[restart] bun: $BUN_BIN ($("$BUN_BIN" --version))"

cd "$ROOT_DIR"

echo "[restart] build web"
"$BUN_BIN" run build:web

echo "[restart] generate embedded web assets"
cd "$ROOT_DIR/hub"
"$BUN_BIN" run generate:embedded-web-assets

echo "[restart] build standalone exe"
cd "$ROOT_DIR/cli"
"$BUN_BIN" run build:exe:allinone

echo "[restart] restart pm2 app: hapi-hub"
cd "$ROOT_DIR"
pm2 startOrReload ecosystem.config.cjs --only hapi-hub --update-env

echo "[restart] wait for hub health: http://${LISTEN_HOST}:${LISTEN_PORT}/"
for _ in {1..20}; do
    if curl -fsS -o /dev/null "http://${LISTEN_HOST}:${LISTEN_PORT}/" >/dev/null 2>&1; then
        echo "[restart] hub healthy"
        echo "[restart] done"
        exit 0
    fi
    sleep 1
done

echo "[restart] error: hub failed health check"
pm2 status hapi-hub || true
exit 1
