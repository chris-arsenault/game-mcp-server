import { QdrantClient } from "@qdrant/js-client-rest";

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

    async scroll(collection: string, filter?: any, limit: number = 100) {
        return await this.client.scroll(collection, {
            filter,
            limit,
            with_payload: true,
            with_vector: false
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
}
