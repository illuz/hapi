#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REMOTE_HOST="${HAPI_DEPLOY_HOST:-jiang2}"
REMOTE_DIR="${HAPI_DEPLOY_DIR:-/opt/hapi-jiang2}"
UPDATE_REMOTE="${HAPI_UPDATE_REMOTE:-origin}"
UPDATE_BRANCH="${HAPI_UPDATE_BRANCH:-main}"

for command in git ssh rsync; do
    if ! command -v "$command" >/dev/null 2>&1; then
        printf 'Required command not found: %s\n' "$command" >&2
        exit 1
    fi
done

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" true; then
    printf 'Cannot connect to %s using the configured SSH key.\n' "$REMOTE_HOST" >&2
    exit 1
fi

# Clean checkouts follow the configured remote automatically. Dirty checkouts
# are deployed as-is so local work is never overwritten by an update.
if [[ "${HAPI_UPDATE_FROM_ORIGIN:-true}" == 'true' ]]; then
    if [[ -n "$(git -C "$SOURCE_DIR" status --porcelain)" ]]; then
        printf 'Working tree is dirty; deploying the current checkout without pulling.\n'
    else
        git -C "$SOURCE_DIR" fetch "$UPDATE_REMOTE" "$UPDATE_BRANCH"
        git -C "$SOURCE_DIR" merge --ff-only "$UPDATE_REMOTE/$UPDATE_BRANCH"
    fi
fi

commit="$(git -C "$SOURCE_DIR" rev-parse --short HEAD)"
if [[ -n "$(git -C "$SOURCE_DIR" status --porcelain)" ]]; then
    version="$commit-dirty-$(date +%Y%m%d%H%M%S)"
else
    version="$commit"
fi

printf 'Syncing %s to %s:%s/repo\n' "$version" "$REMOTE_HOST" "$REMOTE_DIR"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR/repo/docker/env' '$REMOTE_DIR/backups'"
rsync -az --delete --delete-delay \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='dist-exe' \
    --exclude='coverage' \
    --exclude='.playwright-mcp' \
    --exclude='.workflow' \
    --exclude='cli/npm' \
    --exclude='cli/release-artifacts' \
    --exclude='hub/tools/tunwg/tunwg-*' \
    --exclude='hub/tools/tunwg/*.exe' \
    --exclude='docker/env' \
    --exclude='docker/backups' \
    "$SOURCE_DIR/" "$REMOTE_HOST:$REMOTE_DIR/repo/"

ssh "$REMOTE_HOST" "bash -s -- '$REMOTE_DIR' '$version'" <"$SCRIPT_DIR/jiang2-remote-update.sh"
