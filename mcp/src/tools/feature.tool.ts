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
    priority?: number;
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
    priority: number;
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
        const requestedPriority = this.parsePriority(args.priority);
        const priority = requestedPriority ?? (await this.getNextPriority(normalizedProject));

        const payload = {
            name: args.name.trim(),
            description: (args.description ?? "").trim() || null,
            tags: Array.isArray(args.tags) ? args.tags : [],
            status: args.status ?? "proposed",
            owner: args.owner ?? null,
            priority,
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

        await this.normalizeFeaturePriorities(normalizedProject);

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
        const priority =
            args.priority !== undefined
                ? this.parsePriority(args.priority) ?? existing.priority
                : existing.priority;

        const merged = {
            ...existing,
            name: args.name ? args.name.trim() : existing.name,
            description:
                args.description !== undefined ? (args.description?.trim() || null) : existing.description,
            tags: Array.isArray(args.tags) ? args.tags : existing.tags,
            status: args.status ?? existing.status,
            owner: args.owner ?? existing.owner,
            priority,
            updated_at: now,
            created_at: existing.created_at
        };

        const shouldReembed = args.name !== undefined || args.description !== undefined;
        const vector = shouldReembed
            ? await this.embedFeature(merged.name, merged.description ?? "")
            : undefined;

        if (vector) {
            await this.qdrant.upsert(this.getCollection(normalizedProject), [
                {
                    id: args.id,
                    vector,
                    payload: merged
                }
            ]);
        } else {
            await this.qdrant.setPayload(
                this.getCollection(normalizedProject),
                args.id,
                this.buildFeaturePayload(merged)
            );
        }

        if (priority !== existing.priority) {
            await this.normalizeFeaturePriorities(normalizedProject);
        }

        return {
            success: true,
            id: args.id,
            message: `Feature '${args.id}' updated`
        };
    }

    async listFeatures(projectId: string, args: ListFeaturesArgs = {}) {
        const normalizedProject = this.projects.requireProject(projectId);
        const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);

        const normalizedFeatures = await this.normalizeFeaturePriorities(normalizedProject);
        const filteredFeatures = this.applyFeatureFilters(normalizedFeatures, args.tags, args.status);

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
            const featureIndex = new Map(filteredFeatures.map((feature) => [feature.id, feature]));
            const mapped = results
                .map((result: any) => {
                    const id = typeof result.id === "string" ? result.id : String(result.id);
                    const base = featureIndex.get(id);
                    if (!base) {
                        return this.mapFeature(result.payload ?? {}, id, result.score);
                    }
                    return {
                        ...base,
                        score: typeof result.score === "number" ? result.score : base.score
                    };
                })
                .filter((feature): feature is FeatureRecord => Boolean(feature));
            const ordered = this.sortFeaturesByPriority(mapped).slice(0, limit);
            return {
                count: ordered.length,
                features: ordered
            };
        }

        const ordered = filteredFeatures.slice(0, limit);
        return {
            count: ordered.length,
            features: ordered
        };
    }

    async getFeature(projectId: string, args: { id: string }) {
        const normalizedProject = this.projects.requireProject(projectId);
        let feature = await this.fetchFeature(normalizedProject, args.id);
        if (!feature) {
            return {
                found: false,
                message: `Feature '${args.id}' not found`
            };
        }

        if (feature.priority >= Number.MAX_SAFE_INTEGER) {
            const normalized = await this.normalizeFeaturePriorities(normalizedProject);
            const updated = normalized.find((entry) => entry.id === feature!.id);
            if (updated) {
                feature = updated;
            }
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
        const created = typeof payload.created_at === "string" ? payload.created_at : "";
        const updated = typeof payload.updated_at === "string" ? payload.updated_at : "";
        return {
            id,
            name: typeof payload.name === "string" ? payload.name : id,
            description: typeof payload.description === "string" ? payload.description : null,
            tags: Array.isArray(payload.tags) ? payload.tags : [],
            status: typeof payload.status === "string" ? payload.status : null,
            owner: typeof payload.owner === "string" ? payload.owner : null,
            created_at: created,
            updated_at: updated,
            priority: this.normalizePriority(payload.priority),
            score
        };
    }

    private async fetchAllFeaturePoints(projectId: string, filter?: any) {
        const collection = this.getCollection(projectId);
        const results: any[] = [];
        let offset: any = undefined;
        const pageSize = 200;

        do {
            const response: any = await this.qdrant.scroll(collection, filter, pageSize, offset);
            const points = Array.isArray(response?.points) ? response.points : [];
            if (points.length > 0) {
                results.push(...points);
            }
            offset = response?.next_page_offset;
        } while (offset);

        return results;
    }

    private async normalizeFeaturePriorities(projectId: string): Promise<FeatureRecord[]> {
        const points = await this.fetchAllFeaturePoints(projectId);
        if (points.length === 0) {
            return [];
        }

        const mapped = points.map((point: any) => this.mapFeature(point.payload ?? {}, point.id, point.score));
        const sorted = this.sortFeaturesByPriority(mapped);
        const now = new Date().toISOString();

        const updates: Array<{ id: string; priority: number }> = [];
        const normalized = sorted.map((feature, index) => {
            const desiredPriority = index + 1;
            if (feature.priority === desiredPriority) {
                return feature;
            }
            const updatedFeature: FeatureRecord = {
                ...feature,
                priority: desiredPriority,
                updated_at: now
            };
            updates.push({
                id: feature.id,
                priority: desiredPriority
            });
            return updatedFeature;
        });

        if (updates.length > 0) {
            await Promise.all(
                updates.map((update) =>
                    this.qdrant.setPayload(this.getCollection(projectId), update.id, {
                        priority: update.priority,
                        updated_at: now
                    })
                )
            );
        }

        return normalized;
    }

    private applyFeatureFilters(features: FeatureRecord[], tags?: unknown, status?: string): FeatureRecord[] {
        let filtered = features;

        if (Array.isArray(tags) && tags.length > 0) {
            const normalizedTags = tags
                .filter((value): value is string => typeof value === "string")
                .map((tag) => tag.trim().toLowerCase())
                .filter((tag) => tag.length > 0);

            if (normalizedTags.length > 0) {
                filtered = filtered.filter((feature) => {
                    const featureTags = new Set(
                        feature.tags
                            .filter((value): value is string => typeof value === "string")
                            .map((tag) => tag.trim().toLowerCase())
                    );
                    return normalizedTags.some((tag) => featureTags.has(tag));
                });
            }
        }

        if (status && status.trim().length > 0) {
            const normalizedStatus = status.trim().toLowerCase();
            filtered = filtered.filter((feature) => (feature.status ?? "").toLowerCase() === normalizedStatus);
        }

        return filtered;
    }

    private buildFeaturePayload(feature: FeatureRecord): Record<string, unknown> {
        return {
            name: feature.name,
            description: feature.description ?? null,
            tags: Array.isArray(feature.tags) ? feature.tags : [],
            status: feature.status ?? null,
            owner: feature.owner ?? null,
            priority: feature.priority,
            created_at: feature.created_at,
            updated_at: feature.updated_at
        };
    }

    private sortFeaturesByPriority(features: FeatureRecord[]): FeatureRecord[] {
        return [...features].sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }

            const aTime = this.toTimestamp(a.created_at);
            const bTime = this.toTimestamp(b.created_at);
            if (aTime !== bTime) {
                return aTime - bTime;
            }

            return a.id.localeCompare(b.id);
        });
    }

    private toTimestamp(value?: string | null): number {
        if (!value) {
            return Number.MAX_SAFE_INTEGER;
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
    }

    private parsePriority(value: unknown): number | undefined {
        if (typeof value === "number" && Number.isFinite(value)) {
            const normalized = Math.floor(value);
            return normalized >= 1 ? normalized : undefined;
        }
        if (typeof value === "string" && value.trim().length > 0) {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) {
                const normalized = Math.floor(numeric);
                return normalized >= 1 ? normalized : undefined;
            }
        }
        return undefined;
    }

    private normalizePriority(value: unknown): number {
        const parsed = this.parsePriority(value);
        return parsed ?? Number.MAX_SAFE_INTEGER;
    }

    private async getNextPriority(projectId: string) {
        const points = await this.fetchAllFeaturePoints(projectId);
        let max = 0;
        for (const point of points) {
            const value = this.parsePriority(point?.payload?.priority);
            if (value && value > max) {
                max = value;
            }
        }
        return max + 1;
    }

    private async embedFeature(name: string, description: string) {
        return await this.embedding.embed(`${name}\n\n${description}`.trim());
    }

    private getCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.collection);
    }
}
