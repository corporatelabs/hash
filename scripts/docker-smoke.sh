#!/usr/bin/env bash
set -euo pipefail

name="${SMOKE_NAME:-hash-smoke}"
port="${SMOKE_PORT:-18080}"
image="${SMOKE_IMAGE:-hash:ci}"

docker rm -f "$name" >/dev/null 2>&1 || true

echo "production start without a pepper must fail"
set +e
docker run --rm -e ENVIRONMENT=production "$image"
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "production container started without RATE_LIMIT_PEPPER"
  exit 1
fi

docker run -d --name "$name" -p "${port}:8080" \
  -e ENVIRONMENT=development \
  -e RATE_LIMIT_PEPPER=development-only-pepper \
  "$image"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  docker logs "$name" || true
  echo "container did not become healthy"
  exit 1
fi

BASE_URL="http://127.0.0.1:${port}" node scripts/roundtrip.mjs
