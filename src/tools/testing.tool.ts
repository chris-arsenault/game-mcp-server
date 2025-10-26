import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { TestStrategyInput } from "../types/index.js";

type QueryArgs = {
    query: string;
    focus_area?: string;
    automated?: boolean;
    tags?: string[];
    limit?: number;
    min_score?: number;
};

type StoreArgs = TestStrategyInput & {
    author?: string;
};

export class TestingTool {
    private collection = "test_strategies";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService
    ) {}

    async storeTestStrategy(args: StoreArgs) {
        const {
            title,
            focus_area,
            scenario,
            coverage,
            automated = false,
            status = "draft",
            tags = [],
            author,
        } = args;

        const id = randomUUID();
        const timestamp = new Date().toISOString();

        const vector = await this.embedding.embed(
            `${title}\n${focus_area}\n${scenario}\n${coverage.join("\n")}`
        );

        await this.qdrant.upsert(this.collection, [
            {
                id,
                vector,
                payload: {
                    title,
                    focus_area,
                    scenario,
                    coverage,
                    automated,
                    status,
                    tags,
                    author,
                    created_at: timestamp,
                    updated_at: timestamp,
                },
            },
        ]);

        this.cache.clearPrefix("testing:list");

        return {
            success: true,
            id,
            title,
            message: "Test strategy stored successfully",
        };
    }

    async queryTestStrategies(args: QueryArgs) {
        const {
            query,
            focus_area,
            automated,
            tags,
            limit = 5,
            min_score = 0.6,
        } = args;

        const vector = await this.embedding.embed(query);
        const filter = this.buildFilter({ focus_area, automated, tags });

        const results: any[] = await this.qdrant.search(
            this.collection,
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            strategies: results.map((point: any) => this.mapPoint(point)),
        };
    }

    async listByFocusArea(args: { focusArea: string }) {
        const { focusArea } = args;
        if (!focusArea) {
            throw new Error("focusArea is required");
        }

        const cacheKey = `testing:list:${focusArea}`;
        const cached = this.cache.get<any[]>(cacheKey);
        if (cached) {
            return {
                count: cached.length,
                strategies: cached,
                cached: true,
            };
        }

        const response: any = await this.qdrant.scroll(
            this.collection,
            {
                must: [
                    {
                        key: "focus_area",
                        match: { value: focusArea },
                    },
                ],
            },
            100
        );

        const strategies = (response.points ?? []).map((point: any) =>
            this.mapPoint(point)
        );
        this.cache.set(cacheKey, strategies, 15 * 60 * 1000);

        return {
            count: strategies.length,
            strategies,
            cached: false,
        };
    }

    private mapPoint(point: any) {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            title: payload.title,
            focus_area: payload.focus_area,
            scenario: payload.scenario,
            coverage: payload.coverage ?? [],
            automated: payload.automated ?? false,
            status: payload.status,
            tags: payload.tags ?? [],
            author: payload.author,
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            score: point.score,
        };
    }

    private buildFilter(params: {
        focus_area?: string;
        automated?: boolean;
        tags?: string[];
    }) {
        const must: any[] = [];

        if (params.focus_area) {
            must.push({
                key: "focus_area",
                match: { value: params.focus_area },
            });
        }

        if (typeof params.automated === "boolean") {
            must.push({
                key: "automated",
                match: { value: params.automated },
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
