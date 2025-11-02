import neo4j, { Driver, Session } from 'neo4j-driver';
import { EnrichedEntity, ParsedRelationship } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class Neo4jPopulator {
    private driver: Driver;

    constructor() {
        this.driver = neo4j.driver(
            config.neo4j.url,
            neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
        );
    }

    async initialize(): Promise<void> {
        const session = this.driver.session();
        try {
            // Create indexes
            await session.run('CREATE INDEX IF NOT EXISTS FOR (n:Entity) ON (n.id)');
            await session.run('CREATE INDEX IF NOT EXISTS FOR (n:Entity) ON (n.type)');
            await session.run('CREATE INDEX IF NOT EXISTS FOR (n:Entity) ON (n.path)');
            await session.run('CREATE INDEX IF NOT EXISTS FOR (n:Entity) ON (n.project)');

            logger.info('Neo4j indexes created');
        } finally {
            await session.close();
        }
    }

    async populateEntities(projectId: string, entities: EnrichedEntity[]): Promise<void> {
        const session = this.driver.session();

        try {
            logger.info(`Populating ${entities.length} entities in Neo4j`);

            // Batch insert entities
            const batchSize = 100;
            const total = entities.length;
            for (let i = 0; i < entities.length; i += batchSize) {
                const batch = entities.slice(i, i + batchSize);

                await session.executeWrite(async tx => {
                    for (const entity of batch) {
                        await tx.run(
                            `
              MERGE (e:Entity {id: $id, project: $projectId})
              SET e.type = $type,
                  e.name = $name,
                  e.path = $path,
                  e.semanticDescription = $semanticDescription,
                  e.purpose = $purpose,
                  e.patterns = $patterns,
                  e.architecturalRole = $architecturalRole,
                  e.complexity = $complexity,
                  e.metadata = $metadata,
                  e.updatedAt = datetime()
              `,
                            {
                                id: entity.id,
                                type: entity.type,
                                name: entity.name,
                                path: entity.path,
                                semanticDescription: entity.semanticDescription || null,
                                purpose: entity.purpose || null,
                                patterns: entity.patterns || [],
                                architecturalRole: entity.architecturalRole || null,
                                complexity: entity.complexity || null,
                                metadata: JSON.stringify(entity.metadata),
                                projectId
                            }
                        );
                    }
                });

                const processed = Math.min(i + batch.length, total);
                logger.info(`Neo4j entity load: ${processed}/${total}`);
            }

            logger.info('Entity population complete');
        } finally {
            await session.close();
        }
    }

    async populateRelationships(projectId: string, relationships: ParsedRelationship[]): Promise<void> {
        const session = this.driver.session();

        try {
            logger.info(`Populating ${relationships.length} relationships in Neo4j`);

            const batchSize = 100;
            const total = relationships.length;
            for (let i = 0; i < relationships.length; i += batchSize) {
                const batch = relationships.slice(i, i + batchSize);

                await session.executeWrite(async tx => {
                    for (const rel of batch) {
                        // Create relationship with dynamic type
                        await tx.run(
                            `
              MATCH (source:Entity {id: $sourceId, project: $projectId})
              MATCH (target:Entity {id: $targetId, project: $projectId})
              MERGE (source)-[r:\`${rel.type}\`]->(target)
              SET r.properties = $properties,
                  r.project = $projectId,
                  r.updatedAt = datetime()
              `,
                            {
                                sourceId: rel.source,
                                targetId: rel.target,
                                properties: JSON.stringify(rel.properties),
                                projectId
                            }
                        );
                    }
                });

                const processed = Math.min(i + batch.length, total);
                logger.info(`Neo4j relationship load: ${processed}/${total}`);
            }

            logger.info('Relationship population complete');
        } finally {
            await session.close();
        }
    }

    async clearStaleData(projectId: string, currentEntityIds: string[]): Promise<void> {
        const session = this.driver.session();

        try {
            logger.info('Clearing stale data from Neo4j');

            // Delete entities not in current set
            await session.run(
                `
        MATCH (e:Entity)
        WHERE e.project = $projectId AND NOT e.id IN $currentIds
        DETACH DELETE e
        `,
                { currentIds: currentEntityIds, projectId }
            );

            logger.info('Stale data cleared');
        } finally {
            await session.close();
        }
    }

    async close(): Promise<void> {
        await this.driver.close();
    }
}
