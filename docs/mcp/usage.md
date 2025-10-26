# Game Dev MCP Server Documentation

## Overview
This Model Context Protocol (MCP) server centralizes game development knowledge for research, architecture, narrative design, QA, and playtest feedback. Claude can connect to it to accelerate the workflows defined in the genai-game-engine project.

## Connection
- **Transport**: Streamable HTTP (JSON/SSE)
- **Environment variables**:
  - `QDRANT_URL` – REST endpoint for the Qdrant vector store (default `http://qdrant:6333`).
  - `EMBEDDING_URL` – HTTP endpoint for the embedding service (default `http://embedding-service:80`).
- **HTTP endpoint**: `http://localhost:3000/mcp` (configurable via `PORT` and `MCP_PATH`).
- **Entrypoint**: `node dist/index.js` (executed through `entrypoint.sh`, which initializes Qdrant collections).

## Tool Catalog
| Tool | Purpose |
| --- | --- |
| `cache_research` / `query_research` / `check_research_exists` | Manage research findings and reuse past investigations. |
| `store_pattern` / `find_similar_patterns` / `get_pattern_by_name` | Capture and retrieve code or design patterns. |
| `store_architecture_decision` / `query_architecture` / `get_architecture_history` | Track architectural rationale and retrieve history by scope/tags. |
| `validate_against_patterns` / `check_consistency` | Validate new work against recorded patterns and decisions. |
| `store_narrative_element` / `search_narrative_elements` / `get_narrative_outline` | Persist and query narrative structure, quests, characters, and beats. |
| `store_lore_entry` / `search_lore` / `list_lore` | Maintain worldbuilding lore. |
| `store_dialogue_scene` / `find_dialogue` / `get_dialogue_scene` | Manage branching dialogue scripts. |
| `store_test_strategy` / `query_test_strategies` / `list_test_strategies_by_focus` | Document QA strategy coverage. |
| `record_playtest_feedback` / `query_playtest_feedback` / `summarize_playtest_feedback` | Capture qualitative feedback and summarize sentiment. |
| `get_server_metadata` / `list_qdrant_collections` / `get_mcp_documentation` | Discover server capabilities and documentation. |

## Collections
The `list_qdrant_collections` tool mirrors `config/collections.json` and returns purpose, vector size, and primary Claude agents for each collection. Collections align with the `.claude` agents (narrative-writer, architect, engine-dev, etc.) to enable autonomous workflows.

## Usage Tips for Claude
1. Call `get_server_metadata` on startup to confirm URLs and server version.
2. Use `list_qdrant_collections` before writing to ensure the correct collection is targeted.
3. Reference `get_mcp_documentation` with `section` (e.g., `Tool Catalog`) when constructing task plans.
4. Persist new knowledge (research, patterns, narrative beats) before handing work to downstream agents so they can query it.
5. Use QA and feedback tools to keep regression coverage and playtest learnings centralized.

## Maintenance
- Update `config/collections.json` and rerun `init-collections.sh` when adding new knowledge domains.
- The entrypoint waits for Qdrant to become healthy before initializing collections to avoid race conditions.
- Ensure the embedding service exposes `POST /embed` and returns either a single vector or an array of vectors depending on input.
- `npm run dev` runs the server via the `ts-node` ESM loader for local development; `npm start` performs a full build (`tsc`) before launching the compiled output from `dist/index.js`.
- Rebuild the Docker image (`docker build -t game-dev-mcp .`) after modifying TypeScript sources.
