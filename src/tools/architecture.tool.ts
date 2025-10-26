import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import {
    ArchitectureDecisionInput,
    ArchitectureDecisionRecord,
} from "../types/index.js";

type QueryArgs = {
    query: string;
    limit?: number;
    scope?: string;
    tags?: string[];
    min_score?: number;
};

type HistoryArgs = {
    limit?: number;
    scope?: string;
    tag?: string;
};

export class ArchitectureTool {
    private collection = "architectural_patterns";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService
    ) {}

    async storeDecision(args: ArchitectureDecisionInput & {
        status?: string;
        author?: string;
        notes?: string;
    }) {
        const {
            decision,
            rationale,
            alternatives = [],
            scope = "",
            date,
            tags = [],
            status = "approved",
            author,
            notes,
        } = args;

        const createdAt = date ?? new Date().toISOString();
        const id = randomUUID();

        const vector = await this.embedWithCache(
            `${decision}\n${rationale}\n${alternatives.join("\n")}\n${scope}`
        );

        await this.qdrant.upsert(this.collection, [
            {
                id,
                vector,
                payload: {
                    decision,
                    rationale,
                    alternatives,
                    scope,
                    tags,
                    status,
                    author,
                    notes,
                    created_at: createdAt,
                    updated_at: createdAt,
                },
            },
        ]);

        this.invalidateCaches();

        return {
            success: true,
            id,
            decision,
            message: "Architecture decision stored successfully",
        };
    }

    async queryDecisions(args: QueryArgs) {
        const {
            query,
            limit = 5,
            scope,
            tags,
            min_score = 0.6,
        } = args;

        const vector = await this.embedWithCache(query);

        const filter = this.buildFilter(scope, tags);

        const results: any[] = await this.qdrant.search(
            this.collection,
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            decisions: results.map(point => this.mapPoint(point)),
        };
    }

    async getHistory(args: HistoryArgs = {}) {
        const { limit = 20, scope, tag } = args;
        const filter = this.buildFilter(scope, tag ? [tag] : undefined);

        const cacheKey = `architecture:history:${limit}:${scope ?? ""}:${tag ?? ""}`;
        const cached = this.cache.get<ArchitectureDecisionRecord[]>(cacheKey);
        if (cached) {
            return {
                count: cached.length,
                decisions: cached,
                cached: true,
            };
        }

        const response: any = await this.qdrant.scroll(
            this.collection,
            filter,
            limit
        );

        const points = response.points ?? [];

        const decisions = points
            .map((point: any) => this.mapPoint(point))
            .sort(
                (
                    a: ArchitectureDecisionRecord,
                    b: ArchitectureDecisionRecord
                ) => (b.created_at ?? "").localeCompare(a.created_at ?? "")
            );

        this.cache.set(cacheKey, decisions, 2 * 60 * 1000); // short cache for history

        return {
            count: decisions.length,
            decisions,
            cached: false,
        };
    }

    private async embedWithCache(text: string) {
        const key = `embedding:${text}`;
        const cached = this.cache.get<number[]>(key);
        if (cached) {
            return cached;
        }

        const vector = await this.embedding.embed(text);
        this.cache.set(key, vector, 60 * 60 * 1000); // cache embeddings for an hour
        return vector;
    }

    private mapPoint(point: any): ArchitectureDecisionRecord {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            decision: payload.decision,
            rationale: payload.rationale,
            alternatives: payload.alternatives ?? [],
            scope: payload.scope,
            date: payload.updated_at ?? payload.created_at,
            created_at: payload.created_at,
            tags: payload.tags ?? [],
            status: payload.status,
            author: payload.author,
            notes: payload.notes,
            score: point.score,
        };
    }

    private buildFilter(scope?: string, tags?: string[] | undefined) {
        const must: any[] = [];

        if (scope) {
            must.push({
                key: "scope",
                match: { value: scope },
            });
        }

        if (tags && tags.length > 0) {
            must.push({
                key: "tags",
                match: { any: tags },
            });
        }

        if (must.length === 0) {
            return undefined;
        }

        return { must };
    }

    private invalidateCaches() {
        this.cache.clearPrefix("architecture:history");
    }
}
