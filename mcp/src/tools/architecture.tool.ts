import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { ProjectService } from "../services/project.service.js";
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

type ArchitectureDecisionSummary = {
    id: string;
    decision: string;
    status?: string;
    priority: string | null;
};

export class ArchitectureTool {
    private collection = "architectural_patterns";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService,
        private projects: ProjectService
    ) {}

    async storeDecision(projectId: string, args: ArchitectureDecisionInput & {
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

        await this.qdrant.upsert(this.getCollection(projectId), [
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

        this.invalidateCaches(projectId);

        return {
            success: true,
            id,
            decision,
            message: "Architecture decision stored successfully",
        };
    }

    async queryDecisions(projectId: string, args: QueryArgs) {
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
            this.getCollection(projectId),
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            decisions: results
                .map((point) => this.mapPoint(point))
                .map((record) => this.mapSummary(record)),
        };
    }

    async getHistory(projectId: string, args: HistoryArgs = {}) {
        const { limit = 20, scope, tag } = args;
        const filter = this.buildFilter(scope, tag ? [tag] : undefined);

        const cacheKey = `architecture:${projectId}:history:${limit}:${scope ?? ""}:${tag ?? ""}`;
        const cached = this.cache.get<ArchitectureDecisionSummary[]>(cacheKey);
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

        const summaries = decisions.map((decision: ArchitectureDecisionRecord) => this.mapSummary(decision));

        this.cache.set(cacheKey, summaries, 2 * 60 * 1000); // short cache for history

        return {
            count: summaries.length,
            decisions: summaries,
            cached: false,
        };
    }

    async getDecision(projectId: string, args: { id: string }) {
        const normalizedProject = this.projects.requireProject(projectId);
        const record = await this.fetchDecision(normalizedProject, args.id);

        if (!record) {
            return {
                found: false,
                message: `Architecture decision '${args.id}' not found`,
            };
        }

        return {
            found: true,
            decision: record,
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

    private mapSummary(record: ArchitectureDecisionRecord): ArchitectureDecisionSummary {
        return {
            id: record.id,
            decision: record.decision,
            status: record.status,
            priority: null,
        };
    }

    private async fetchDecision(projectId: string, id: string): Promise<ArchitectureDecisionRecord | null> {
        const response = await this.qdrant.retrieve(this.getCollection(projectId), [id]);
        const point = response?.[0];
        if (!point) {
            return null;
        }

        return this.mapPoint(point);
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

    private getCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.collection);
    }

    private invalidateCaches(projectId: string) {
        this.cache.clearPrefix(`architecture:${projectId}:`);
    }
}
