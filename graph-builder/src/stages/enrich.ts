import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { ParseOutput, EnrichOutput, BuildConfig } from '../types/index.js';
import { CodeEnricher } from '../enrichers/code.enricher.js';
import { DocEnricher } from '../enrichers/doc.enricher.js';
import { logger } from '../utils/logger.js';

export class EnrichStage {
    private codeEnricher = new CodeEnricher();
    private docEnricher = new DocEnricher();

    async execute(config: BuildConfig): Promise<EnrichOutput> {
        logger.info('Starting enrich stage');
        const startTime = Date.now();

        // Load parse output
        const parseOutputPath = path.join(config.stagingPath, 'parse', 'output.json');
        const parseData = await readFile(parseOutputPath, 'utf-8');
        const parseOutput: ParseOutput = JSON.parse(parseData);

        // Filter entities that need enrichment (classes, functions, components)
        const codeEntities = parseOutput.entities.filter(e =>
            ['class', 'function', 'component', 'system'].includes(e.type)
        );
        const docEntities = parseOutput.entities.filter(e =>
            ['document', 'asset'].includes(e.type)
        );

        logger.info(`Enriching ${codeEntities.length} code entities and ${docEntities.length} documentation/assets (${parseOutput.entities.length} total)`);

        // Enrich entities
        const [codeEnriched, docEnriched] = await Promise.all([
            this.codeEnricher.enrichBatch(codeEntities),
            this.docEnricher.enrichBatch(docEntities)
        ]);

        // Merge enriched with non-enriched entities
        const enrichedMap = new Map(
            [...codeEnriched, ...docEnriched].map(e => [e.id, e])
        );
        const allEntities = parseOutput.entities.map(e =>
            enrichedMap.get(e.id) || e
        );

        const output: EnrichOutput = {
            entities: allEntities as any,
            relationships: parseOutput.relationships,
            metadata: {
                timestamp: new Date().toISOString(),
                entitiesEnriched: codeEnriched.length + docEnriched.length
            }
        };

        // Save output
        const outputPath = path.join(config.stagingPath, 'enrich', 'output.json');
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(output, null, 2));

        const duration = Date.now() - startTime;
        logger.info(`Enrich stage complete: ${codeEnriched.length + docEnriched.length} entities enriched in ${duration}ms`);

        return output;
    }
}
