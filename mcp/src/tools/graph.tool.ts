import { EmbeddingService } from "../services/embedding.service.js";
import { QdrantService } from "../services/qdrant.service.js";
import {
    GraphRelationship,
    GraphEntitySummary,
    Neo4jService
} from "../services/neo4j.service.js";

interface ExploreGraphArgs {
    entityId: string;
    maxNeighbors?: number;
}

interface SearchGraphArgs {
    query: string;
    limit?: number;
    type?: string;
    minScore?: number;
}

export class GraphTool {
    private collection: string;

    constructor(
        private neo4j: Neo4jService,
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        collectionName: string
    ) {
        this.collection = collectionName;
    }

    async exploreGraph(args: ExploreGraphArgs) {
        const { entityId, maxNeighbors = 25 } = args;

        if (!entityId) {
            throw new Error("entityId is required");
        }

        const result = await this.neo4j.getEntityWithNeighbors(
            entityId,
            Math.max(1, Math.min(maxNeighbors, 100))
        );

        if (!result) {
            return {
                found: false,
                message: `Entity '${entityId}' was not found in the knowledge graph`
            };
        }

        return {
            found: true,
            entity: this.pruneEntity(result.entity),
            relationships: this.pruneRelationships(result.relationships)
        };
    }

    async searchGraph(args: SearchGraphArgs) {
        const { query, limit = 10, type, minScore = 0.55 } = args;

        if (!query || query.trim().length === 0) {
            throw new Error("query is required");
        }

        const vector = await this.embedding.embed(query);
        const filter = type
            ? {
                must: [
                    {
                        key: "type",
                        match: { value: type }
                    }
                ]
            }
            : undefined;

        const results = await this.qdrant.search(
            this.collection,
            vector,
            Math.max(1, Math.min(limit, 20)),
            filter,
            minScore
        );

        return {
            count: results.length,
            matches: results.map((result) => {
                const payload = (result.payload ?? {}) as Record<string, unknown>;
                return {
                    entityId: payload.entityId,
                    type: payload.type,
                    name: payload.name,
                    path: payload.path,
                    semanticDescription: payload.semanticDescription,
                    purpose: payload.purpose,
                    architecturalRole: payload.architecturalRole,
                    score: result.score
                };
            })
        };
    }

    private pruneEntity(entity: GraphEntitySummary) {
        const { metadata, ...rest } = entity;
        return metadata
            ? {
                ...rest,
                metadata
            }
            : rest;
    }

    private pruneRelationships(relationships: GraphRelationship[]) {
        return relationships.map((relationship) => ({
            type: relationship.type,
            direction: relationship.direction,
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            properties: relationship.properties,
            node: this.pruneEntity(relationship.node)
        }));
    }
}
