import { QdrantClient } from '@qdrant/js-client-rest';
import { EnrichedEntity } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class QdrantPopulator {
    private client: QdrantClient;
    private collectionName = 'code_graph';

    constructor() {
        this.client = new QdrantClient({ url: config.qdrant.url });
    }

    async initialize(): Promise<void> {
        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === this.collectionName);

            if (!exists) {
                await this.client.createCollection(this.collectionName, {
                    vectors: {
                        size: 768, // align with embedding dimension
                        distance: 'Cosine'
                    }
                });
                logger.info(`Created Qdrant collection: ${this.collectionName}`);
            } else {
                const info = await this.client.getCollection(this.collectionName);
                const currentSize = info.config?.params?.vectors?.size;
                if (currentSize !== 768) {
                    const message = `Qdrant collection ${this.collectionName} has dimension ${currentSize}, expected 768. Please recreate the collection to continue.`;
                    logger.error(message);
                    throw new Error(message);
                }
            }
        } catch (error) {
            logger.error('Error initializing Qdrant:', error);
            throw error;
        }
    }

    async populateEntities(entities: EnrichedEntity[]): Promise<void> {
        logger.info(`Populating ${entities.length} entities in Qdrant`);

        // Only store entities with embeddings
        const withEmbeddings = entities.filter(e => e.embedding && e.embedding.length > 0);

        if (withEmbeddings.length === 0) {
            logger.warn('No entities with embeddings to store in Qdrant');
            return;
        }

        const points = withEmbeddings.map(entity => ({
            id: this.hashId(entity.id),
            vector: entity.embedding!,
            payload: {
                entityId: entity.id,
                type: entity.type,
                name: entity.name,
                path: entity.path,
                semanticDescription: entity.semanticDescription,
                purpose: entity.purpose,
                patterns: entity.patterns,
                architecturalRole: entity.architecturalRole,
                complexity: entity.complexity,
                content: entity.content?.substring(0, 500) // Store snippet
            }
        }));

        // Upload in batches
        const batchSize = 100;
        const total = points.length;
        for (let i = 0; i < points.length; i += batchSize) {
            const batch = points.slice(i, i + batchSize);

            await this.client.upsert(this.collectionName, {
                wait: true,
                points: batch
            });

            const processed = Math.min(i + batch.length, total);
            logger.info(`Qdrant upsert progress: ${processed}/${total}`);
        }

        logger.info('Qdrant population complete');
    }

    private hashId(id: string): number {
        // Simple hash function to convert string ID to number
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            const char = id.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }
}
