FROM oven/bun:1.3.5-debian AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY cli/package.json ./cli/package.json
COPY hub/package.json ./hub/package.json
COPY shared/package.json ./shared/package.json
COPY web/package.json ./web/package.json
COPY docs/package.json ./docs/package.json
COPY website/package.json ./website/package.json

RUN bun install --no-save

COPY cli ./cli
COPY hub ./hub
COPY shared ./shared
COPY web ./web

RUN bun run build:single-exe \
    && binary="$(find cli/dist-exe -type f -path '*/bun-linux-*/hapi' -print -quit)" \
    && test -n "$binary" \
    && install -D -m 0755 "$binary" /out/hapi

FROM debian:bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/tiann/hapi" \
      org.opencontainers.image.description="HAPI Hub" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 passwd \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 hapi \
    && useradd --uid 10001 --gid hapi --home-dir /home/hapi --create-home --shell /usr/sbin/nologin hapi \
    && install -d -o hapi -g hapi /data

COPY --from=builder /out/hapi /usr/local/bin/hapi

ENV HOME=/home/hapi \
    HAPI_HOME=/data \
    HAPI_LISTEN_HOST=0.0.0.0 \
    HAPI_LISTEN_PORT=3006

WORKDIR /data
USER hapi:hapi

VOLUME ["/data"]
EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${HAPI_LISTEN_PORT}/health" || exit 1

STOPSIGNAL SIGTERM

CMD ["hapi", "hub", "--no-relay"]
