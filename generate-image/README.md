# Generate Image MCP Server

This project exposes a single MCP tool (`generate_image`) over STDIO. It wraps OpenAI's image generation API (`gpt-image-1` by default) and saves the resulting base64 payload to disk.

## Requirements

- Node.js 18+
- `OPENAI_API_KEY` environment variable set
- Optional overrides: `OPENAI_BASE_URL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_BACKGROUND`

## Installation

```bash
cd generate-image
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
name = "generate-image"
type = "stdio"
command = "npm"
args = ["run", "start"]
cwd = "/absolute/path/to/game-mcp-server/generate-image"
```

After updating the config, restart Codex (or reload servers if supported). Codex will invoke `npm run start`, which builds the TypeScript sources and launches the STDIO MCP server. Ensure `OPENAI_API_KEY` (and any optional overrides) are available in the environment Codex uses to spawn the process.

## Tool contract

### `generate_image`

| Parameter      | Type   | Description                                                   |
| -------------- | ------ | ------------------------------------------------------------- |
| `prompt`       | string | **Required.** Text used to describe the desired image.        |
| `file_location`| string | **Required.** Output path where the decoded image bytes are written. |
| `model`        | string | Optional model override (defaults to `gpt-image-1`).          |
| `size`         | string | Optional size (`1024x1024`, `1536x1024`, or `1024x1536`).     |
| `quality`      | string | Optional quality setting (`auto`, `high`, `medium`, `low`). |
| `background`   | string | Optional background (`auto`, `transparent`, `opaque`).        |

Successful responses report the saved file path, byte length, and any revised prompt returned by OpenAI.

Errors are surfaced back to the MCP client if OpenAI rejects the request or the file cannot be written.
