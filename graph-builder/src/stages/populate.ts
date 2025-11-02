import { readFile } from 'fs/promises';
import path from 'path';
import { EnrichOutput, BuildConfig } from '../types/index.js';
import { Neo4jPopulator } from '../populators/neo4j.populator.js';
import { QdrantPopulator } from '../populators/qdrant.populator.js';
import { logger } from '../utils/logger.js';

export class PopulateStage {
    private neo4j = new Neo4jPopulator();
    private qdrant = new QdrantPopulator();

    async execute(config: BuildConfig): Promise<{ entities: number; relationships: number }> {
        logger.info('Starting populate stage');
        const startTime = Date.now();

        // Load enrich output
        const enrichOutputPath = path.join(config.stagingPath, 'enrich', 'output.json');
        const enrichData = await readFile(enrichOutputPath, 'utf-8');
        const enrichOutput: EnrichOutput = JSON.parse(enrichData);

        // Initialize databases
        await this.neo4j.initialize();
        await this.qdrant.initialize(config.projectId);

        // Populate Neo4j
        await this.neo4j.populateEntities(config.projectId, enrichOutput.entities);
        await this.neo4j.populateRelationships(config.projectId, enrichOutput.relationships);

        // Clear stale data (only in incremental mode)
        if (config.mode === 'incremental') {
            const currentIds = enrichOutput.entities.map(e => e.id);
            await this.neo4j.clearStaleData(config.projectId, currentIds);
        }

        // Populate Qdrant
        await this.qdrant.populateEntities(config.projectId, enrichOutput.entities);

        // Cleanup
        await this.neo4j.close();

        const duration = Date.now() - startTime;
        logger.info(`Populate stage complete: ${enrichOutput.entities.length} entities, ${enrichOutput.relationships.length} relationships in ${duration}ms`);

        return {
            entities: enrichOutput.entities.length,
            relationships: enrichOutput.relationships.length
        };
    }
}
