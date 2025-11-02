import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { ProjectService } from "../services/project.service.js";
import { DialogueSceneInput, DialogueSceneRecord } from "../types/index.js";

type StoreArgs = DialogueSceneInput & {
    scene?: string;
};

type SearchArgs = {
    query: string;
    character?: string;
    tone?: string;
    tags?: string[];
    limit?: number;
    min_score?: number;
};

type SceneArgs = {
    scene_id: string;
};

export class DialogueTool {
    private collection = "dialogue_snippets";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService,
        private projects: ProjectService
    ) {}

    async storeDialogueScene(projectId: string, args: StoreArgs) {
        const {
            scene,
            characters,
            context,
            script,
            branching = {},
            tags = [],
            tone,
        } = args;

        if (!scene) {
            throw new Error("Scene identifier is required");
        }

        const timestamp = new Date().toISOString();
        const id = randomUUID();

        const vector = await this.embedding.embed(
            `${scene}\n${characters.join(",")}\n${context}\n${script}`
        );

        await this.qdrant.upsert(this.getCollection(projectId), [
            {
                id,
                vector,
                payload: {
                    scene,
                    characters,
                    context,
                    script,
                    branching,
                    tags,
                    tone,
                    created_at: timestamp,
                    updated_at: timestamp,
                },
            },
        ]);

        this.cache.clearPrefix(`dialogue:${projectId}:scene:${scene}`);

        return {
            success: true,
            id,
            scene,
            message: `Dialogue scene '${scene}' stored successfully`,
        };
    }

    async findDialogue(projectId: string, args: SearchArgs) {
        const {
            query,
            character,
            tone,
            tags,
            limit = 5,
            min_score = 0.58,
        } = args;

        const vector = await this.embedding.embed(query);
        const filter = this.buildFilter({ character, tone, tags });

        const results: any[] = await this.qdrant.search(
            this.getCollection(projectId),
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            scenes: results.map(point => this.mapPoint(point)),
        };
    }

    async getScene(projectId: string, args: SceneArgs) {
        const { scene_id } = args;
        const cacheKey = `dialogue:${projectId}:scene:${scene_id}`;

        const cached = this.cache.get<DialogueSceneRecord>(cacheKey);
        if (cached) {
            return {
                found: true,
                scene: cached,
                cached: true,
            };
        }

        const response = await this.qdrant.retrieve(this.getCollection(projectId), [scene_id]);
        if (response.length === 0) {
            return {
                found: false,
                message: `Scene '${scene_id}' not found`,
            };
        }

        const scene = this.mapPoint(response[0]);
        this.cache.set(cacheKey, scene, 15 * 60 * 1000);

        return {
            found: true,
            scene,
            cached: false,
        };
    }

    private mapPoint(point: any): DialogueSceneRecord {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            scene: payload.scene,
            characters: payload.characters ?? [],
            context: payload.context,
            script: payload.script,
            branching: payload.branching ?? {},
            tags: payload.tags ?? [],
            tone: payload.tone,
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            score: point.score,
        };
    }

    private buildFilter(params: {
        character?: string;
        tone?: string;
        tags?: string[];
    }) {
        const must: any[] = [];

        if (params.character) {
            must.push({
                key: "characters",
                match: { any: [params.character] },
            });
        }

        if (params.tone) {
            must.push({
                key: "tone",
                match: { value: params.tone },
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
