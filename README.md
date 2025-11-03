# Game MCP Server

MCP (Model Context Protocol) server that backs the **genai-game-engine** project with research, architecture, narrative, QA, and playtest knowledge stored in Qdrant. The server exposes the Streamable HTTP MCP transport on port `3000` by default, so Claude or any MCP-compatible client can connect over HTTP or curl.

## Projects in this repo

| Directory | Purpose |
| --- | --- |
| `mcp/` | Streamable HTTP MCP server with rich tool catalog for research, architecture, QA, lore, etc. |
| `graph-builder/` | Pipelines that populate the knowledge-graph collections used by `explore_graph_entity` and `search_graph_semantic`. |
| `backlog-editor/` | Visual kanban + handoff editor that talks directly to Qdrant, offering a browser UI for PBIs and session handoff notes. |
| `generate-image/` | Standalone STDIO MCP server that proxies OpenAI image generation and saves outputs to disk. |

## Project Namespaces

All persistence now lives in project-scoped Qdrant collections. A canonical project list is stored in `mcp/config/projects.json`:

- Each project ID is lower-case/kebab-case (e.g. `default`, `prototype-alpha`).
- MCP HTTP endpoints are available at `/<project>/mcp` and `/<project>/sse` (the legacy `/mcp` and `/sse` paths resolve to the default project).
- Create a new project and its Qdrant collections with `POST /project` on the MCP server:

  ```bash
  curl -X POST http://localhost:5356/project \
    -H 'Content-Type: application/json' \
    -d '{"id":"glass"}'
  ```
  

  ```bash
  curl -v -X POST http://localhost:5356/reset \
    -H 'Content-Type: application/json' \
    -d '{"id":"glass","snapshot":false}'
  ```
curl -X POST "http://localhost:6333/collections/glass__backlog_items/points/delete?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"must": []}}'
curl "http://localhost:6333/collections/glass__backlog_items

  The response lists the fully-qualified collection names (e.g. `prototype-alpha__research_findings`).

- The backlog editor forwards the current project via the `project` query parameter or the `X-Project-Id` header (UI includes a project switcher). If omitted, it falls back to the default project defined in the shared config file.
- The graph builder accepts an optional `project` field on `POST /build` to populate the corresponding `code_graph` namespace. When omitted the default project is used.
- `list_qdrant_collections` returns project-specific collection names, while `get_server_metadata` advertises the project-aware HTTP templates.
- Use `POST /reset` with body `{ "id": "<project>" }` to snapshot the project's Qdrant collections and Neo4j entities to `/app/snapshots/<project>/<timestamp>/`, then clear them so the project starts fresh.

## Feature Management

- Feature intake can be paused per project. Call `set_feature_lock { "locked": true }` to reject new `create_feature` requests (the MCP server responds with "no new features at this time") and unlock with `{ "locked": false }` when planning resumes.
- Backlog items support an optional `feature_id` during `create_backlog_item` and `update_backlog_item`. Use `assign_backlog_to_feature` to link existing PBIs and `list_feature_backlog_items` to retrieve the feature’s work queue.

## Prerequisites

- Node.js 18+
- Qdrant instance (defaults to `http://qdrant:6333`)
- Neo4j instance (defaults to `bolt://localhost:7687`)
- Embedding service exposing `POST /embed` (defaults to `http://embedding-service:80`, see [Embedding Service](#embedding-service))
- OpenAI API key with access to `gpt-4o-mini` (configurable via `OPENAI_MODEL`)

## Scripts

```bash
npm run dev    # Start with ts-node + Streamable HTTP transport (default port 3000)
npm run build  # Type-check and compile TypeScript to dist/
npm start      # Build then run the compiled server from dist/
```

Set `PORT` and/or `MCP_PATH` to override the HTTP binding (defaults are `3000` and `/mcp`).

## Smoke Testing with curl

The transport implements MCP’s Streamable HTTP flow. Every session starts with an `initialize` request. The response returns an `Mcp-Session-Id` header that must be included on subsequent requests and SSE streams.

> ℹ️ The POST endpoints require `Accept: application/json, text/event-stream` so the transport can negotiate either JSON replies or server-sent events. Include this header on every JSON-RPC POST request.

1. **Initialize the session**

   ```bash
   curl -i -X POST http://localhost:3000/default/mcp \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{
       "jsonrpc": "2.0",
       "id": "init-1",
       "method": "initialize",
       "params": {
         "protocolVersion": "2024-11-05",
         "clientInfo": { "name": "curl", "version": "0.1" },
         "capabilities": {}
       }
     }'
 ```

 Note the `Mcp-Session-Id` header in the response (e.g. `bf6fda5a-a8d5-4ad6-b8e1-...`). Use it for all follow-up requests.

2. **List available tools**

   ```bash
   curl -i -X POST http://localhost:3000/default/mcp \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -H 'Mcp-Session-Id: d3baee33-df43-442d-a164-5675450c6860' \
     -H 'Mcp-Protocol-Version: 2024-11-05' \
     -d '{
       "jsonrpc": "2.0",
       "id": "list-1",
       "method": "tools/list",
       "params": {}
     }'
   ```

3. **Call a tool (example: get server metadata)**

   ```bash
   curl -i -X POST http://localhost:3000/default/mcp \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -H 'Mcp-Session-Id: <SESSION_ID>' \
     -H 'Mcp-Protocol-Version: 2024-11-05' \
     -d '{
       "jsonrpc": "2.0",
       "id": "call-1",
       "method": "tools/call",
       "params": {
         "name": "get_server_metadata",
         "arguments": {}
       }
     }'
   ```

4. **Subscribe to the SSE stream (optional)**

   ```bash
   curl -N http://localhost:3000/default/sse \
     -H 'Accept: text/event-stream' \
     -H 'Mcp-Session-Id: <SESSION_ID>' \
     -H 'Mcp-Protocol-Version: 2024-11-05'
   ```

   Leave this curl running to receive streaming responses (e.g. logging events). Use `Ctrl+C` to exit.

5. **Terminate the session (optional cleanup)**

   ```bash
   curl -i -X DELETE http://localhost:3000/default/mcp \
     -H 'Mcp-Session-Id: <SESSION_ID>' \
     -H 'Mcp-Protocol-Version: 2024-11-05'
   ```

## Collections & Tools

- `config/collections.json` documents every Qdrant collection, its cardinality, and which Claude agents rely on it.
- `docs/mcp/usage.md` covers Claude integration and the full MCP tool catalog exposed by the server.
- Bug-fix memory lives in the `bug_fix_patterns` collection and is accessible via the `record_bug_fix`, `match_bug_fix`, and `get_bug_fix` tools. Error messages can be stored alongside fixes so agents can perform exact log-line lookups before falling back to semantic matches.
- Knowledge-graph embeddings live in project-scoped collections named `<project>__code_graph`. Use `explore_graph_entity` to pull the Neo4j node plus surrounding relationships, and `search_graph_semantic` for vector search against the graph-builder output.
- Feature definitions live in `<project>__features`; manage them with `create_feature`, `update_feature`, `list_features`, and `get_feature`, and link PBIs via `assign_backlog_to_feature` or `list_feature_backlog_items`.
- `GET /stats` returns per-boot tool usage counters (`writes`/`reads`) for MCP endpoints.

Use `list_qdrant_collections` and `get_mcp_documentation` to programmatically discover server capabilities from clients.

## Knowledge Graph

Set the following environment variables so the server can reach the graph-builder databases:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEO4J_URL` | `bolt://localhost:7687` | Bolt endpoint for the Neo4j instance populated by the graph builder |
| `NEO4J_USER` | `neo4j` | Username for Neo4j auth |
| `NEO4J_PASSWORD` | `password` | Password for Neo4j auth |
| `GRAPH_COLLECTION` | `code_graph` | Base collection name for graph embeddings (`<project>__code_graph` is created per project) |
| `DEFAULT_PROJECT` | `memory` | Initial namespace used when clients omit `project` |
| `SNAPSHOT_DIR` | `./snapshots` | Directory where `POST /reset` writes archives (mounted to the host in Docker compose) |
| `GRAPH_BUILDER_PORT` | `4100` | HTTP port for the graph-builder service |
| `OPENAI_API_KEY` | _(required)_ | Used by the graph builder to enrich entities |
| `OPENAI_MODEL` | `gpt-5` | Override the OpenAI model for semantic enrichment |
| `REPO_URL` | `https://github.com/chris-arsenault/genai-game-engine.git` | Default repository cloned by the builder |
| `REPO_BRANCH` | `main` | Default branch synced before each build |

The graph builder clones `chris-arsenault/genai-game-engine` into `/mnt/apps/apps/mcp-server/game-mcp/server/source/genai-game-engine` by default and syncs data into Neo4j + Qdrant. Once the builder runs, MCP clients can:

1. Call `search_graph_semantic` with natural-language or code snippets to fetch the most relevant graph entities.
2. Pass an entity ID (e.g., `file:src/tools/graph.tool.ts`) to `explore_graph_entity` to inspect inbound/outbound relationships straight from Neo4j.

The builder exposes a REST API on `http://<host>:${GRAPH_BUILDER_PORT}`:

- `POST /build` with body `{"mode":"full|incremental","stage":"all|parse|enrich|populate","baseCommit":"...","repoUrl":"...","branch":"...","project":"<id>"}` to start a job. `project` is optional and defaults to the configured default project. `repoUrl` and `branch` default to the service configuration (see env vars above).
- `GET /status` to poll the current or last run summary.
- `POST /reset` to clear staging artifacts and the incremental marker.

`POST /build` returns immediately (HTTP 202) after queuing work; use `GET /status` to observe progress and obtain the final summary.

Example: trigger a full rebuild (all stages, default repo/branch) from localhost using curl:

```bash
curl -s -X POST http://localhost:5346/build \
  -H 'Content-Type: application/json' \
  -d '{
    "mode": "full",
    "stage": "all",
    "branch": "main",
    "project": "default"
  }'
```

Then poll:

```bash
curl -s http://localhost:4100/status | jq '.'
```

## Embedding Service

The provided `docker-compse.yml` now launches Hugging Face Text Embeddings Inference on CPU with the `nomic-ai/nomic-embed-text-v1.5` model. It supports an 8192-token context window and 768-dimensional embeddings—ample room for long tool payloads while remaining practical on a dual Xeon E5 / 128 GB RAM TrueNAS box. Because the vector size changed relative to the original setup, run `./init-collections.sh` (or recreate the Qdrant collections manually) before ingesting new data.

The container mounts `/mnt/apps/apps/mcp-server/embedding-cache` and sets `MODEL_CACHE=/data`, so model weights persist across restarts. To pre-seed the cache on an offline machine:

```bash
huggingface-cli download nomic-ai/nomic-embed-text-v1.5 --local-dir /mnt/apps/apps/mcp-server/embedding-cache
```

The embedding client in `src/services/embedding.service.ts` now surfaces HTTP error bodies (e.g. token-limit warnings) directly in the logs to make diagnosing misconfiguration easier.
