import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { ProjectService } from "../services/project.service.js";

type StoreArgs = {
    content: string;
    updated_by?: string;
    tags?: string[];
};

export class HandoffTool {
    private collection = "handoff_notes";
    // Use a deterministic UUID so Qdrant accepts the ID format across versions.
    private handoffId = "11111111-1111-1111-1111-111111111111";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private projects: ProjectService
    ) {}

    async storeHandoff(projectId: string, args: StoreArgs) {
        const { content, updated_by, tags = [] } = args;
        const trimmed = content.trim();

        const logContext = {
            updatedBy: updated_by ?? null,
            contentLength: trimmed.length,
            contentPreview: trimmed.substring(0, 120),
            tags
        };

        console.info("[HandoffTool] storeHandoff invoked", logContext);

        let existingContent: string | undefined;
        try {
            const existing = await this.fetchPoint(projectId);
            existingContent = existing?.payload?.content as string | undefined;
            console.info("[HandoffTool] existing handoff retrieved", {
                hasExisting: Boolean(existingContent),
                existingLength: existingContent?.length ?? 0
            });
        } catch (error) {
            console.error("[HandoffTool] failed to fetch existing handoff", {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        const updated = trimmed.length > 0 && trimmed !== (existingContent ?? "");

        let vector: number[] = [];
        try {
            vector = await this.embedding.embed(trimmed || "handoff");
            console.info("[HandoffTool] embedding generated", {
                vectorLength: vector.length
            });
        } catch (error) {
            console.error("[HandoffTool] failed to generate embedding", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }

        const now = new Date().toISOString();

        try {
            const result = await this.qdrant.upsert(this.getCollection(projectId), [
                {
                    id: this.handoffId,
                    vector,
                    payload: {
                        content: trimmed,
                        updated_by: updated_by ?? null,
                        tags,
                        updated_at: now
                    }
                }
            ]);
            console.info("[HandoffTool] Qdrant upsert completed", {
                resultStatus: result?.status ?? "unknown",
                updated
            });
        } catch (error) {
            console.error("[HandoffTool] Qdrant upsert failed", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }

        return {
            success: true,
            updated,
            updated_at: now,
            message: updated ? "Handoff updated" : "Handoff unchanged"
        };
    }

    async fetchHandoff(projectId: string) {
        const point = await this.fetchPoint(projectId);
        if (!point) {
            return {
                found: false,
                message: "No handoff information available"
            };
        }

        const payload = point.payload ?? {};

        return {
            found: true,
            content: (payload.content as string) ?? "",
            updated_by: payload.updated_by ?? null,
            updated_at: payload.updated_at ?? null,
            tags: payload.tags ?? []
        };
    }

    private async fetchPoint(projectId: string): Promise<{ payload?: Record<string, unknown> } | undefined> {
        const response = await this.qdrant.retrieve(this.getCollection(projectId), [this.handoffId]);
        const point = response?.[0];
        if (!point) {
            return undefined;
        }

        const payload = point.payload ?? undefined;
        return { payload: payload as Record<string, unknown> | undefined };
    }

    private getCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.collection);
    }
}
