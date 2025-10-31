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
| `cache_research` | Persist markdown or text research findings (topic, findings, sources, tags) for later reuse. |
| `check_consistency` | Evaluate proposed architecture/narrative notes against stored decisions to flag conflicts. |
| `check_research_exists` | Determine whether similar research already lives in `research_findings` before duplicating work. |
| `explore_graph_entity` | Pull a Neo4j node plus inbound/outbound relationships from the knowledge graph. |
| `fetch_handoff` | Retrieve the most recent markdown handoff summary written at session end. |
| `find_dialogue` | Semantic search across stored branching dialogue scenes. |
| `find_similar_patterns` | Locate previously recorded implementation patterns similar to the provided description. |
| `get_architecture_history` | Scroll architectural decision history filtered by scope/tags. |
| `get_bug_fix` | Fetch a canonical bug fix entry by issue identifier. |
| `get_dialogue_scene` | Retrieve a dialogue scene (including branches) by its scene ID. |
| `get_mcp_documentation` | Return this documentation file or a specific section via optional `section`. |
| `get_narrative_outline` | Assemble outline data for narrative beats/quests from stored elements. |
| `get_pattern_by_name` | Return a stored implementation pattern by its exact name. |
| `get_server_metadata` | Basic server capabilities, environment, and discovery entry points. |
| `list_lore` | Enumerate lore entries filtered by category/region to support onboarding. |
| `list_qdrant_collections` | Mirror `config/collections.json`, exposing collection metadata and agent ownership. |
| `list_test_strategies_by_focus` | List QA strategies associated with a particular area (combat, UI, etc.). |
| `match_bug_fix` | Match logs/code snippets to known bug fixes via embeddings + exact error strings. |
| `query_architecture` | Semantic query across architectural decision records. |
| `query_playtest_feedback` | Vector search qualitative playtest feedback with optional severity/tags filters. |
| `query_research` | Retrieve research findings semantically similar to the given query. |
| `query_test_strategies` | Semantic search across stored QA strategies. |
| `record_bug_fix` | Store a vetted fix pattern with anti-pattern examples and error fingerprints. |
| `record_playtest_feedback` | Persist playtest feedback (positives/negatives/suggestions) into `gameplay_feedback`. |
| `create_backlog_item` | Create a new backlog item capturing description, priority, status, tags, and planning metadata. |
| `update_backlog_item` | Update fields on an existing backlog item without overwriting unspecified data. |
| `search_backlog_by_tag` | Filter backlog items by tags/status/priority/owner without semantic matching. |
| `search_backlog_semantic` | Semantic search across backlog items with optional structured filters. |
| `get_top_backlog_items` | Fetch the highest-priority unfinished backlog items (defaults to top five). |
| `search_graph_semantic` | Perform Qdrant vector search against knowledge-graph embeddings (`code_graph`). |
| `search_lore` | Semantic search across lore entries, optionally filtering by category/region/tags. |
| `search_narrative_elements` | Semantic search over narrative beats, acts, and character elements. |
| `store_architecture_decision` | Record an architectural decision with rationale, alternatives, and scope metadata. |
| `store_dialogue_scene` | Save branching dialogue script metadata and transcripts. |
| `store_handoff` | Write markdown session handoff notes to share context with future sessions. |
| `store_lore_entry` | Persist lore entries (factions, locations, artifacts, etc.). |
| `store_narrative_element` | Capture narrative elements (quests, beats, character arcs) for later retrieval. |
| `store_pattern` | Persist implementation/design pattern details and associated metadata. |
| `store_test_strategy` | Record QA strategy coverage, scenarios, and automation state. |
| `summarize_playtest_feedback` | Summarize feedback corpus by severity, tags, and sample entries. |
| `validate_against_patterns` | Compare proposed content against stored patterns/decisions for alignment. |

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
