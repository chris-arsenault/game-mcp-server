import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";

export class PatternTool {
    private collection = "code_implementations";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService
    ) {}

    async storePattern(args: {
        name: string;
        description: string;
        code: string;
        usage?: string;
        category?: string;
    }) {
        const { name, description, code, usage = "", category = "general" } = args;

        // Create searchable text
        const searchText = `${name}\n${description}\n${usage}`;
        const vector = await this.embedding.embed(searchText);

        const id = randomUUID();

        await this.qdrant.upsert(this.collection, [
            {
                id,
                vector,
                payload: {
                    name,
                    description,
                    code,
                    usage,
                    category,
                    created_at: new Date().toISOString(),
                    version: 1
                }
            }
        ]);

        return {
            success: true,
            id,
            name,
            message: `Pattern '${name}' stored successfully`
        };
    }

    async findSimilar(args: {
        description: string;
        category?: string;
        limit?: number;
    }) {
        const { description, category, limit = 5 } = args;

        const vector = await this.embedding.embed(description);

        const filter = category
            ? {
                must: [
                    {
                        key: "category",
                        match: { value: category }
                    }
                ]
            }
            : undefined;

        const results = await this.qdrant.search(
            this.collection,
            vector,
            limit,
            filter,
            0.65
        );

        return {
            count: results.length,
            patterns: results.map(r => {
                const payload = r.payload ?? {};
                return {
                    name: payload.name,
                    description: payload.description,
                    code: payload.code,
                    usage: payload.usage,
                    category: payload.category,
                    similarity: r.score
                };
            })
        };
    }

    async getByName(args: { name: string }) {
        const { name } = args;

        const results = await this.qdrant.scroll(this.collection, {
            must: [
                {
                    key: "name",
                    match: { value: name }
                }
            ]
        });

        if (results.points.length === 0) {
            return {
                found: false,
                message: `Pattern '${name}' not found`
            };
        }

        const pattern = results.points[0]?.payload;
        if (!pattern) {
            return {
                found: false,
                message: `Pattern '${name}' not found`
            };
        }

        return {
            found: true,
            pattern: {
                name: pattern.name,
                description: pattern.description,
                code: pattern.code,
                usage: pattern.usage,
                category: pattern.category
            }
        };
    }
}
