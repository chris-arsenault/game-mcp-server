import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { LoreEntryInput, LoreEntryRecord } from "../types/index.js";

type StoreArgs = LoreEntryInput & {
    attachments?: string[];
};

type SearchArgs = {
    query: string;
    category?: string;
    region?: string;
    tags?: string[];
    limit?: number;
    min_score?: number;
};

type ListArgs = {
    region?: string;
    category?: string;
    limit?: number;
};

export class WorldbuildingTool {
    private collection = "world_building";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService
    ) {}

    async storeLoreEntry(args: StoreArgs) {
        const {
            title,
            category,
            content,
            region,
            era,
            factions = [],
            tags = [],
            related_ids = [],
            attachments = [],
        } = args;

        const timestamp = new Date().toISOString();
        const id = randomUUID();

        const vector = await this.embedWithCache(
            `${title}\n${category}\n${content}\n${region ?? ""}\n${tags.join(",")}`
        );

        await this.qdrant.upsert(this.collection, [
            {
                id,
                vector,
                payload: {
                    title,
                    category,
                    content,
                    region,
                    era,
                    factions,
                    tags,
                    related_ids,
                    attachments,
                    created_at: timestamp,
                    updated_at: timestamp,
                },
            },
        ]);

        this.cache.clearPrefix("world:lore");

        return {
            success: true,
            id,
            title,
            message: `Lore entry '${title}' stored successfully`,
        };
    }

    async searchLore(args: SearchArgs) {
        const {
            query,
            category,
            region,
            tags,
            limit = 5,
            min_score = 0.6,
        } = args;

        const vector = await this.embedWithCache(query);
        const filter = this.buildFilter({ category, region, tags });

        const results: any[] = await this.qdrant.search(
            this.collection,
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            lore: results.map(point => this.mapPoint(point)),
        };
    }

    async listLore(args: ListArgs = {}) {
        const { region, category, limit = 50 } = args;

        const cacheKey = `world:lore:${region ?? ""}:${category ?? ""}:${limit}`;
        const cached = this.cache.get<LoreEntryRecord[]>(cacheKey);
        if (cached) {
            return {
                count: cached.length,
                lore: cached,
                cached: true,
            };
        }

        const filter = this.buildFilter({ region, category });
        const response: any = await this.qdrant.scroll(
            this.collection,
            filter,
            limit
        );

        const points: any[] = response.points ?? [];
        const lore = points
            .map(point => this.mapPoint(point))
            .sort((a, b) =>
                (a.title ?? "").localeCompare(b.title ?? "")
            );

        this.cache.set(cacheKey, lore, 10 * 60 * 1000);

        return {
            count: lore.length,
            lore,
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

    private mapPoint(point: any): LoreEntryRecord {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            title: payload.title,
            category: payload.category,
            content: payload.content,
            region: payload.region,
            era: payload.era,
            factions: payload.factions ?? [],
            tags: payload.tags ?? [],
            related_ids: payload.related_ids ?? [],
            attachments: payload.attachments ?? [],
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            score: point.score,
        };
    }

    private buildFilter(params: {
        category?: string;
        region?: string;
        tags?: string[];
    }) {
        const must: any[] = [];

        if (params.category) {
            must.push({
                key: "category",
                match: { value: params.category },
            });
        }

        if (params.region) {
            must.push({
                key: "region",
                match: { value: params.region },
            });
        }

        if (params.tags && params.tags.length > 0) {
            must.push({
                key: "tags",
                match: { any: params.tags },
            });
        }

        if (must.length === 0) {
            return undefined;
        }

        return { must };
    }
}
