import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { ProjectService } from "../services/project.service.js";
import { GameplayFeedbackInput } from "../types/index.js";

type QueryArgs = {
    query: string;
    severity?: GameplayFeedbackInput["severity"];
    tags?: string[];
    limit?: number;
    min_score?: number;
};

type SummaryArgs = {
    limit?: number;
    since?: string;
};

export class FeedbackTool {
    private collection = "gameplay_feedback";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService,
        private projects: ProjectService
    ) {}

    async recordFeedback(projectId: string, args: GameplayFeedbackInput) {
        const {
            source,
            experience,
            positives,
            negatives,
            suggestions = [],
            build,
            tags = [],
            severity = "medium",
        } = args;

        const id = randomUUID();
        const timestamp = new Date().toISOString();

        const vector = await this.embedding.embed(
            `${experience}\nPositives: ${positives.join(", ")}\nNegatives: ${negatives.join(", ")}\nSuggestions: ${suggestions.join(", ")}`
        );

        await this.qdrant.upsert(this.getCollection(projectId), [
            {
                id,
                vector,
                payload: {
                    source,
                    experience,
                    positives,
                    negatives,
                    suggestions,
                    build,
                    tags,
                    severity,
                    created_at: timestamp,
                },
            },
        ]);

        this.cache.clearPrefix(`feedback:${projectId}:summary`);

        return {
            success: true,
            id,
            message: "Gameplay feedback recorded",
        };
    }

    async queryFeedback(projectId: string, args: QueryArgs) {
        const {
            query,
            severity,
            tags,
            limit = 10,
            min_score = 0.55,
        } = args;

        const vector = await this.embedding.embed(query);
        const filter = this.buildFilter({ severity, tags });

        const results: any[] = await this.qdrant.search(
            this.getCollection(projectId),
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            feedback: results.map(point => this.mapPoint(point)),
        };
    }

    async summarizeFeedback(projectId: string, args: SummaryArgs = {}) {
        const { limit = 200, since } = args;
        const cacheKey = `feedback:${projectId}:summary:${limit}:${since ?? ""}`;
        const cached = this.cache.get<any>(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }

        const filter = since
            ? {
                must: [
                    {
                        key: "created_at",
                        range: {
                            gte: since,
                        },
                    },
                ],
            }
            : undefined;

        const response: any = await this.qdrant.scroll(
            this.getCollection(projectId),
            filter,
            limit
        );

        const points: any[] = response.points ?? [];
        const feedback = points.map(point => this.mapPoint(point));

        const bySeverity = feedback.reduce<Record<string, number>>((acc, item) => {
            const severity = item.severity ?? "unknown";
            acc[severity] = (acc[severity] ?? 0) + 1;
            return acc;
        }, {});

        const tagCounts = feedback.reduce<Record<string, number>>((acc, item) => {
            (item.tags ?? []).forEach((tag: string) => {
                acc[tag] = (acc[tag] ?? 0) + 1;
            });
            return acc;
        }, {});

        const summary = {
            count: feedback.length,
            bySeverity,
            topTags: Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([tag, count]) => ({ tag, count })),
            feedback,
            cached: false,
        };

        this.cache.set(cacheKey, summary, 10 * 60 * 1000);

        return summary;
    }

    private mapPoint(point: any) {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            source: payload.source,
            experience: payload.experience,
            positives: payload.positives ?? [],
            negatives: payload.negatives ?? [],
            suggestions: payload.suggestions ?? [],
            build: payload.build,
            tags: payload.tags ?? [],
            severity: payload.severity,
            created_at: payload.created_at,
            score: point.score,
        };
    }

    private buildFilter(params: {
        severity?: GameplayFeedbackInput["severity"];
        tags?: string[];
    }) {
        const must: any[] = [];

        if (params.severity) {
            must.push({
                key: "severity",
                match: { value: params.severity },
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

    private getCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.collection);
    }
}
