# Find Unreferenced Functions MCP Server

This project exposes a single MCP tool (`find_unreferenced_functions`) over STDIO. It walks a TypeScript source tree and reports named functions that have no detected references.

## Requirements

- Node.js 18+
- Optional: `SOURCE_ROOT` environment variable to override the directory scanned (defaults to `../mcp/src` relative to this package).

## Installation

```bash
cd find-unreferenced
npm install
```

## Usage

Run the server over STDIO:

```bash
npm run start
```

Or for development with ts-node:

```bash
npm run dev
```

### Adding to Codex

To expose this tool inside Codex, add an entry to your `.codex/config.toml` pointing at the STDIO server. Example:

```toml
[[servers]]
name = "find-unreferenced-functions"
type = "stdio"
command = "npm"
args = ["run", "start"]
cwd = "/absolute/path/to/game-mcp-server/find-unreferenced"
```

After updating the config, restart Codex (or reload servers if supported). Codex will invoke `npm run start`, which builds the TypeScript sources and launches the STDIO MCP server. Use `SOURCE_ROOT` if your target project lives somewhere other than `../mcp/src`.

## Tool contract

### `find_unreferenced_functions`

| Parameter | Type   | Description                                                                 |
| --------- | ------ | --------------------------------------------------------------------------- |
| `limit`   | number | Optional maximum number of unreferenced functions to return.                |
| `source_root` | string | Optional override for the source directory to scan. Defaults to `SOURCE_ROOT` env var or `../mcp/src`. |

The tool responds with a JSON payload summarizing how many files were scanned and listing each unreferenced function with its location.
