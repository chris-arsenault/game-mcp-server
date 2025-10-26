import axios from 'axios';
import { ParsedEntity, EnrichedEntity } from '../types/index.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export class DocEnricher {
    private embeddingUrl = config.embedding.url;

    async enrich(entity: ParsedEntity): Promise<EnrichedEntity> {
        if (entity.type !== 'document' && entity.type !== 'asset') {
            return entity as EnrichedEntity;
        }

        const text = entity.content ?? '';
        const summary = this.buildSummary(text);

        try {
            const embedding = await this.generateEmbedding(text);
            return {
                ...entity,
                semanticDescription: summary,
                purpose: summary,
                embedding
            };
        } catch (error) {
            logger.warn(`Failed to embed document ${entity.id}:`, error);
            return {
                ...entity,
                semanticDescription: summary,
                purpose: summary
            };
        }
    }

    async enrichBatch(entities: ParsedEntity[]): Promise<EnrichedEntity[]> {
        if (entities.length === 0) {
            return [];
        }

        const results: EnrichedEntity[] = [];
        for (let i = 0; i < entities.length; i++) {
            results.push(await this.enrich(entities[i]));
            const processed = i + 1;
            if (processed % Math.max(1, Math.ceil(entities.length / 5)) === 0 || processed === entities.length) {
                logger.info(`Document enrichment progress: ${processed}/${entities.length}`);
            }
        }
        return results;
    }

    private buildSummary(text: string): string {
        if (!text) {
            return 'No content available.';
        }

        const normalized = text
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const firstParagraph = normalized.slice(0, 5).join(' ');

        return firstParagraph.length > 400
            ? `${firstParagraph.substring(0, 397)}...`
            : firstParagraph || 'Summary not available.';
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        if (!text) {
            return [];
        }

        const payload = {
            inputs: text.substring(0, 2048)
        };

        const response = await axios.post(`${this.embeddingUrl}/embed`, payload);
        return response.data[0] ?? [];
    }
}
