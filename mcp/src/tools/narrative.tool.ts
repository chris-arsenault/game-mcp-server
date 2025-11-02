import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { ProjectService } from "../services/project.service.js";
import {
    NarrativeElementInput,
    NarrativeElementRecord,
    NarrativeElementType,
} from "../types/index.js";

type StoreArgs = NarrativeElementInput & {
    details?: string;
    attachments?: string[];
};

type SearchArgs = {
    query: string;
    type?: NarrativeElementType;
    tags?: string[];
    limit?: number;
    min_score?: number;
};

type OutlineArgs = {
    act?: string;
    chapter?: string;
    type?: NarrativeElementType;
    limit?: number;
    order?: "asc" | "desc";
};

export class NarrativeTool {
    private collection = "narrative_design";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService,
        private projects: ProjectService
    ) {}

    async storeNarrativeElement(projectId: string, args: StoreArgs) {
        const {
            title,
            type,
            summary,
            details = "",
            act,
            chapter,
            tags = [],
            related_ids = [],
            order,
            author,
            status = "draft",
            attachments = [],
        } = args;

        const timestamp = new Date().toISOString();
        const id = randomUUID();

        const vector = await this.embedWithCache(
            `${title}\n${type}\n${summary}\n${details}\n${tags.join(",")}`
        );

        await this.qdrant.upsert(this.getCollection(projectId), [
            {
                id,
                vector,
                payload: {
                    title,
                    type,
                    summary,
                    details,
                    act,
                    chapter,
                    tags,
                    related_ids,
                    order,
                    author,
                    status,
                    attachments,
                    created_at: timestamp,
                    updated_at: timestamp,
                },
            },
        ]);

        this.cache.clearPrefix(`narrative:${projectId}:outline`);

        return {
            success: true,
            id,
            title,
            type,
            message: `${type} '${title}' stored successfully`,
        };
    }

    async searchNarrativeElements(projectId: string, args: SearchArgs) {
        const {
            query,
            type,
            tags,
            limit = 5,
            min_score = 0.62,
        } = args;

        const vector = await this.embedWithCache(query);
        const filter = this.buildFilter({ type, tags });

        const results: any[] = await this.qdrant.search(
            this.getCollection(projectId),
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            elements: results.map(point => this.mapPoint(point)),
        };
    }

    async getNarrativeOutline(projectId: string, args: OutlineArgs = {}) {
        const {
            act,
            chapter,
            type,
            limit = 50,
            order = "asc",
        } = args;

        const cacheKey = `narrative:${projectId}:outline:${act ?? ""}:${chapter ?? ""}:${type ?? ""}:${limit}:${order}`;
        const cached = this.cache.get<NarrativeElementRecord[]>(cacheKey);
        if (cached) {
            return {
                count: cached.length,
                elements: cached,
                cached: true,
            };
        }

        const filter = this.buildFilter({ type, act, chapter });
        const response: any = await this.qdrant.scroll(
            this.getCollection(projectId),
            filter,
            limit
        );

        const points: any[] = response.points ?? [];

        const elements = points
            .map(point => this.mapPoint(point))
            .sort((a, b) => {
                if (a.order !== undefined && b.order !== undefined) {
                    return order === "asc"
                        ? (a.order ?? 0) - (b.order ?? 0)
                        : (b.order ?? 0) - (a.order ?? 0);
                }

                return order === "asc"
                    ? (a.created_at ?? "").localeCompare(b.created_at ?? "")
                    : (b.created_at ?? "").localeCompare(a.created_at ?? "");
            });

        this.cache.set(cacheKey, elements, 5 * 60 * 1000);

        return {
            count: elements.length,
            elements,
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
        this.cache.set(key, vector, 2 * 60 * 60 * 1000);
        return vector;
    }

    private mapPoint(point: any): NarrativeElementRecord {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            title: payload.title,
            type: payload.type,
            summary: payload.summary,
            details: payload.details,
            act: payload.act,
            chapter: payload.chapter,
            tags: payload.tags ?? [],
            related_ids: payload.related_ids ?? [],
            order: payload.order,
            author: payload.author,
            status: payload.status,
            attachments: payload.attachments ?? [],
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            score: point.score,
        };
    }

    private buildFilter(params: {
        type?: NarrativeElementType;
        tags?: string[];
        act?: string;
        chapter?: string;
    }) {
        const must: any[] = [];

        if (params.type) {
            must.push({
                key: "type",
                match: { value: params.type },
            });
        }

        if (params.tags && params.tags.length > 0) {
            must.push({
                key: "tags",
                match: { any: params.tags },
            });
        }

        if (params.act) {
            must.push({
                key: "act",
                match: { value: params.act },
            });
        }

        if (params.chapter) {
            must.push({
                key: "chapter",
                match: { value: params.chapter },
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
}
