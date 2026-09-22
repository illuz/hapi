# Docker deployment

The Docker image contains the HAPI Hub and embedded web app. Keep HAPI CLI and
Runner on the machines that own the coding workspaces so they can access local
files, credentials, terminals, and agent processes directly.

## Requirements

- Docker Engine with Docker Compose v2
- A reverse proxy with HTTPS for public deployments
- At least one unique `CLI_API_TOKEN`

## Start one Hub

Create the environment file and replace the public URL and token:

```bash
cd docker
cp .env.hub-a.example .env.hub-a
openssl rand -hex 32
```

Build the current checkout and start the primary Hub:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f hub-a
```

The Hub is available to a reverse proxy at `127.0.0.1:3006`. Its persistent
configuration and SQLite database are stored in the `hapi-hub-a-data` volume.

## Start multiple Hubs

Prepare the second environment file with a different domain and token:

```bash
cp .env.hub-b.example .env.hub-b
openssl rand -hex 32
docker compose --profile multi up -d --build
```

The example exposes:

| Service | Host address | Data volume |
|---------|--------------|-------------|
| `hub-a` | `127.0.0.1:3006` | `hapi-hub-a-data` |
| `hub-b` | `127.0.0.1:3007` | `hapi-hub-b-data` |

Route each public domain to its corresponding host address. The reverse proxy
must support WebSocket upgrades and must not buffer the SSE endpoint.

Each Hub is an independent instance. Do not share a data volume between Hub
containers and do not load-balance multiple Hub processes over one SQLite
database.

## Connect CLI and Runner

Set the public Hub URL and matching token on each workspace machine:

```bash
export HAPI_API_URL="https://hub-a.example.com"
export CLI_API_TOKEN="the-token-from-env-hub-a"

hapi runner start
```

## Upgrade

Back up every Hub volume before starting a version that may migrate SQLite.
Then check out the desired HAPI release and rebuild:

```bash
git fetch --tags
git checkout <release-tag>
cd docker
docker compose build --pull
docker compose --profile multi up -d
```

Use an exact Git tag for production deployments. Do not rely on a moving
branch when rollback needs to be predictable.

## jiang2 five-instance deployment

`compose.jiang2.yaml` runs five independent Hub containers, each with its own
SQLite volume and CLI token:

| Service | Host port | Data volume |
|---------|-----------|-------------|
| `hapi-me` | `127.0.0.1:13300` | `hapi-me-data` |
| `hapi-zzy` | `127.0.0.1:13301` | `hapi-zzy-data` |
| `hapi-xcr` | `127.0.0.1:13302` | `hapi-xcr-data` |
| `hapi-wxh` | `127.0.0.1:13303` | `hapi-wxh-data` |
| `hapi-jiajia` | `127.0.0.1:13304` | `hapi-jiajia-data` |

Run the following from the repository root to sync the current checkout to
`jiang2`, build the new image there, back up each existing volume, recreate the
containers, and wait for all five health checks:

```bash
./docker/update-jiang2.sh
```

The script uses `jiang2` and `/opt/hapi-jiang2` by default. A clean checkout
automatically fast-forwards from `origin/main`; a dirty checkout is deployed
as-is and is never overwritten. Set `HAPI_UPDATE_FROM_ORIGIN=false` to disable
the fetch. Override the host and directory with `HAPI_DEPLOY_HOST` and
`HAPI_DEPLOY_DIR`. On first run it generates one secret
environment file per service under `/opt/hapi-jiang2/repo/docker/env/`. These
files start with loopback URLs; replace `HAPI_PUBLIC_URL` and `CORS_ORIGINS`
with each final HTTPS domain before enabling its reverse-proxy entry.

Every update creates a timestamped archive under `/opt/hapi-jiang2/backups`
and tags the image with the source revision. If health checks fail and a prior
image exists, the script automatically recreates the containers from that
image. Never run `docker compose down -v` for this deployment.

## Back up and restore

Stop the Hub before copying its SQLite volume:

```bash
mkdir -p backups
docker compose stop hub-a
docker run --rm \
    -v hapi-hub-a-data:/data:ro \
    -v "$PWD/backups:/backup" \
    alpine:3.22 \
    tar -czf /backup/hub-a-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
docker compose start hub-a
```

To restore, stop the Hub, clear the target volume, and extract a trusted backup
into the same volume before starting the Hub again.

## Reverse proxy notes

- Set `HAPI_PUBLIC_URL` to the canonical HTTPS origin for each Hub.
- Set `CORS_ORIGINS` to every browser origin allowed to access that Hub.
- Keep the host port bound to `127.0.0.1` when the reverse proxy runs on the
  host. If the proxy runs in Docker, attach it to the same Docker network and
  route to `hub-a:3006` or `hub-b:3006` instead.
- The provided command uses `--no-relay`; the reverse proxy is responsible for
  public TLS and routing.
