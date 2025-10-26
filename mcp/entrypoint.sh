#!/bin/sh

set -e

: "${QDRANT_URL:=http://localhost:6333}"

echo "Waiting for Qdrant at ${QDRANT_URL}..."
until curl -sSf "${QDRANT_URL}/healthz" >/dev/null 2>&1; do
  sleep 2
done

echo "Initializing Qdrant collections..."
/app/init-collections.sh

echo "Starting MCP server..."
exec "$@"
