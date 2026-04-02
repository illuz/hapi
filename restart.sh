#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[restart] repo: $ROOT_DIR"

cd "$ROOT_DIR"

echo "[restart] build web"
bun run build:web

echo "[restart] generate embedded web assets"
cd "$ROOT_DIR/hub"
bun run generate:embedded-web-assets

echo "[restart] build standalone exe"
cd "$ROOT_DIR/cli"
bun run build:exe:allinone

echo "[restart] restart pm2 app: hapi-hub"
cd "$ROOT_DIR"
pm2 startOrReload ecosystem.config.cjs --only hapi-hub --update-env

echo "[restart] done"
