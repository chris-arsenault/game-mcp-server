# Game MCP Server

MCP (Model Context Protocol) server that backs the **genai-game-engine** project with research, architecture, narrative, QA, and playtest knowledge stored in Qdrant. The server exposes the Streamable HTTP MCP transport on port `3000` by default, so Claude or any MCP-compatible client can connect over HTTP or curl.

## Prerequisites

- Node.js 18+
- Qdrant instance (defaults to `http://qdrant:6333`)
- Embedding service exposing `POST /embed` (defaults to `http://embedding-service:80`)

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
   curl -i -X POST http://localhost:3000/mcp \
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
   curl -i -X POST http://localhost:3000/mcp \
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
   curl -i -X POST http://localhost:3000/mcp \
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
   curl -N http://localhost:3000/mcp \
     -H 'Accept: text/event-stream' \
     -H 'Mcp-Session-Id: <SESSION_ID>' \
     -H 'Mcp-Protocol-Version: 2024-11-05'
   ```

   Leave this curl running to receive streaming responses (e.g. logging events). Use `Ctrl+C` to exit.

5. **Terminate the session (optional cleanup)**

   ```bash
   curl -i -X DELETE http://localhost:3000/mcp \
     -H 'Mcp-Session-Id: <SESSION_ID>' \
     -H 'Mcp-Protocol-Version: 2024-11-05'
   ```

## Collections & Tools

- `config/collections.json` documents every Qdrant collection, its cardinality, and which Claude agents rely on it.
- `docs/mcp/usage.md` covers Claude integration and the full MCP tool catalog exposed by the server.

Use `list_qdrant_collections` and `get_mcp_documentation` to programmatically discover server capabilities from clients.
