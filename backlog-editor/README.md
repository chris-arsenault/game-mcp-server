# Backlog Editor

A lightweight visual editor for the project backlog and handoff notes. It exposes a small Express API that talks directly to Qdrant and an embedding service, and a React SPA (via Vite) that renders a kanban board for PBIs plus a quick handoff text editor.

## Features

- **Kanban board** for backlog items grouped by status with inline editing for status, priority, and description.
- **Create new PBIs** with default status/priority.
- **Top items endpoint** to fetch the highest‑priority unfinished work.
- **Handoff loop** with a simple textarea to fetch and overwrite the shared handoff document.
- **REST API** (`/api/...`) suitable for automation or integration with other tools.

## Prerequisites

- Node.js 18+
- Running instances of:
  - Qdrant (default `http://localhost:6333`)
  - Embedding service exposing `POST /embed` (default `http://localhost:8080`)
- Collections already created in Qdrant:
  - `backlog_items`
  - `handoff_notes`

If you have not created the collections, run `mcp/init-collections.sh` or replicate the final two `curl` commands from that script.

## Configuration

Environment variables (optional):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4005` | HTTP port for the Express API and static site. |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST endpoint. |
| `EMBEDDING_URL` | `http://localhost:8080` | Embedding service base URL. |
| `BACKLOG_COLLECTION` | `backlog_items` | Qdrant collection name for backlog PBIs. |
| `HANDOFF_COLLECTION` | `handoff_notes` | Qdrant collection name for the shared handoff document. |
| `HANDOFF_ID` | `11111111-1111-1111-1111-111111111111` | Point identifier used for the handoff note. |

Create a `.env` file in `backlog-editor/` or export variables before running the app.

## Scripts

```bash
# Install dependencies
npm install

# Start API and Vite dev server concurrently
npm run dev

# Build client (Vite) + server (tsc)
npm run build

# Run compiled server with pre-built client
npm start
```

During development:

- API: `http://localhost:4005/api/...`
- Client: `http://localhost:5173/` (proxied to the API).

After `npm run build`, static assets land in `dist/client` and server bundle in `dist/server`. `npm start` serves the compiled assets and API from the same port.

## REST Endpoints

- `GET /api/handoff` – Fetch the current handoff payload.
- `PUT /api/handoff` – Update the handoff note (`{ content, updated_by? }`).
- `GET /api/backlog` – Return all backlog items (limited to 200).
- `GET /api/backlog/top?limit=5&includeCompleted=false` – Highest priority PBIs.
- `POST /api/backlog` – Create a new item (`{ title, description, status?, priority? }`).
- `PUT /api/backlog/:id` – Update an existing item (status/priority/description, etc.).

The React client uses these routes via relative `/api/...` requests, so the proxy works automatically in dev/production.

## Project Structure

```
backlog-editor/
├── index.html          # Vite entry
├── package.json        # Scripts & dependencies
├── server/             # Express API + Qdrant/embedding helpers
└── src/                # React application (kanban UI, handoff editor)
```

Feel free to adapt styling, add route guards, or expand the API as the backlog evolves.

## Docker

A Dockerfile is provided for production deployment. From the repository root:

```bash
docker compose build backlog-editor
docker compose up -d backlog-editor
```

The container listens on port `4005` internally; the default compose file maps it to `5365`.
