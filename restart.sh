#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PREFERRED_BUN_BIN="${HOME}/.bun-1.3.11/bin/bun"
LISTEN_HOST="${HAPI_LISTEN_HOST:-127.0.0.1}"
LISTEN_PORT="${HAPI_LISTEN_PORT:-3006}"
HEALTH_TIMEOUT_SECONDS="${HAPI_RESTART_TIMEOUT_SECONDS:-60}"

if [[ -x "${PREFERRED_BUN_BIN}" ]]; then
    BUN_BIN="${PREFERRED_BUN_BIN}"
elif command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
else
    echo "[restart] error: bun not found"
    exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "[restart] error: pm2 not found"
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "[restart] error: curl not found"
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

# Keep the expected asset hash so the health check can prove that PM2 is
# serving the newly compiled executable rather than an old process.
EXPECTED_INDEX_ASSET=""
if [[ -f "$ROOT_DIR/web/dist/index.html" ]]; then
    EXPECTED_INDEX_ASSET="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$ROOT_DIR/web/dist/index.html" | head -n 1 || true)"
fi
if [[ -n "$EXPECTED_INDEX_ASSET" ]]; then
    echo "[restart] expected web asset: $EXPECTED_INDEX_ASSET"
fi

echo "[restart] restart pm2 app: hapi-hub"
cd "$ROOT_DIR"
pm2 startOrReload ecosystem.config.cjs --only hapi-hub --update-env

HEALTH_URL="http://${LISTEN_HOST}:${LISTEN_PORT}/health"
echo "[restart] wait for hub health: $HEALTH_URL (timeout ${HEALTH_TIMEOUT_SECONDS}s)"
for ((elapsed = 0; elapsed < HEALTH_TIMEOUT_SECONDS; elapsed++)); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        if [[ -n "$EXPECTED_INDEX_ASSET" ]]; then
            SERVED_INDEX="$(curl -fsS "http://${LISTEN_HOST}:${LISTEN_PORT}/index.html" || true)"
            if [[ "$SERVED_INDEX" != *"$EXPECTED_INDEX_ASSET"* ]]; then
                echo "[restart] hub is healthy but serves a stale web asset; retrying"
                sleep 1
                continue
            fi
        fi

        echo "[restart] hub healthy; embedded web asset verified"
        echo "[restart] done"
        exit 0
    fi
    sleep 1
done

echo "[restart] error: hub failed health check"
pm2 status hapi-hub || true
exit 1
