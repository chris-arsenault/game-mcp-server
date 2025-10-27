import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";

type StoreArgs = {
    content: string;
    updated_by?: string;
    tags?: string[];
};

export class HandoffTool {
    private collection = "handoff_notes";
    private handoffId = "handoff";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService
    ) {}

    async storeHandoff(args: StoreArgs) {
        const { content, updated_by, tags = [] } = args;
        const trimmed = content.trim();

        const existing = await this.fetchPoint();
        const existingContent = existing?.payload?.content as string | undefined;
        const updated = trimmed.length > 0 && trimmed !== (existingContent ?? "");

        const vector = await this.embedding.embed(trimmed || "handoff");
        const now = new Date().toISOString();

        await this.qdrant.upsert(this.collection, [
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

        return {
            success: true,
            updated,
            updated_at: now,
            message: updated ? "Handoff updated" : "Handoff unchanged"
        };
    }

    async fetchHandoff() {
        const point = await this.fetchPoint();
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

    private async fetchPoint(): Promise<{ payload?: Record<string, unknown> } | undefined> {
        const response = await this.qdrant.retrieve(this.collection, [this.handoffId]);
        const point = response?.[0];
        if (!point) {
            return undefined;
        }

        const payload = point.payload ?? undefined;
        return { payload: payload as Record<string, unknown> | undefined };
    }
}
