import { readFile } from 'fs/promises';
import path from 'path';
import { ParsedEntity, ParsedRelationship } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { parse as parseYaml } from 'yaml';

export class AssetParser {
    async parseFile(filePath: string, repoPath: string): Promise<{
        entities: ParsedEntity[];
        relationships: ParsedRelationship[];
    }> {
        const entities: ParsedEntity[] = [];
        const relationships: ParsedRelationship[] = [];

        try {
            const absolutePath = path.join(repoPath, filePath);
            const rawContent = await readFile(absolutePath, 'utf-8');
            const ext = path.extname(filePath).toLowerCase();

            let parsed: unknown;
            if (ext === '.json') {
                parsed = JSON.parse(rawContent);
            } else if (ext === '.yml' || ext === '.yaml') {
                parsed = parseYaml(rawContent);
            } else {
                return { entities, relationships };
            }

            const assetId = `asset:${filePath}`;
            const topLevelKeys = parsed && typeof parsed === 'object'
                ? Object.keys(parsed as Record<string, unknown>).slice(0, 25)
                : [];

            const entity: ParsedEntity = {
                id: assetId,
                type: 'asset',
                name: path.basename(filePath),
                path: filePath,
                content: rawContent.substring(0, 1500),
                metadata: {
                    format: ext.replace('.', ''),
                    topLevelKeys,
                    size: rawContent.length
                }
            };

            // Special handling for package manifests
            if (path.basename(filePath) === 'package.json' && parsed && typeof parsed === 'object') {
                const manifest = parsed as Record<string, unknown>;
                const dependencies = {
                    ...(manifest.dependencies as Record<string, string> | undefined),
                    ...(manifest.devDependencies as Record<string, string> | undefined)
                };

                entity.metadata.package = {
                    name: manifest.name,
                    version: manifest.version,
                    dependenciesCount: Object.keys(dependencies).length
                };

                for (const dep of Object.keys(dependencies)) {
                    relationships.push({
                        id: `${assetId}-depends-${dep}`,
                        type: 'DEPENDS_ON_PACKAGE',
                        source: assetId,
                        target: `package:${dep}`,
                        properties: {
                            version: dependencies[dep]
                        }
                    });
                }
            }

            entities.push(entity);
            return { entities, relationships };
        } catch (error) {
            logger.error(`Error parsing asset ${filePath}:`, error);
            return { entities, relationships };
        }
    }
}
