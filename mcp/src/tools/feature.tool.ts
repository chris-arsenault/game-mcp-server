import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { ProjectService } from "../services/project.service.js";
import { BacklogTool } from "./backlog.tool.js";

interface CreateFeatureArgs {
    name: string;
    description?: string;
    tags?: string[];
    status?: string;
    owner?: string;
}

interface UpdateFeatureArgs extends Partial<CreateFeatureArgs> {
    id: string;
}

interface ListFeaturesArgs {
    limit?: number;
    tags?: string[];
    status?: string;
    query?: string;
}

interface AssignBacklogArgs {
    feature_id: string;
    backlog_id: string;
}

interface FeatureRecord {
    id: string;
    name: string;
    description: string | null;
    tags: string[];
    status: string | null;
    owner: string | null;
    created_at: string;
    updated_at: string;
    score?: number;
}

export class FeatureTool {
    private collection = "features";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private projects: ProjectService,
        private backlog: BacklogTool
    ) {}

    async createFeature(projectId: string, args: CreateFeatureArgs) {
        const normalizedProject = this.projects.requireProject(projectId);
        if (this.projects.isFeatureCreationLocked(normalizedProject)) {
            throw new Error("Feature creation is currently locked for this project. No new features at this time.");
        }

        const id = randomUUID();
        const now = new Date().toISOString();
        const payload = {
            name: args.name.trim(),
            description: (args.description ?? "").trim() || null,
            tags: Array.isArray(args.tags) ? args.tags : [],
            status: args.status ?? "proposed",
            owner: args.owner ?? null,
            created_at: now,
            updated_at: now
        };

        const vector = await this.embedFeature(payload.name, payload.description ?? "");

        await this.qdrant.upsert(this.getCollection(normalizedProject), [
            {
                id,
                vector,
                payload
            }
        ]);

        return {
            success: true,
            id,
            message: `Feature '${payload.name}' created`
        };
    }

    async updateFeature(projectId: string, args: UpdateFeatureArgs) {
        const normalizedProject = this.projects.requireProject(projectId);
        const existing = await this.fetchFeature(normalizedProject, args.id);
        if (!existing) {
            return {
                success: false,
                message: `Feature '${args.id}' not found`
            };
        }

        const now = new Date().toISOString();
        const merged = {
            ...existing,
            name: args.name ? args.name.trim() : existing.name,
            description:
                args.description !== undefined ? (args.description?.trim() || null) : existing.description,
            tags: Array.isArray(args.tags) ? args.tags : existing.tags,
            status: args.status ?? existing.status,
            owner: args.owner ?? existing.owner,
            updated_at: now,
            created_at: existing.created_at
        };

        const shouldReembed = args.name !== undefined || args.description !== undefined;
        const vector = shouldReembed
            ? await this.embedFeature(merged.name, merged.description ?? "")
            : undefined;

        await this.qdrant.upsert(this.getCollection(normalizedProject), [
            {
                id: args.id,
                payload: merged,
                ...(vector ? { vector } : {})
            }
        ]);

        return {
            success: true,
            id: args.id,
            message: `Feature '${args.id}' updated`
        };
    }

    async listFeatures(projectId: string, args: ListFeaturesArgs = {}) {
        const normalizedProject = this.projects.requireProject(projectId);
        const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);

        if (args.query && args.query.trim().length > 0) {
            const vector = await this.embedding.embed(args.query.trim());
            const filter = this.buildFeatureFilter(args.tags, args.status);
            const results: any[] = await this.qdrant.search(
                this.getCollection(normalizedProject),
                vector,
                limit,
                filter,
                0.55
            );
            return {
                count: results.length,
                features: results.map((result: any) => this.mapFeature(result.payload ?? {}, result.id, result.score))
            };
        }

        const filter = this.buildFeatureFilter(args.tags, args.status);
        const response: any = await this.qdrant.scroll(this.getCollection(normalizedProject), filter, limit);
        const points = response.points ?? [];
        return {
            count: points.length,
            features: points.map((point: any) => this.mapFeature(point.payload ?? {}, point.id, point.score))
        };
    }

    async getFeature(projectId: string, args: { id: string }) {
        const normalizedProject = this.projects.requireProject(projectId);
        const feature = await this.fetchFeature(normalizedProject, args.id);
        if (!feature) {
            return {
                found: false,
                message: `Feature '${args.id}' not found`
            };
        }

        return {
            found: true,
            feature
        };
    }

    async assignBacklogItem(projectId: string, args: AssignBacklogArgs) {
        const normalizedProject = this.projects.requireProject(projectId);
        const feature = await this.fetchFeature(normalizedProject, args.feature_id);
        if (!feature) {
            return {
                success: false,
                message: `Feature '${args.feature_id}' not found`
            };
        }

        const backlogResult = await this.backlog.updateBacklogItem(normalizedProject, {
            id: args.backlog_id,
            feature_id: feature.id
        });

        if (!backlogResult.success) {
            return backlogResult;
        }

        await this.touchFeature(normalizedProject, feature.id);

        return {
            success: true,
            feature_id: feature.id,
            backlog_id: args.backlog_id,
            message: `Backlog item '${args.backlog_id}' linked to feature '${feature.name}'`
        };
    }

    async listFeatureBacklogItems(projectId: string, args: { feature_id: string }) {
        const normalizedProject = this.projects.requireProject(projectId);
        const feature = await this.fetchFeature(normalizedProject, args.feature_id);
        if (!feature) {
            return {
                found: false,
                message: `Feature '${args.feature_id}' not found`
            };
        }

        const items = await this.backlog.getBacklogItemsByFeature(normalizedProject, feature.id);
        return {
            feature: feature.id,
            count: items.length,
            items
        };
    }

    async setFeatureLock(projectId: string, args: { locked: boolean }) {
        const normalizedProject = this.projects.requireProject(projectId);
        await this.projects.setFeatureCreationLock(normalizedProject, args.locked);
        return {
            success: true,
            project: normalizedProject,
            locked: args.locked,
            message: args.locked
                ? "Feature creation has been locked for this project."
                : "Feature creation lock removed for this project."
        };
    }

    private buildFeatureFilter(tags?: unknown, status?: string) {
        const must: any[] = [];
        if (Array.isArray(tags) && tags.length > 0) {
            must.push({
                key: "tags",
                match: { any: tags }
            });
        }
        if (status) {
            must.push({
                key: "status",
                match: { value: status }
            });
        }
        if (must.length === 0) {
            return undefined;
        }
        return { must };
    }

    private async fetchFeature(projectId: string, id: string): Promise<FeatureRecord | null> {
        const response = await this.qdrant.retrieve(this.getCollection(projectId), [id]);
        const point = response?.[0];
        if (!point) {
            return null;
        }
        const score = typeof (point as any)?.score === "number" ? (point as any).score : undefined;
        return this.mapFeature(point.payload ?? {}, point.id, score);
    }

    private async touchFeature(projectId: string, id: string) {
        const now = new Date().toISOString();
        await this.qdrant.setPayload(this.getCollection(projectId), id, {
            updated_at: now
        });
    }

    private mapFeature(payload: any, idRaw: unknown, score?: number): FeatureRecord {
        const id = typeof idRaw === "string" ? idRaw : String(idRaw);
        return {
            id,
            name: typeof payload.name === "string" ? payload.name : id,
            description: typeof payload.description === "string" ? payload.description : null,
            tags: Array.isArray(payload.tags) ? payload.tags : [],
            status: typeof payload.status === "string" ? payload.status : null,
            owner: typeof payload.owner === "string" ? payload.owner : null,
            created_at: typeof payload.created_at === "string" ? payload.created_at : "",
            updated_at: typeof payload.updated_at === "string" ? payload.updated_at : "",
            score
        };
    }

    private async embedFeature(name: string, description: string) {
        return await this.embedding.embed(`${name}\n\n${description}`.trim());
    }

    private getCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.collection);
    }
}
