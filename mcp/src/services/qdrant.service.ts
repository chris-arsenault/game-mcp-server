import { QdrantClient } from "@qdrant/js-client-rest";

type Distance =
    | "Cosine"
    | "Euclid"
    | "Dot";

export interface CollectionOptions {
    size: number;
    distance: Distance;
    onDiskPayload?: boolean;
    optimizersConfig?: Record<string, unknown>;
}

export class QdrantService {
    private client: QdrantClient;

    constructor(url: string) {
        this.client = new QdrantClient({ url });
    }

    async upsert(collection: string, points: any[]) {
        return await this.client.upsert(collection, {
            wait: true,
            points
        });
    }

    async search(
        collection: string,
        vector: number[],
        limit: number = 5,
        filter?: any,
        scoreThreshold?: number,
        withVector: boolean = false
    ) {
        return await this.client.search(collection, {
            vector,
            limit,
            filter,
            score_threshold: scoreThreshold,
            with_payload: true,
            with_vector: withVector
        });
    }

    async scroll(collection: string, filter?: any, limit: number = 100, offset?: any) {
        return await this.client.scroll(collection, {
            filter,
            limit,
            with_payload: true,
            with_vector: false,
            offset
        });
    }

    async retrieve(collection: string, ids: string[]) {
        return await this.client.retrieve(collection, {
            ids,
            with_payload: true,
            with_vector: false
        });
    }

    async delete(collection: string, filter: any) {
        return await this.client.delete(collection, {
            filter
        });
    }

    async setPayload(collection: string, id: string, payload: Record<string, unknown>) {
        return await this.client.setPayload(collection, {
            payload,
            points: [id]
        });
    }

    async listCollections() {
        return await this.client.getCollections();
    }

    async ensureCollection(name: string, options: CollectionOptions) {
        try {
            await this.client.getCollection(name);
            return { created: false };
        } catch (error: any) {
            const status = typeof error?.status === "number" ? error.status : error?.response?.status;
            if (status !== 404) {
                throw error;
            }
        }

        await this.client.createCollection(name, {
            vectors: {
                size: options.size,
                distance: options.distance
            },
            on_disk_payload: options.onDiskPayload,
            optimizers_config: options.optimizersConfig
        });

        return { created: true };
    }

    async deleteCollection(name: string) {
        try {
            await this.client.deleteCollection(name);
        } catch (error: any) {
            const status = typeof error?.status === "number" ? error.status : error?.response?.status;
            if (status && status !== 404) {
                throw error;
            }
        }
    }
}
