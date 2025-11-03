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
    limit = 10,
    filter?: any,
    scoreThreshold?: number
  ) {
    return await this.client.search(collection, {
      vector,
      limit,
      filter,
      score_threshold: scoreThreshold,
      with_payload: true,
      with_vector: false
    });
  }

  async scroll(collection: string, filter?: any, limit = 100, offset?: any) {
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
}
