import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";

export class ResearchTool {
    private collection = "research_findings";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService
    ) {}

    async cacheResearch(args: {
        topic: string;
        findings: string;
        sources?: string[];
        tags?: string[];
    }) {
        const { topic, findings, sources = [], tags = [] } = args;

        // Generate embedding for semantic search
        const vector = await this.embedding.embed(
            `${topic}\n\n${findings.substring(0, 1000)}`
        );

        const id = randomUUID();
        const timestamp = new Date().toISOString();

        await this.qdrant.upsert(this.collection, [
            {
                id,
                vector,
                payload: {
                    topic,
                    findings,
                    sources,
                    tags,
                    cached_at: timestamp,
                    access_count: 0
                }
            }
        ]);

        return {
            success: true,
            id,
            message: `Research cached for topic: ${topic}`
        };
    }

    async queryResearch(args: {
        query: string;
        limit?: number;
        min_score?: number;
    }) {
        const { query, limit = 5, min_score = 0.7 } = args;

        const vector = await this.embedding.embed(query);

        const results = await this.qdrant.search(
            this.collection,
            vector,
            limit,
            undefined,
            min_score
        );

        // Update access count for retrieved items
        for (const result of results) {
            const payload = result.payload ?? {};
            const id = typeof result.id === "string" ? result.id : String(result.id);
            const currentCount =
                typeof payload.access_count === "number" ? payload.access_count : 0;
            await this.qdrant.setPayload(this.collection, id, {
                ...payload,
                access_count: currentCount + 1,
                last_accessed: new Date().toISOString()
            });
        }

        return {
            count: results.length,
            results: results.map(r => {
                const payload = r.payload ?? {};
                const accessCount =
                    typeof payload.access_count === "number" ? payload.access_count : 0;
                return {
                    topic: payload.topic,
                    findings: payload.findings,
                    sources: payload.sources,
                    tags: payload.tags,
                    score: r.score,
                    cached_at: payload.cached_at,
                    access_count: accessCount + 1
                };
            })
        };
    }

    async checkExists(args: { topic: string }) {
        const { topic } = args;

        const vector = await this.embedding.embed(topic);

        const results = await this.qdrant.search(
            this.collection,
            vector,
            1,
            undefined,
            0.9 // High threshold for "exists"
        );

        if (results.length > 0 && results[0].score > 0.9) {
            const payload = results[0].payload ?? {};
            return {
                exists: true,
                topic: payload.topic,
                cached_at: payload.cached_at,
                message: "Similar research already exists - consider reusing"
            };
        }

        return {
            exists: false,
            message: "No existing research found - proceed with new research"
        };
    }
}
