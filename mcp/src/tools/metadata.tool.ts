import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { CacheService } from "../services/cache.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const collectionsPath = path.join(projectRoot, "config", "collections.json");
const documentationPath = path.join(projectRoot, "docs", "mcp", "usage.md");

async function readFileSafe(filePath: string): Promise<string | null> {
    try {
        return await readFile(filePath, 'utf-8');
    } catch (error: any) {
        if (error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export class MetadataTool {
    constructor(private cache: CacheService) {}

    async getServerMetadata() {
        return {
            name: "game-dev-mcp",
            version: "1.0.0",
            description: "MCP server supporting game development workflows (research, architecture, narrative, testing, feedback) backed by Qdrant.",
            services: {
                qdrant: process.env.QDRANT_URL || "http://qdrant:6333",
                embeddings: process.env.EMBEDDING_URL || "http://embedding-service:80"
            },
            collections_endpoint: "/collections",
            documentation_tool: "get_mcp_documentation",
            tool_discovery: "list_qdrant_collections",
            environment: {
                node: process.version,
                platform: process.platform
            }
        };
    }

    async listCollections() {
        const cacheKey = "metadata:collections";
        const cached = this.cache.get<any>(cacheKey);
        if (cached) {
            return {
                source: "cache",
                ...cached
            };
        }

        const raw = await readFileSafe(collectionsPath);
        if (!raw) {
            const payload = {
                source: "missing",
                message: "collections.json not found",
                collections: []
            };
            this.cache.set(cacheKey, payload, 5 * 60 * 1000);
            return payload;
        }

        const parsed = JSON.parse(raw);

        const payload = {
            source: "file",
            collections: parsed.collections ?? []
        };

        this.cache.set(cacheKey, payload, 30 * 60 * 1000);

        return payload;
    }

    async getDocumentation(args: { section?: string } = {}) {
        const { section } = args;
        const cacheKey = `metadata:doc:${section ?? "all"}`;
        const cached = this.cache.get<any>(cacheKey);
        if (cached) {
            return cached;
        }

        const doc = await readFileSafe(documentationPath);
        if (!doc) {
            const result = {
                section: section ?? "all",
                content: "Documentation file not found at docs/mcp/usage.md"
            };
            this.cache.set(cacheKey, result, 5 * 60 * 1000);
            return result;
        }

        let content = doc;

        if (section) {
            const regex = new RegExp(`^##\\s+${this.escapeRegex(section)}\\s*$(.*?)^##\\s+`, "ms");
            const match = doc.match(regex);
            if (match && match[1]) {
                content = match[1].trim();
            } else {
                content = `Section '${section}' not found. Available sections:\n${this.listSections(doc).join("\n")}`;
            }
        }

        const result = {
            section: section ?? "all",
            content
        };

        this.cache.set(cacheKey, result, 60 * 60 * 1000);
        return result;
    }

    private listSections(doc: string) {
        return (doc.match(/^##\s+(.*)$/gm) || []).map(line => line.replace(/^##\s+/, "").trim());
    }

    private escapeRegex(value: string) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
