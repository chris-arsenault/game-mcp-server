import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { ProjectService } from "../services/project.service.js";

type CreateBacklogArgs = {
    title: string;
    description: string;
    status: string;
    priority: string;
    next_steps?: string[];
    completed_work?: string[];
    tags?: string[];
    owner?: string;
    due_date?: string;
    sprint?: string;
    story_points?: number;
    acceptance_criteria?: string[];
    dependencies?: string[];
    notes?: string;
    category?: string;
    feature_id?: string | null;
};

type UpdateBacklogArgs = Partial<CreateBacklogArgs> & {
    id: string;
};

type TagSearchArgs = {
    tags?: string[];
    status?: string;
    priority?: string;
    owner?: string;
    limit?: number;
    feature_id?: string;
};

type SemanticSearchArgs = TagSearchArgs & {
    query: string;
    min_score?: number;
};

type TopBacklogArgs = {
    limit?: number;
    includeCompleted?: boolean;
};

type BacklogRecord = {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    next_steps: string[];
    completed_work: string[];
    tags: string[];
    owner: string | null;
    due_date: string | null;
    sprint: string | null;
    story_points: number | null;
    acceptance_criteria: string[];
    dependencies: string[];
    notes: string | null;
    category: string | null;
    feature_id: string | null;
    created_at: string;
    updated_at: string;
    score?: number;
};

export class BacklogTool {
    private collection = "backlog_items";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private projects: ProjectService
    ) {}

    async createBacklogItem(projectId: string, args: CreateBacklogArgs) {
        const now = new Date().toISOString();
        const id = randomUUID();

        const normalizedFeatureId = this.normalizeFeatureId(args.feature_id);
        const payload = {
            title: args.title,
            description: args.description,
            status: args.status,
            priority: args.priority,
            next_steps: args.next_steps ?? [],
            completed_work: args.completed_work ?? [],
            tags: args.tags ?? [],
            owner: args.owner ?? null,
            due_date: args.due_date ?? null,
            sprint: args.sprint ?? null,
            story_points: args.story_points ?? null,
            acceptance_criteria: args.acceptance_criteria ?? [],
            dependencies: args.dependencies ?? [],
            notes: args.notes ?? null,
            category: args.category ?? null,
            feature_id: normalizedFeatureId,
            created_at: now,
            updated_at: now
        };

        const vector = await this.embedForItem(payload);

        await this.qdrant.upsert(this.getCollection(projectId), [
            {
                id,
                vector,
                payload
            }
        ]);

        return {
            success: true,
            id,
            message: `Backlog item '${args.title}' created`
        };
    }

    async updateBacklogItem(projectId: string, args: UpdateBacklogArgs) {
        const { id, ...updates } = args;
        const existing = await this.fetchById(projectId, id);

        if (!existing) {
            return {
                success: false,
                message: `Backlog item '${id}' not found`
            };
        }

        const now = new Date().toISOString();
        const { score: _score, ...existingData } = existing;
        const merged = {
            ...existingData,
            ...this.cleanUpdates(updates),
            next_steps: updates.next_steps ?? existingData.next_steps,
            completed_work: updates.completed_work ?? existingData.completed_work,
            tags: updates.tags ?? existingData.tags,
            acceptance_criteria: updates.acceptance_criteria ?? existingData.acceptance_criteria,
            dependencies: updates.dependencies ?? existingData.dependencies,
            feature_id:
                Object.prototype.hasOwnProperty.call(updates, "feature_id")
                    ? this.normalizeFeatureId(updates.feature_id)
                    : existingData.feature_id,
            updated_at: now
        };

        const vector = await this.embedForItem(merged);

        await this.qdrant.upsert(this.getCollection(projectId), [
            {
                id,
                vector,
                payload: merged
            }
        ]);

        return {
            success: true,
            id,
            message: `Backlog item '${id}' updated`
        };
    }

    async searchBacklogByTag(projectId: string, args: TagSearchArgs) {
        const { tags = [], status, priority, owner, limit = 25 } = args;
        const filter = this.buildFilter({ tags, status, priority, owner, feature_id: args.feature_id });

        const response: any = await this.qdrant.scroll(
            this.getCollection(projectId),
            filter,
            limit
        );

        const points = response.points ?? [];
        const items = points.map((point: any) => this.mapPoint(point));

        return {
            count: items.length,
            items
        };
    }

    async searchBacklogSemantics(projectId: string, args: SemanticSearchArgs) {
        const {
            query,
            tags = [],
            status,
            priority,
            owner,
            limit = 10,
            min_score = 0.55
        } = args;

        const vector = await this.embedding.embed(query);
        const filter = this.buildFilter({ tags, status, priority, owner, feature_id: args.feature_id });

        const results: any[] = await this.qdrant.search(
            this.getCollection(projectId),
            vector,
            limit,
            filter,
            min_score
        );

        return {
            count: results.length,
            items: results.map(point => this.mapPoint(point))
        };
    }

    async getTopBacklogItems(projectId: string, args: TopBacklogArgs = {}) {
        const { includeCompleted = false } = args;
        const normalizedLimit = Math.min(Math.max(1, args.limit ?? 5), 20);

        const filter = includeCompleted
            ? undefined
            : {
                  must_not: [
                      {
                          key: "status",
                          match: { any: ["done", "completed", "archived"] }
                      }
                  ]
              };

        const response: any = await this.qdrant.scroll(
            this.getCollection(projectId),
            filter,
            normalizedLimit * 5
        );

        const points = (response.points ?? []) as any[];

        const sorted = points
            .map((point) => this.mapPoint(point))
            .sort((a, b) => this.priorityRank(a.priority) - this.priorityRank(b.priority))
            .slice(0, normalizedLimit);

        return {
            count: sorted.length,
            items: sorted
        };
    }

    async getBacklogItemsByFeature(projectId: string, featureId: string, limit: number = 200) {
        const normalized = this.normalizeFeatureId(featureId);
        if (!normalized) {
            return [];
        }

        const filter = {
            must: [
                {
                    key: "feature_id",
                    match: { value: normalized }
                }
            ]
        };

        const response: any = await this.qdrant.scroll(this.getCollection(projectId), filter, limit);
        const points = response.points ?? [];
        return points.map((point: any) => this.mapPoint(point));
    }

    private priorityRank(priority: string): number {
        const normalized = priority.trim().toLowerCase();
        if (/^p?0$/.test(normalized) || normalized === "critical" || normalized === "blocker") {
            return 0;
        }
        if (/^p?1$/.test(normalized) || normalized === "high") {
            return 1;
        }
        if (/^p?2$/.test(normalized) || normalized === "medium") {
            return 2;
        }
        if (/^p?3$/.test(normalized) || normalized === "low") {
            return 3;
        }
        return 4;
    }

    private async fetchById(projectId: string, id: string): Promise<BacklogRecord | undefined> {
        const response = await this.qdrant.retrieve(this.getCollection(projectId), [id]);
        const point = response?.[0];
        if (!point) {
            return undefined;
        }
        return this.mapPoint(point);
    }

    private cleanUpdates(updates: Partial<CreateBacklogArgs>) {
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                cleaned[key] = value;
            }
        }
        return cleaned;
    }

    private buildFilter(params: {
        tags?: string[];
        status?: string;
        priority?: string;
        owner?: string;
        feature_id?: string;
    }) {
        const must: any[] = [];

        if (params.tags && params.tags.length > 0) {
            must.push({
                key: "tags",
                match: { any: params.tags }
            });
        }

        if (params.status) {
            must.push({
                key: "status",
                match: { value: params.status }
            });
        }

        if (params.priority) {
            must.push({
                key: "priority",
                match: { value: params.priority }
            });
        }

        if (params.owner) {
            must.push({
                key: "owner",
                match: { value: params.owner }
            });
        }

        if (params.feature_id) {
            must.push({
                key: "feature_id",
                match: { value: params.feature_id }
            });
        }

        if (must.length === 0) {
            return undefined;
        }

        return { must };
    }

    private mapPoint(point: any): BacklogRecord {
        const payload = point.payload ?? {};
        const id = typeof point.id === "string" ? point.id : String(point.id);
        return {
            id,
            title: payload.title ?? "",
            description: payload.description ?? "",
            status: payload.status ?? "",
            priority: payload.priority ?? "",
            next_steps: payload.next_steps ?? [],
            completed_work: payload.completed_work ?? [],
            tags: payload.tags ?? [],
            owner: payload.owner ?? null,
            due_date: payload.due_date ?? null,
            sprint: payload.sprint ?? null,
            story_points: payload.story_points ?? null,
            acceptance_criteria: payload.acceptance_criteria ?? [],
            dependencies: payload.dependencies ?? [],
            notes: payload.notes ?? null,
            category: payload.category ?? null,
            feature_id: typeof payload.feature_id === "string" ? payload.feature_id : null,
            created_at: payload.created_at ?? "",
            updated_at: payload.updated_at ?? "",
            score: point.score
        };
    }

    private async embedForItem(payload: {
        title: string;
        description: string;
        status: string;
        priority: string;
        next_steps: string[];
        completed_work: string[];
        tags: string[];
        owner: string | null;
        due_date: string | null;
        sprint: string | null;
        story_points: number | null;
        acceptance_criteria: string[];
        dependencies: string[];
        notes: string | null;
        category: string | null;
        feature_id: string | null;
    }) {
        const text = [
            payload.title,
            payload.description,
            `Status: ${payload.status}`,
            `Priority: ${payload.priority}`,
            payload.next_steps.join("\n"),
            payload.completed_work.join("\n"),
            payload.acceptance_criteria.join("\n"),
            payload.dependencies.join("\n"),
            payload.notes ?? "",
            payload.tags.join(", "),
            payload.owner ?? "",
            payload.category ?? "",
            payload.sprint ?? "",
            payload.feature_id ?? ""
        ].join("\n\n");

        return await this.embedding.embed(text);
    }

    private getCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.collection);
    }

    private normalizeFeatureId(value: unknown): string | null {
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        return null;
    }
}
