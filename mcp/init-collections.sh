#!/bin/sh

set -eu

: "${QDRANT_URL:=http://localhost:6333}"

# Research findings collection
curl -sS -X PUT "${QDRANT_URL}/collections/research_findings" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "optimizers_config": {
      "indexing_threshold": 10000
    }
  }'

# Architectural patterns collection
curl -sS -X PUT "${QDRANT_URL}/collections/architectural_patterns" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

# Code implementations collection
curl -sS -X PUT "${QDRANT_URL}/collections/code_implementations" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

# Narrative design collection
curl -sS -X PUT "${QDRANT_URL}/collections/narrative_design" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "on_disk_payload": true
  }'

# World building collection
curl -sS -X PUT "${QDRANT_URL}/collections/world_building" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "on_disk_payload": true
  }'

# Dialogue snippets collection
curl -sS -X PUT "${QDRANT_URL}/collections/dialogue_snippets" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "on_disk_payload": true
  }'

# Test strategies collection
curl -sS -X PUT "${QDRANT_URL}/collections/test_strategies" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

# Gameplay feedback collection
curl -sS -X PUT "${QDRANT_URL}/collections/gameplay_feedback" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

# Bug fix patterns collection
curl -sS -X PUT "${QDRANT_URL}/collections/bug_fix_patterns" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "on_disk_payload": true
  }'

# Knowledge graph collection
curl -sS -X PUT "${QDRANT_URL}/collections/code_graph" \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "on_disk_payload": true
  }'

echo "Collections created successfully"
