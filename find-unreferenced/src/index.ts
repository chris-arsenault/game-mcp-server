import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { analyzeUnreferencedFunctions } from "./analyzer.js";

const server = new Server(
    {
        name: "find-unreferenced-functions",
        version: "1.0.0"
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

function getDefaultSourceRoot(): string {
    const envOverride = process.env.SOURCE_ROOT;
    if (envOverride && envOverride.trim().length > 0) {
        return path.resolve(envOverride);
    }

    return path.resolve(process.cwd(), "../mcp/src");
}

function resolveSourceRoot(input?: unknown): string {
    const base =
        typeof input === "string" && input.trim().length > 0
            ? input
            : getDefaultSourceRoot();

    const resolved = path.resolve(base);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`source_root does not exist or is not a directory: ${resolved}`);
    }

    return resolved;
}

function parseLimit(input: unknown): number | undefined {
    if (input == null) {
        return undefined;
    }
    if (typeof input !== "number") {
        throw new Error("limit must be a number");
    }
    if (!Number.isInteger(input) || input <= 0) {
        throw new Error("limit must be a positive integer");
    }
    return input;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "find_unreferenced_functions",
            description: "Scan a TypeScript source tree and list named functions that have no references.",
            inputSchema: {
                type: "object",
                properties: {
                    limit: {
                        type: "integer",
                        description: "Optional maximum number of results to return.",
                        minimum: 1
                    },
                    source_root: {
                        type: "string",
                        description: "Optional override for the directory to scan. Defaults to ../mcp/src relative to this package or SOURCE_ROOT env var."
                    }
                },
                additionalProperties: false
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== "find_unreferenced_functions") {
        throw new Error(`Unknown tool: ${name}`);
    }

    const resolvedArgs = (args ?? {}) as Record<string, unknown>;
    const limit = parseLimit(resolvedArgs.limit);
    const sourceRoot = resolveSourceRoot(resolvedArgs.source_root);

    const analysis = analyzeUnreferencedFunctions({
        sourceRoot,
        limit
    });

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(analysis, null, 2)
            }
        ]
    };
});

const transport = new StdioServerTransport();
await server.connect(transport);
