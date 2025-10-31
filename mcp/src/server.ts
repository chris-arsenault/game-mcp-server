import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, NextFunction } from "express";
import { Server as HttpServer, IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import { QdrantService } from "./services/qdrant.service.js";
import { EmbeddingService } from "./services/embedding.service.js";
import { CacheService } from "./services/cache.service.js";
import { Neo4jService } from "./services/neo4j.service.js";
import { ResearchTool } from "./tools/research.tool.js";
import { PatternTool } from "./tools/pattern.tool.js";
import { ArchitectureTool } from "./tools/architecture.tool.js";
import { ValidationTool } from "./tools/validation.tool.js";
import { NarrativeTool } from "./tools/narrative.tool.js";
import { WorldbuildingTool } from "./tools/worldbuilding.tool.js";
import { DialogueTool } from "./tools/dialogue.tool.js";
import { TestingTool } from "./tools/testing.tool.js";
import { FeedbackTool } from "./tools/feedback.tool.js";
import { MetadataTool } from "./tools/metadata.tool.js";
import { BugFixTool } from "./tools/bugfix.tool.js";
import { GraphTool } from "./tools/graph.tool.js";
import { HandoffTool } from "./tools/handoff.tool.js";
import { BacklogTool } from "./tools/backlog.tool.js";
import { ImageGenTool } from "./tools/imagegen.tool.js";
import { OpenAIImageService } from "./services/openai-image.service.js";

export class GameDevMCPServer {
    private server: Server;
    private qdrant: QdrantService;
    private embedding: EmbeddingService;
    private neo4j: Neo4jService;
    private cache: CacheService;
    private tools: Map<string, any>;
    private httpServer?: HttpServer;
    private transport?: StreamableHTTPServerTransport;
    private sseSessions: Map<string, SSEServerTransport>;
    private toolStats: Map<string, { writes: number; reads: number }>;
    private hasActiveSession = false;
    private currentSessionId?: string;
    private readonly writeTools = new Set<string>([
        "cache_research",
        "store_pattern",
        "store_architecture_decision",
        "store_narrative_element",
        "store_lore_entry",
        "store_dialogue_scene",
        "store_test_strategy",
        "record_playtest_feedback",
        "record_bug_fix",
        "store_handoff",
        "create_backlog_item",
        "update_backlog_item"
    ]);
    private readonly readTools = new Set<string>([
        "query_research",
        "check_research_exists",
        "find_similar_patterns",
        "get_pattern_by_name",
        "query_architecture",
        "get_architecture_history",
        "validate_against_patterns",
        "check_consistency",
        "search_narrative_elements",
        "get_narrative_outline",
        "search_lore",
        "list_lore",
        "find_dialogue",
        "get_dialogue_scene",
        "query_test_strategies",
        "list_test_strategies_by_focus",
        "query_playtest_feedback",
        "summarize_playtest_feedback",
        "match_bug_fix",
        "get_bug_fix",
        "get_server_metadata",
        "list_qdrant_collections",
        "get_mcp_documentation",
        "explore_graph_entity",
        "search_graph_semantic",
        "fetch_handoff",
        "search_backlog_by_tag",
        "search_backlog_semantic",
        "get_top_backlog_items",
        "generate_image"
    ]);

    constructor() {
        this.server = new Server(
            {
                name: "game-dev-mcp",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        // Initialize services
        this.qdrant = new QdrantService(
            process.env.QDRANT_URL || "http://localhost:6333"
        );
        this.embedding = new EmbeddingService(
            process.env.EMBEDDING_URL || "http://localhost:8080"
        );
        this.neo4j = new Neo4jService(
            process.env.NEO4J_URL || "bolt://localhost:7687",
            process.env.NEO4J_USER || "neo4j",
            process.env.NEO4J_PASSWORD || "password"
        );
        this.cache = new CacheService();
        this.sseSessions = new Map();
        this.toolStats = new Map();

        // Initialize tools
        this.tools = new Map();
        this.initializeTools();
        this.setupHandlers();
    }

    private initializeTools() {
        const researchTool = new ResearchTool(this.qdrant, this.embedding);
        const patternTool = new PatternTool(this.qdrant, this.embedding);
        const architectureTool = new ArchitectureTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const validationTool = new ValidationTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const narrativeTool = new NarrativeTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const worldbuildingTool = new WorldbuildingTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const dialogueTool = new DialogueTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const testingTool = new TestingTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const feedbackTool = new FeedbackTool(
            this.qdrant,
            this.embedding,
            this.cache
        );
        const metadataTool = new MetadataTool(this.cache);
        const bugFixTool = new BugFixTool(this.qdrant, this.embedding);
        const graphTool = new GraphTool(
            this.neo4j,
            this.qdrant,
            this.embedding,
            process.env.GRAPH_COLLECTION || "code_graph"
        );
        const handoffTool = new HandoffTool(this.qdrant, this.embedding);
        const backlogTool = new BacklogTool(this.qdrant, this.embedding);

        const openaiApiKey = process.env.OPENAI_API_KEY;
        let imageGenTool: ImageGenTool | undefined;
        if (openaiApiKey) {
            const imageService = new OpenAIImageService(openaiApiKey, {
                baseURL: process.env.OPENAI_BASE_URL,
                defaultModel: process.env.OPENAI_IMAGE_MODEL,
                defaultSize: process.env.OPENAI_IMAGE_SIZE,
                defaultQuality: process.env.OPENAI_IMAGE_QUALITY,
                defaultBackground: process.env.OPENAI_IMAGE_BACKGROUND
            });
            imageGenTool = new ImageGenTool(imageService);
        } else {
            console.warn("[ImageGenTool] OPENAI_API_KEY not set. generate_image tool will return an error when invoked.");
        }

        // Register research tools
        this.tools.set("cache_research", researchTool.cacheResearch.bind(researchTool));
        this.tools.set("query_research", researchTool.queryResearch.bind(researchTool));

        this.tools.set("check_research_exists", researchTool.checkExists.bind(researchTool));


        // Register pattern tools
        this.tools.set("store_pattern", patternTool.storePattern.bind(patternTool));
        this.tools.set("find_similar_patterns", patternTool.findSimilar.bind(patternTool));
        this.tools.set("get_pattern_by_name", patternTool.getByName.bind(patternTool));

        // Register architecture tools
        this.tools.set("store_architecture_decision", architectureTool.storeDecision.bind(architectureTool));
        this.tools.set("query_architecture", architectureTool.queryDecisions.bind(architectureTool));
        this.tools.set("get_architecture_history", architectureTool.getHistory.bind(architectureTool));

        // Register validation tools
        this.tools.set("validate_against_patterns", validationTool.validatePatterns.bind(validationTool));
        this.tools.set("check_consistency", validationTool.checkConsistency.bind(validationTool));

        // Register narrative tools
        this.tools.set("store_narrative_element", narrativeTool.storeNarrativeElement.bind(narrativeTool));
        this.tools.set("search_narrative_elements", narrativeTool.searchNarrativeElements.bind(narrativeTool));
        this.tools.set("get_narrative_outline", narrativeTool.getNarrativeOutline.bind(narrativeTool));

        // Register worldbuilding tools
        this.tools.set("store_lore_entry", worldbuildingTool.storeLoreEntry.bind(worldbuildingTool));
        this.tools.set("search_lore", worldbuildingTool.searchLore.bind(worldbuildingTool));
        this.tools.set("list_lore", worldbuildingTool.listLore.bind(worldbuildingTool));

        // Register dialogue tools
        this.tools.set("store_dialogue_scene", dialogueTool.storeDialogueScene.bind(dialogueTool));
        this.tools.set("find_dialogue", dialogueTool.findDialogue.bind(dialogueTool));
        this.tools.set("get_dialogue_scene", dialogueTool.getScene.bind(dialogueTool));

        // Register testing tools
        this.tools.set("store_test_strategy", testingTool.storeTestStrategy.bind(testingTool));
        this.tools.set("query_test_strategies", testingTool.queryTestStrategies.bind(testingTool));
        this.tools.set("list_test_strategies_by_focus", testingTool.listByFocusArea.bind(testingTool));

        // Register feedback tools
        this.tools.set("record_playtest_feedback", feedbackTool.recordFeedback.bind(feedbackTool));
        this.tools.set("query_playtest_feedback", feedbackTool.queryFeedback.bind(feedbackTool));
        this.tools.set("summarize_playtest_feedback", feedbackTool.summarizeFeedback.bind(feedbackTool));
        this.tools.set("record_bug_fix", bugFixTool.recordBugFix.bind(bugFixTool));
        this.tools.set("match_bug_fix", bugFixTool.matchBugFix.bind(bugFixTool));
        this.tools.set("get_bug_fix", bugFixTool.getBugFix.bind(bugFixTool));
        this.tools.set("explore_graph_entity", graphTool.exploreGraph.bind(graphTool));
        this.tools.set("search_graph_semantic", graphTool.searchGraph.bind(graphTool));
        this.tools.set("store_handoff", handoffTool.storeHandoff.bind(handoffTool));
        this.tools.set("fetch_handoff", handoffTool.fetchHandoff.bind(handoffTool));
        this.tools.set("create_backlog_item", backlogTool.createBacklogItem.bind(backlogTool));
        this.tools.set("update_backlog_item", backlogTool.updateBacklogItem.bind(backlogTool));
        this.tools.set("search_backlog_by_tag", backlogTool.searchBacklogByTag.bind(backlogTool));
        this.tools.set("search_backlog_semantic", backlogTool.searchBacklogSemantics.bind(backlogTool));
        this.tools.set("get_top_backlog_items", backlogTool.getTopBacklogItems.bind(backlogTool));
        if (imageGenTool) {
            this.tools.set("generate_image", imageGenTool.generateImage.bind(imageGenTool));
        } else {
            this.tools.set("generate_image", async () => {
                throw new Error("Image generation unavailable: OPENAI_API_KEY not configured");
            });
        }

        // Register metadata/discovery tools
        this.tools.set("get_server_metadata", metadataTool.getServerMetadata.bind(metadataTool));
        this.tools.set("list_qdrant_collections", metadataTool.listCollections.bind(metadataTool));
        this.tools.set("get_mcp_documentation", metadataTool.getDocumentation.bind(metadataTool));
    }

    private incrementToolStat(tool: string, type: 'writes' | 'reads') {
        const record = this.toolStats.get(tool) || { writes: 0, reads: 0 };
        record[type] = record[type] + 1;
        this.toolStats.set(tool, record);
    }

    private wasSuccessfulWrite(result: unknown): boolean {
        if (!result || typeof result !== 'object') {
            return false;
        }
        const obj = result as Record<string, unknown>;
        if ('updated' in obj && typeof obj.updated === 'boolean') {
            return obj.updated;
        }
        if ('success' in obj && obj.success === false) {
            return false;
        }
        if ('id' in obj && obj.id) {
            return true;
        }
        if ('ids' in obj && Array.isArray(obj.ids) && obj.ids.length > 0) {
            return true;
        }
        if ('success' in obj && obj.success === true) {
            return true;
        }
        return false;
    }

    private hasReadableContent(result: unknown): boolean {
        if (!result) {
            return false;
        }
        if (Array.isArray(result)) {
            return result.length > 0;
        }
        if (typeof result === 'object') {
            const obj = result as Record<string, unknown>;
            if ('isError' in obj && obj.isError) {
                return false;
            }
            if ('count' in obj && typeof obj.count === 'number') {
                return obj.count > 0;
            }
            if ('results' in obj && Array.isArray(obj.results)) {
                return obj.results.length > 0;
            }
            if ('matches' in obj && Array.isArray(obj.matches)) {
                return obj.matches.length > 0;
            }
            if ('found' in obj && typeof obj.found === 'boolean') {
                return obj.found;
            }
            if ('entity' in obj) {
                return true;
            }
            if ('content' in obj && typeof obj.content === 'string') {
                return obj.content.trim().length > 0;
            }
            if ('message' in obj && typeof obj.message === 'string') {
                return obj.message.trim().length > 0;
            }
            const keys = Object.keys(obj);
            if (keys.length > 0) {
                const meaningful = keys.some((key) => !['success', 'cached', 'count', 'results', 'matches', 'found', 'updated'].includes(key));
                if (meaningful) {
                    return true;
                }
            }
        }
        return false;
    }

    private buildTransport(): StreamableHTTPServerTransport {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (sessionId) => {
                this.hasActiveSession = true;
                this.currentSessionId = sessionId ?? undefined;
                console.info(
                    "[MCP] Streamable HTTP session initialized",
                    { sessionId: this.currentSessionId }
                );
            },
            onsessionclosed: (sessionId) => {
                console.info("[MCP] Streamable HTTP session closed", { sessionId });
                this.hasActiveSession = false;
                this.currentSessionId = undefined;
            }
        });
        return transport;
    }

    private async initializeTransport() {
        const newTransport = this.buildTransport();
        await this.server.connect(newTransport);
        this.transport = newTransport;
        this.hasActiveSession = false;
        this.currentSessionId = undefined;
    }

    private async resetTransport() {
        console.warn("[MCP] Resetting Streamable HTTP transport for new session", {
            previousSessionId: this.currentSessionId
        });
        await this.closeAllSseSessions();
        if (this.transport) {
            try {
                await this.transport.close();
            } catch (error) {
                console.error("[MCP] Error closing previous transport", {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        await this.initializeTransport();
    }

    private async closeAllSseSessions() {
        if (this.sseSessions.size === 0) {
            return;
        }
        const sessions = Array.from(this.sseSessions.values());
        this.sseSessions.clear();
        for (const session of sessions) {
            try {
                await session.close();
            } catch (error) {
                console.warn("[MCP] Failed to close SSE session", {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    private isInitializationRequest(body: unknown): boolean {
        if (!body) {
            return false;
        }
        const messages = Array.isArray(body) ? body : [body];
        return messages.some((message) => {
            if (!message || typeof message !== "object") {
                return false;
            }
            const rpc = message as Record<string, unknown>;
            return rpc.jsonrpc === "2.0" && rpc.method === "initialize";
        });
    }

    private getConfiguredBaseUrl(): string | undefined {
        return (
            process.env.MCP_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
            process.env.PUBLIC_MCP_BASE_URL?.replace(/\/$/, "")
        );
    }

    private normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
        if (!value) {
            return undefined;
        }
        return Array.isArray(value) ? value[0] : value;
    }

    private getPublicBaseUrl(req?: IncomingMessage): string | undefined {
        const configured = this.getConfiguredBaseUrl();
        if (configured) {
            return configured;
        }
        if (!req) {
            return undefined;
        }
        const headers = req.headers ?? {};
        const forwardedProto = this.normalizeHeaderValue(headers["x-forwarded-proto"] as string | string[] | undefined);
        const forwardedHost = this.normalizeHeaderValue(headers["x-forwarded-host"] as string | string[] | undefined);
        const hostHeader = forwardedHost ?? this.normalizeHeaderValue(headers.host as string | string[] | undefined);
        if (!hostHeader) {
            return undefined;
        }
        const proto = forwardedProto ?? ((req.socket as any)?.encrypted ? "https" : "http");
        return `${proto}://${hostHeader}`.replace(/\/$/, "");
    }

    private getSessionHeaderFromRequest(req: Request): string | undefined {
        const raw = req.headers["mcp-session-id"];
        if (typeof raw === "string") {
            return raw;
        }
        if (Array.isArray(raw) && raw.length > 0) {
            return raw[0];
        }
        const headerMethod = (req as Request).header?.bind(req);
        const headerValue = headerMethod ? headerMethod("Mcp-Session-Id") : undefined;
        return headerValue ?? undefined;
    }

    private absolutizeRelativePath(path: string, baseUrl?: string): string {
        if (!baseUrl) {
            return path;
        }
        if (!path.startsWith("/")) {
            return path;
        }
        if (!path.startsWith("/messages")) {
            return path;
        }
        try {
            const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
            return new URL(path, normalizedBase).toString();
        } catch (_error) {
            return path;
        }
    }

    private absolutizeMessageEndpoints<T>(value: T, baseUrl: string): T {
        const self = this;
        const transform = (input: unknown): unknown => {
            if (typeof input === "string") {
                return self.absolutizeRelativePath(input, baseUrl);
            }
            if (Array.isArray(input)) {
                let changed = false;
                const result = input.map((item) => {
                    const next = transform(item);
                    if (next !== item) {
                        changed = true;
                    }
                    return next;
                });
                return changed ? result : input;
            }
            if (input && typeof input === "object") {
                let changed = false;
                const record = input as Record<string, unknown>;
                const result: Record<string, unknown> = {};
                for (const [key, original] of Object.entries(record)) {
                    const next = transform(original);
                    result[key] = next;
                    if (next !== original) {
                        changed = true;
                    }
                }
                return changed ? result : input;
            }
            return input;
        };
        return transform(value) as T;
    }

    private patchSseResponse(res: Response | ServerResponse, baseUrl: string) {
        const marker = Symbol.for("mcp-sse-patched");
        if ((res as any)[marker]) {
            return;
        }
        (res as any)[marker] = true;

        const originalWrite = res.write.bind(res) as typeof res.write;
        const self = this;
        const patchedWrite = (function (
            chunk: any,
            encoding?: BufferEncoding | ((error?: Error | null) => void),
            callback?: (error?: Error | null) => void
        ): boolean {
            let enc = encoding;
            let cb = callback;

            if (typeof enc === "function") {
                cb = enc;
                enc = undefined;
            }

            const normalizedEncoding = typeof enc === "string" ? enc : undefined;
            const decodeEncoding = (normalizedEncoding ?? "utf8") as BufferEncoding;

            const writeThrough = (chunkToWrite: any): boolean => {
                const args: unknown[] = [chunkToWrite];
                if (normalizedEncoding) {
                    args.push(normalizedEncoding);
                }
                if (cb) {
                    if (!normalizedEncoding) {
                        args.push(undefined);
                    }
                    args.push(cb);
                }
                return (originalWrite as (...applyArgs: any[]) => boolean).apply(res, args);
            };

            if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
                let text = typeof chunk === "string" ? chunk : chunk.toString(decodeEncoding);
                const originalText = text;

                if (text.startsWith("event: endpoint")) {
                    const lines = text.split("\n");
                    const dataIndex = lines.findIndex(line => line.startsWith("data: "));
                    if (dataIndex !== -1) {
                        const relative = lines[dataIndex].slice("data: ".length).trim();
                        const absolute = self.absolutizeRelativePath(relative, baseUrl);
                        lines[dataIndex] = `data: ${absolute}`;
                        text = lines.join("\n");
                    }
                }

                if (text.includes("data:")) {
                    const lines = text.split("\n");
                    let changed = false;
                    for (let i = 0; i < lines.length; i++) {
                        if (!lines[i].startsWith("data: ")) {
                            continue;
                        }
                        const payload = lines[i].slice("data: ".length);
                        const trimmed = payload.trim();
                        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                            try {
                                const parsed = JSON.parse(trimmed);
                                const rewritten = self.absolutizeMessageEndpoints(parsed, baseUrl);
                                if (rewritten !== parsed) {
                                    lines[i] = `data: ${JSON.stringify(rewritten)}`;
                                    changed = true;
                                }
                            } catch (_error) {
                                const absolute = self.absolutizeRelativePath(trimmed, baseUrl);
                                if (absolute !== trimmed) {
                                    lines[i] = `data: ${absolute}`;
                                    changed = true;
                                }
                            }
                        } else {
                            const absolute = self.absolutizeRelativePath(trimmed, baseUrl);
                            if (absolute !== trimmed) {
                                lines[i] = `data: ${absolute}`;
                                changed = true;
                            }
                        }
                    }
                    if (changed) {
                        text = lines.join("\n");
                    }
                }

                if (text !== originalText) {
                    chunk = typeof chunk === "string" ? text : Buffer.from(text, decodeEncoding);
                }
            }

            return writeThrough(chunk);
        }).bind(this) as typeof res.write;

        res.write = patchedWrite;
    }

    private setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "cache_research",
                    description: "Cache research findings for future reuse. Prevents redundant research on same topics.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            topic: { type: "string", description: "Research topic identifier (e.g., 'ECS-architecture', 'procedural-dungeon-generation')" },
                            findings: { type: "string", description: "Full research findings text" },
                            sources: { type: "array", items: { type: "string" }, description: "URLs or references" },
                            tags: { type: "array", items: { type: "string" }, description: "Categorization tags" }
                        },
                        required: ["topic", "findings"]
                    }
                },
                {
                    name: "store_handoff",
                    description: "Store the end-of-session handoff notes in markdown for future agents.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "Markdown content describing the current state." },
                            updated_by: { type: "string", description: "Agent identifier." },
                            tags: { type: "array", items: { type: "string" }, description: "Optional tags." }
                        },
                        required: ["content"]
                    }
                },
                {
                    name: "fetch_handoff",
                    description: "Retrieve the most recent handoff notes at the start of a session.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                        additionalProperties: false
                    }
                },
                {
                    name: "create_backlog_item",
                    description: "Create a new product backlog item with full agile metadata for prioritisation.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Concise title for the backlog item." },
                            description: { type: "string", description: "Detailed problem or user story statement." },
                            status: { type: "string", description: "Workflow status (e.g., 'todo', 'in-progress', 'blocked', 'done')." },
                            priority: { type: "string", description: "Priority bucket (e.g., 'P0', 'P1', 'P2', 'P3')." },
                            next_steps: { type: "array", items: { type: "string" }, description: "Immediate actions required to progress the item." },
                            completed_work: { type: "array", items: { type: "string" }, description: "Deliverables already finished for this item." },
                            tags: { type: "array", items: { type: "string" }, description: "Searchable labels such as 'rendering', 'multiplayer'." },
                            owner: { type: "string", description: "Primary assignee or DRI for the backlog item." },
                            due_date: { type: "string", description: "Optional ISO8601 due date for time-bound items." },
                            sprint: { type: "string", description: "Iteration or milestone identifier (e.g., 'Sprint 14')." },
                            story_points: { type: "number", description: "Relative sizing value for planning poker / velocity tracking." },
                            acceptance_criteria: { type: "array", items: { type: "string" }, description: "Testable acceptance criteria or success conditions." },
                            dependencies: { type: "array", items: { type: "string" }, description: "Related item IDs or external blockers." },
                            notes: { type: "string", description: "Freeform notes, research links, or context." },
                            category: { type: "string", description: "Optional thematic grouping (e.g., 'tech-debt', 'narrative', 'systems')." }
                        },
                        required: ["title", "description", "status", "priority"]
                    }
                },
                {
                    name: "update_backlog_item",
                    description: "Update fields on an existing backlog item by ID while preserving untouched data.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "Existing backlog item identifier returned from creation." },
                            title: { type: "string" },
                            description: { type: "string" },
                            status: { type: "string" },
                            priority: { type: "string" },
                            next_steps: { type: "array", items: { type: "string" } },
                            completed_work: { type: "array", items: { type: "string" } },
                            tags: { type: "array", items: { type: "string" } },
                            owner: { type: "string" },
                            due_date: { type: "string" },
                            sprint: { type: "string" },
                            story_points: { type: "number" },
                            acceptance_criteria: { type: "array", items: { type: "string" } },
                            dependencies: { type: "array", items: { type: "string" } },
                            notes: { type: "string" },
                            category: { type: "string" }
                        },
                        required: ["id"]
                    }
                },
                {
                    name: "search_backlog_by_tag",
                    description: "Filter backlog items by labels, status, priority, or owner without semantic search.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            tags: { type: "array", items: { type: "string" }, description: "One or more tags to match (logical ANY)." },
                            status: { type: "string", description: "Optional workflow status filter." },
                            priority: { type: "string", description: "Optional priority filter." },
                            owner: { type: "string", description: "Optional owner / DRI filter." },
                            limit: { type: "number", description: "Maximum results to return (default 25)." }
                        }
                    }
                },
                {
                    name: "search_backlog_semantic",
                    description: "Semantic search across backlog items using embeddings with optional structured filters.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Natural language description of the item you need." },
                            tags: { type: "array", items: { type: "string" }, description: "Optional tags to narrow the scope." },
                            status: { type: "string", description: "Optional status restriction." },
                            priority: { type: "string", description: "Optional priority filter." },
                            owner: { type: "string", description: "Optional owner filter." },
                            limit: { type: "number", description: "Maximum results to return (default 10)." },
                            min_score: { type: "number", description: "Similarity threshold between 0-1 (default 0.55)." }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_top_backlog_items",
                    description: "Return the highest-priority unfinished backlog items (defaults to top 5).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            limit: { type: "number", description: "Maximum number of items to return (default 5, max 20)." },
                            includeCompleted: { type: "boolean", description: "Set true to include completed items in the ranking." }
                        }
                    }
                },
                {
                    name: "generate_image",
                    description: "Generate images via OpenAI's image API with configurable size, quality, background, and response format.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            prompt: { type: "string", description: "Detailed description of the desired image." },
                            model: { type: "string", description: "OpenAI model identifier (default 'gpt-image-1')." },
                            size: { type: "string", description: "Image dimensions, e.g., '1024x1024'." },
                            quality: { type: "string", description: "Quality preset such as 'auto' or 'low' or 'high'." },
                            background: { type: "string", enum: ["auto", "transparent", "opaque"], description: "Background behavior for generated image." }
                        },
                        required: ["prompt"],
                        additionalProperties: false
                    }
                },
                {
                    name: "record_bug_fix",
                    description: "Store a canonical fix pattern alongside the incorrect code patterns it replaces.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            issue: { type: "string", description: "Short identifier for the recurring bug or refactor (e.g., 'config-loader-null-check')." },
                            summary: { type: "string", description: "Context describing when this bug appears and why the fix is preferred." },
                            correct_pattern: { type: "string", description: "Code snippet or instructions that represent the proven fix." },
                            incorrect_patterns: { type: "array", items: { type: "string" }, description: "Example snippets or anti-pattern descriptions that should trigger this fix." },
                            error_messages: { type: "array", items: { type: "string" }, description: "Representative error log lines or messages that should map directly to this fix." },
                            tags: { type: "array", items: { type: "string" }, description: "Optional tags (e.g., 'typescript', 'api-layer')." },
                            source: { type: "string", description: "Optional link or reference explaining the fix (PR, issue, doc)." }
                        },
                        required: ["issue", "summary", "correct_pattern", "incorrect_patterns"]
                    }
                },
                {
                    name: "match_bug_fix",
                    description: "Match an error report or code snippet to known bug fixes and retrieve their canonical patch.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Symptoms, log snippets, or problematic code to match against stored fixes." },
                            errorMessage: { type: "string", description: "Exact error message to look up before falling back to semantic similarity." },
                            limit: { type: "number", description: "Max fixes to return", default: 5 },
                            minScore: { type: "number", description: "Minimum similarity score (0-1)", default: 0.6 },
                            tag: { type: "string", description: "Optional tag filter (e.g., 'typescript')." }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_bug_fix",
                    description: "Fetch a stored bug fix by its issue identifier.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            issue: { type: "string", description: "Identifier used when the fix was recorded." }
                        },
                        required: ["issue"]
                    }
                },
                {
                    name: "explore_graph_entity",
                    description: "Inspect a knowledge-graph entity plus its inbound/outbound Neo4j relationships.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            entityId: { type: "string", description: "Graph entity identifier (e.g., 'file:src/server.ts')." },
                            maxNeighbors: { type: "number", description: "Maximum relationships to return (1-100).", default: 25 }
                        },
                        required: ["entityId"]
                    }
                },
                {
                    name: "search_graph_semantic",
                    description: "Semantic search over the knowledge-graph embeddings (stored in Qdrant) to find relevant entities.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Natural-language request or code snippet describing what you want to find." },
                            limit: { type: "number", description: "Maximum results to return (1-20).", default: 10 },
                            type: { type: "string", description: "Optional entity type filter (e.g., 'file', 'class', 'function')." },
                            minScore: { type: "number", description: "Optional similarity threshold (0-1).", default: 0.55 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "query_research",
                    description: "Query cached research by semantic similarity. Returns relevant past research.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "What you're looking for" },
                            limit: { type: "number", description: "Max results to return", default: 5 },
                            min_score: { type: "number", description: "Minimum similarity score (0-1)", default: 0.7 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "check_research_exists",
                    description: "Check if research already exists for a topic before starting new research.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            topic: { type: "string", description: "Topic to check" }
                        },
                        required: ["topic"]
                    }
                },
                {
                    name: "store_pattern",
                    description: "Store a code or design pattern for future reference and consistency.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "Pattern name (e.g., 'component-lifecycle')" },
                            description: { type: "string", description: "What this pattern does" },
                            code: { type: "string", description: "Code example" },
                            usage: { type: "string", description: "When to use this pattern" },
                            category: { type: "string", description: "Pattern category (architecture/gameplay/rendering/etc)" }
                        },
                        required: ["name", "description", "code"]
                    }
                },
                {
                    name: "find_similar_patterns",
                    description: "Find patterns similar to current work to maintain consistency.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            description: { type: "string", description: "Describe what you're implementing" },
                            category: { type: "string", description: "Filter by category" },
                            limit: { type: "number", default: 5 }
                        },
                        required: ["description"]
                    }
                },
                {
                    name: "get_pattern_by_name",
                    description: "Retrieve exact pattern by name.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "Exact pattern name" }
                        },
                        required: ["name"]
                    }
                },
                {
                    name: "store_architecture_decision",
                    description: "Record architectural decisions with rationale for future reference.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            decision: { type: "string", description: "What was decided" },
                            rationale: { type: "string", description: "Why this decision was made" },
                            alternatives: { type: "array", items: { type: "string" }, description: "Options considered" },
                            scope: { type: "string", description: "What this decision affects" },
                            date: { type: "string", description: "ISO date of decision" }
                        },
                        required: ["decision", "rationale"]
                    }
                },
                {
                    name: "query_architecture",
                    description: "Query architectural decisions by topic.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "What to search for" },
                            limit: { type: "number", default: 5 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "validate_against_patterns",
                    description: "Validate code/design against established patterns to catch inconsistencies.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "Code or design to validate" },
                            type: { type: "string", description: "What's being validated (code/architecture/test)" }
                        },
                        required: ["content", "type"]
                    }
                },
                {
                    name: "check_consistency",
                    description: "Check if new work is consistent with existing patterns and decisions.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            description: { type: "string", description: "Describe the new work" },
                            category: { type: "string", description: "Category of work" }
                        },
                        required: ["description"]
                    }
                },
                {
                    name: "store_narrative_element",
                    description: "Store story beats, quests, character arcs, or thematic notes for the game's narrative.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Name of the narrative element" },
                            type: { type: "string", description: "Element type (act, quest, character, beat, faction, lore, theme, mechanic)" },
                            summary: { type: "string", description: "Short synopsis" },
                            details: { type: "string", description: "Extended notes or script" },
                            act: { type: "string", description: "Act identifier" },
                            chapter: { type: "string", description: "Chapter identifier" },
                            tags: { type: "array", items: { type: "string" }, description: "Classification tags" },
                            related_ids: { type: "array", items: { type: "string" }, description: "IDs of related narrative elements" },
                            order: { type: "number", description: "Ordering index within act/chapter" },
                            author: { type: "string", description: "Contributor name" },
                            status: { type: "string", description: "Draft/approved/deprecated" },
                            attachments: { type: "array", items: { type: "string" }, description: "External references or asset IDs" }
                        },
                        required: ["title", "type", "summary"]
                    }
                },
                {
                    name: "search_narrative_elements",
                    description: "Search narrative library for similar elements (acts, quests, characters) by semantic meaning.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "What you want to find" },
                            type: { type: "string", description: "Filter by element type" },
                            tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
                            limit: { type: "number", default: 5 },
                            min_score: { type: "number", default: 0.62 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_narrative_outline",
                    description: "Retrieve ordered narrative elements for an act/chapter to keep story structure aligned.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            act: { type: "string", description: "Act identifier" },
                            chapter: { type: "string", description: "Chapter identifier" },
                            type: { type: "string", description: "Filter by element type" },
                            limit: { type: "number", default: 50 },
                            order: { type: "string", enum: ["asc", "desc"], default: "asc" }
                        }
                    }
                },
                {
                    name: "store_lore_entry",
                    description: "Store worldbuilding lore such as factions, locations, artifacts, and historical notes.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            category: { type: "string", description: "Type of lore (faction, location, artifact, history, culture)" },
                            content: { type: "string", description: "Rich lore description" },
                            region: { type: "string" },
                            era: { type: "string" },
                            factions: { type: "array", items: { type: "string" }, description: "Related factions" },
                            tags: { type: "array", items: { type: "string" } },
                            related_ids: { type: "array", items: { type: "string" } },
                            attachments: { type: "array", items: { type: "string" } }
                        },
                        required: ["title", "category", "content"]
                    }
                },
                {
                    name: "search_lore",
                    description: "Semantically search lore database by region, category, or tags.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string" },
                            category: { type: "string" },
                            region: { type: "string" },
                            tags: { type: "array", items: { type: "string" } },
                            limit: { type: "number", default: 5 },
                            min_score: { type: "number", default: 0.6 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "list_lore",
                    description: "List lore entries for coordination (e.g., all regions or factions).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            region: { type: "string" },
                            category: { type: "string" },
                            limit: { type: "number", default: 50 }
                        }
                    }
                },
                {
                    name: "store_dialogue_scene",
                    description: "Store branching dialogue scripts with character context and tone.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            scene: { type: "string", description: "Unique scene identifier" },
                            characters: { type: "array", items: { type: "string" }, description: "Characters present" },
                            context: { type: "string", description: "Scene setup and intent" },
                            script: { type: "string", description: "Dialogue script with branching notes" },
                            branching: { type: "object", additionalProperties: { type: "string" }, description: "Branch key to script snippet" },
                            tags: { type: "array", items: { type: "string" } },
                            tone: { type: "string" }
                        },
                        required: ["scene", "characters", "context", "script"]
                    }
                },
                {
                    name: "find_dialogue",
                    description: "Search stored dialogue scenes/snippets for reuse or consistency checks.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string" },
                            character: { type: "string" },
                            tone: { type: "string" },
                            tags: { type: "array", items: { type: "string" } },
                            limit: { type: "number", default: 5 },
                            min_score: { type: "number", default: 0.58 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_dialogue_scene",
                    description: "Fetch a dialogue scene by its identifier including branches and metadata.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            scene_id: { type: "string", description: "Scene identifier" }
                        },
                        required: ["scene_id"]
                    }
                },
                {
                    name: "store_test_strategy",
                    description: "Document a test strategy covering hybrid gameplay, narrative branches, or engine systems.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            focus_area: { type: "string", description: "System or gameplay area under test" },
                            scenario: { type: "string", description: "Test scenario narrative" },
                            coverage: { type: "array", items: { type: "string" }, description: "Checklist of covered behaviors" },
                            automated: { type: "boolean", description: "Whether automated tests exist" },
                            status: { type: "string" },
                            tags: { type: "array", items: { type: "string" } },
                            author: { type: "string" }
                        },
                        required: ["title", "focus_area", "scenario", "coverage"]
                    }
                },
                {
                    name: "query_test_strategies",
                    description: "Search test strategies to avoid regression gaps and share coverage plans.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string" },
                            focus_area: { type: "string" },
                            automated: { type: "boolean" },
                            tags: { type: "array", items: { type: "string" } },
                            limit: { type: "number", default: 5 },
                            min_score: { type: "number", default: 0.6 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "list_test_strategies_by_focus",
                    description: "List up to 100 test strategies for a given focus area.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            focusArea: { type: "string", description: "Focus area identifier" }
                        },
                        required: ["focusArea"]
                    }
                },
                {
                    name: "record_playtest_feedback",
                    description: "Record structured gameplay or narrative feedback from playtests.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            source: { type: "string", description: "Who/what generated the feedback" },
                            experience: { type: "string", description: "Summary of the session" },
                            positives: { type: "array", items: { type: "string" } },
                            negatives: { type: "array", items: { type: "string" } },
                            suggestions: { type: "array", items: { type: "string" } },
                            build: { type: "string", description: "Build identifier" },
                            tags: { type: "array", items: { type: "string" } },
                            severity: { type: "string", enum: ["low", "medium", "high", "critical"] }
                        },
                        required: ["source", "experience", "positives", "negatives"]
                    }
                },
                {
                    name: "query_playtest_feedback",
                    description: "Search recorded feedback for similar issues or player sentiment.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string" },
                            severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                            tags: { type: "array", items: { type: "string" } },
                            limit: { type: "number", default: 10 },
                            min_score: { type: "number", default: 0.55 }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "summarize_playtest_feedback",
                    description: "Summarize recent playtest feedback counts by severity and highlight common tags.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            limit: { type: "number", default: 200 },
                            since: { type: "string", description: "ISO timestamp to filter feedback newer than this" }
                        }
                    }
                },
                {
                    name: "get_server_metadata",
                    description: "Overview of server capabilities, version, and connected services for Claude configuration.",
                    inputSchema: {
                        type: "object",
                        properties: {}
                    }
                },
                {
                    name: "list_qdrant_collections",
                    description: "Return Qdrant collection metadata including purpose, vector size, and primary agents.",
                    inputSchema: {
                        type: "object",
                        properties: {}
                    }
                },
                {
                    name: "get_mcp_documentation",
                    description: "Fetch integration documentation so Claude can self-onboard to this MCP server.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            section: { type: "string", description: "Optional heading to extract (e.g., 'Tool Catalog')." }
                        }
                    }
                }
            ]
        }));

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            const tool = this.tools.get(name);
            if (!tool) {
                throw new Error(`Unknown tool: ${name}`);
            }

            try {
                const result = await tool(args);
                if (this.writeTools.has(name) && this.wasSuccessfulWrite(result)) {
                    this.incrementToolStat(name, 'writes');
                }
                if (this.readTools.has(name) && this.hasReadableContent(result)) {
                    this.incrementToolStat(name, 'reads');
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                };
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: err.message,
                                tool: name
                            })
                        }
                    ],
                    isError: true
                };
            }
        });
    }

    async start() {
        const port = Number(process.env.PORT || 3000);
        await this.initializeTransport();

        const app = express();
        app.use(express.json({ limit: "4mb" }));

        const routerPath = process.env.MCP_PATH || "/mcp";

        const postHandler = async (req: Request, res: Response, next: NextFunction) => {
            try {
                const isInitialization = this.isInitializationRequest(req.body);

                if (isInitialization) {
                    await this.resetTransport();
                } else if (this.hasActiveSession) {
                    const sessionHeader = this.getSessionHeaderFromRequest(req);
                    if (!sessionHeader) {
                        await this.resetTransport();
                    }
                }
                const baseUrl = this.getPublicBaseUrl(req);
                if (baseUrl) {
                    this.patchSseResponse(res, baseUrl);
                }
                await this.transport!.handleRequest(req, res, req.body);
            } catch (error) {
                next(error);
            }
        };

        const genericHandler = async (req: Request, res: Response, next: NextFunction) => {
            try {
                const baseUrl = this.getPublicBaseUrl(req);
                if (baseUrl) {
                    this.patchSseResponse(res, baseUrl);
                }
                await this.transport!.handleRequest(req, res);
            } catch (error) {
                next(error);
            }
        };

        app.get("/sse", async (req, res, next) => {
            try {
                const baseUrl = this.getPublicBaseUrl(req);

                if (baseUrl) {
                    this.patchSseResponse(res, baseUrl);
                }

                const transport = new SSEServerTransport("/messages", res);
                transport.onclose = () => {
                    this.sseSessions.delete(transport.sessionId);
                };
                transport.onerror = (error) => {
                    console.error("SSE transport error:", error);
                };
                await this.server.connect(transport);
                this.sseSessions.set(transport.sessionId, transport);
            } catch (error) {
                next(error);
            }
        });

        // Endpoint for JSON-RPC messages sent over SSE transport
        app.post("/messages", async (req, res) => {
            const querySessionId = req.query.sessionId;
            if (Array.isArray(querySessionId)) {
                return res.status(400).json({ error: "Only a single sessionId may be provided" });
            }

            if (querySessionId && typeof querySessionId !== "string") {
                return res.status(400).json({ error: "sessionId must be provided as a string" });
            }

            const headerSessionId = req.header("Mcp-Session-Id");
            if (Array.isArray(headerSessionId)) {
                return res.status(400).json({ error: "Only a single Mcp-Session-Id header may be provided" });
            }

            const sessionId = querySessionId ?? headerSessionId;
            if (!sessionId) {
                return res.status(400).json({ error: "Missing sessionId" });
            }

            const transport = this.sseSessions.get(sessionId);
            if (!transport) {
                return res.status(404).json({ error: "Session not found" });
            }

            try {
                await transport.handlePostMessage(req, res, req.body);
            } catch (error) {
                console.error("Error handling SSE message:", error);
                if (!res.headersSent) {
                    res.status(500).json({ error: "Internal server error" });
                }
            }
        });

        app.post(routerPath, postHandler);
        app.get(routerPath, genericHandler);
        app.delete(routerPath, genericHandler);

        app.get("/stats", (_req, res) => {
            const stats = Array.from(this.toolStats.entries()).map(([tool, counts]) => ({
                tool,
                writes: counts.writes,
                reads: counts.reads
            }));

            res.json({
                stats
            });
        });

        app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
            const error = err instanceof Error ? err : new Error(String(err));
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: error.message
                    },
                    id: null
                });
            }
        });

        app.use((req, res) => {
            res.status(404).json({
                jsonrpc: "2.0",
                error: {
                    code: -32004,
                    message: `Route ${req.method} ${req.path} not found`
                },
                id: null
            });
        });

        await new Promise<void>((resolve, reject) => {
            this.httpServer = app.listen(port, () => {
                console.error(`Game Dev MCP Server listening on http://0.0.0.0:${port}${routerPath}`);
                resolve();
            });
            this.httpServer.on("error", reject);
        });
    }
}
