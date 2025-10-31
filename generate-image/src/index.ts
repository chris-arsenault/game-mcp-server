import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import OpenAI from "openai";
import { OpenAIImageService, GenerateImageArgs } from "./openaiImageService.js";

const server = new Server(
    {
        name: "generate-image",
        version: "1.0.0"
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

function createImageService(): OpenAIImageService {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error("[generate-image] OPENAI_API_KEY must be set");
        process.exit(1);
    }

    const client = new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL
    });

    const defaults = {
        model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
        size: process.env.OPENAI_IMAGE_SIZE ?? "1024x1024",
        quality: process.env.OPENAI_IMAGE_QUALITY ?? "auto",
        background: process.env.OPENAI_IMAGE_BACKGROUND ?? "auto"
    } as const;

    return new OpenAIImageService(client, defaults);
}

const imageService = createImageService();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "generate_image",
            description: "Generate an image using OpenAI and save it to disk as decoded binary data.",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Detailed description of the desired image." },
                    model: { type: "string", description: "Optional OpenAI model identifier (defaults to gpt-image-1)." },
                    size: { type: "string", description: "Image dimensions, e.g., 1024x1024." },
                    quality: { type: "string", description: "Quality preset: auto, high, medium, low, hd, standard." },
                    background: { type: "string", description: "Background handling: auto, transparent, or opaque." },
                    file_location: { type: "string", description: "Absolute or relative file path where the generated image will be written." }
                },
                required: ["prompt", "file_location"],
                additionalProperties: false
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== "generate_image") {
        throw new Error(`Unknown tool: ${name}`);
    }

    const resolvedArgs = (args ?? {}) as Record<string, unknown>;
    const prompt = String(resolvedArgs.prompt ?? "").trim();
    if (!prompt) {
        throw new Error("prompt is required");
    }

    const fileLocationRaw = resolvedArgs.file_location;
    if (typeof fileLocationRaw !== "string" || fileLocationRaw.trim() === "") {
        throw new Error("file_location must be a non-empty string");
    }
    const fileLocation = path.resolve(fileLocationRaw);

    const options: GenerateImageArgs = {
        prompt,
        model: typeof resolvedArgs.model === "string" ? resolvedArgs.model : undefined,
        size: typeof resolvedArgs.size === "string" ? resolvedArgs.size : undefined,
        quality: typeof resolvedArgs.quality === "string" ? resolvedArgs.quality : undefined,
        background: typeof resolvedArgs.background === "string" ? resolvedArgs.background : undefined
    };

    const result = await imageService.generate(options);

    await fs.mkdir(path.dirname(fileLocation), { recursive: true });
    await fs.writeFile(fileLocation, result.buffer);

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    {
                        file: fileLocation,
                        bytes: result.buffer.length,
                        revised_prompt: result.revisedPrompt ?? null
                    },
                    null,
                    2
                )
            }
        ]
    };
});

const transport = new StdioServerTransport();
await server.connect(transport);
