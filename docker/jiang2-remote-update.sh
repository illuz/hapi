#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR="${1:?remote deployment directory is required}"
VERSION="${2:?image version is required}"
REPO_DIR="$REMOTE_DIR/repo"
DOCKER_DIR="$REPO_DIR/docker"
COMPOSE_FILE="$DOCKER_DIR/compose.jiang2.yaml"
BACKUP_DIR="$REMOTE_DIR/backups"
CURRENT_IMAGE_FILE="$REMOTE_DIR/current-image"
IMAGE="hapi-hub:jiang2-$VERSION"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

services=(hapi-me hapi-zzy hapi-xcr hapi-wxh hapi-jiajia)
ports=(13300 13301 13302 13303 13304)

if [[ ! -f "$COMPOSE_FILE" ]]; then
    printf 'Compose file not found: %s\n' "$COMPOSE_FILE" >&2
    exit 1
fi

mkdir -p "$DOCKER_DIR/env" "$BACKUP_DIR"

prepare_tunwg() {
    local tools_dir="$REPO_DIR/hub/tools/tunwg"
    local release_base="${HAPI_TUNWG_DOWNLOAD_BASE:-https://gh-proxy.com/https://github.com/tiann/tunwg/releases/latest/download}"
    local raw_base='https://raw.githubusercontent.com/tiann/tunwg/refs/heads/main'
    local filename url path tmp size
    mkdir -p "$tools_dir"

    declare -A downloads=(
        [tunwg-x64-linux]="$release_base/tunwg"
        [tunwg-arm64-linux]="$release_base/tunwg-arm64"
        [tunwg-x64-darwin]="$release_base/tunwg-darwin"
        [tunwg-arm64-darwin]="$release_base/tunwg-darwin-arm64"
        [tunwg-x64-win32.exe]="$release_base/tunwg.exe"
        [LICENSE]="$raw_base/LICENSE"
    )

    for filename in "${!downloads[@]}"; do
        url="${downloads[$filename]}"
        path="$tools_dir/$filename"
        if [[ "$filename" == 'LICENSE' ]]; then
            if [[ -s "$path" ]] && (( $(stat -c '%s' "$path") >= 100 )); then
                continue
            fi
        elif [[ -s "$path" ]]; then
            size="$(stat -c '%s' "$path")"
            if (( size >= 5242880 )); then
                continue
            fi
        fi
        printf 'Downloading %s\n' "$filename"
        tmp="$path.tmp.$$"
        rm -f "$tmp"
        curl --fail --location --retry 3 --retry-delay 2 \
            --connect-timeout 15 --max-time 180 \
            --output "$tmp" "$url"
        mv -f "$tmp" "$path"
        if [[ "$filename" != 'LICENSE' && "$filename" != *.exe ]]; then
            chmod 755 "$path"
        fi
    done
}

ensure_base_image() {
    local image="$1"
    if docker image inspect "$image" >/dev/null 2>&1; then
        return
    fi
    for attempt in 1 2 3; do
        if docker pull "$image"; then
            return
        fi
        printf 'Retrying pull of %s (%s/3)\n' "$image" "$attempt" >&2
        sleep 5
    done
    printf 'Unable to pull base image: %s\n' "$image" >&2
    exit 1
}

prepare_tunwg
ensure_base_image 'oven/bun:1.3.5-debian'
ensure_base_image 'debian:bookworm-slim'

for index in "${!services[@]}"; do
    service="${services[$index]}"
    port="${ports[$index]}"
    env_file="$DOCKER_DIR/env/$service.env"

    if [[ ! -s "$env_file" ]]; then
        umask 077
        token="$(openssl rand -hex 32)"
        cat >"$env_file" <<EOF
HAPI_LISTEN_HOST=0.0.0.0
HAPI_LISTEN_PORT=3006
HAPI_HOME=/data
HAPI_PUBLIC_URL=http://127.0.0.1:$port
CORS_ORIGINS=http://127.0.0.1:$port
CLI_API_TOKEN=$token
EOF
        printf 'Generated %s\n' "$env_file"
    fi

    chmod 600 "$env_file"
    if grep -q 'replace-with-' "$env_file"; then
        printf 'Placeholder value remains in %s; replace it before deployment.\n' "$env_file" >&2
        exit 1
    fi
done

docker compose -f "$COMPOSE_FILE" config >/dev/null

previous_image=''
if [[ -s "$CURRENT_IMAGE_FILE" ]]; then
    previous_image="$(head -n 1 "$CURRENT_IMAGE_FILE")"
fi

backup_image="$previous_image"
if [[ -z "$backup_image" ]] || ! docker image inspect "$backup_image" >/dev/null 2>&1; then
    backup_image='debian:bookworm-slim'
fi

# Stop each running Hub only while its SQLite volume is archived.
for service in "${services[@]}"; do
    volume="$service-data"
    was_running=false
    if docker inspect "$service" >/dev/null 2>&1; then
        running="$(docker inspect -f '{{.State.Running}}' "$service")"
        if [[ "$running" == 'true' ]]; then
            docker compose -f "$COMPOSE_FILE" stop "$service" >/dev/null
            was_running=true
        fi
    fi

    if docker volume inspect "$volume" >/dev/null 2>&1; then
        archive="$BACKUP_DIR/${service}-${TIMESTAMP}.tar.gz"
        docker run --rm --user 0:0 --entrypoint tar \
            -v "$volume:/data:ro" \
            -v "$BACKUP_DIR:/backup" \
            "$backup_image" \
            -czf "/backup/$(basename "$archive")" -C /data .
        printf 'Backed up %s to %s\n' "$volume" "$archive"
    fi

    if [[ "$was_running" == 'true' ]]; then
        docker compose -f "$COMPOSE_FILE" start "$service" >/dev/null
    fi
done

# Build once for the whole stack. Compose's per-service build can issue five
# concurrent metadata requests for the same base image on older Docker hosts.
docker build --pull=false --tag "$IMAGE" "$REPO_DIR"
HAPI_IMAGE="$IMAGE" docker compose -f "$COMPOSE_FILE" up -d --no-build --force-recreate --remove-orphans

check_health() {
    local index service port deadline status
    for index in "${!services[@]}"; do
        service="${services[$index]}"
        port="${ports[$index]}"
        deadline=$((SECONDS + 180))
        status=''
        while (( SECONDS < deadline )); do
            status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$service" 2>/dev/null || true)"
            if [[ "$status" == 'healthy' ]] && curl --fail --silent --show-error "http://127.0.0.1:$port/health" >/dev/null; then
                break
            fi
            sleep 2
        done
        if [[ "$status" != 'healthy' ]] || ! curl --fail --silent --show-error "http://127.0.0.1:$port/health" >/dev/null; then
            printf '%s failed health check (status: %s).\n' "$service" "$status" >&2
            return 1
        fi
        printf '%s is healthy on 127.0.0.1:%s\n' "$service" "$port"
    done
}

if ! check_health; then
    if [[ -n "$previous_image" ]]; then
        printf 'Restoring previous image %s\n' "$previous_image" >&2
        HAPI_IMAGE="$previous_image" docker compose -f "$COMPOSE_FILE" up -d --no-build --force-recreate
    fi
    exit 1
fi

printf '%s\n' "$IMAGE" >"$CURRENT_IMAGE_FILE"
printf 'Deployment complete: %s\n' "$IMAGE"
