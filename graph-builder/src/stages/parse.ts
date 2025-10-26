import { glob } from 'glob';
import path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { ParseOutput, BuildConfig, GitChange } from '../types/index.js';
import { JavaScriptParser } from '../parsers/javascript.parser.js';
import { MarkdownParser } from '../parsers/markdown.parser.js';
import { AssetParser } from '../parsers/asset.parser.js';
import { GitHelper } from '../utils/git.js';
import { logger } from '../utils/logger.js';

export class ParseStage {
    private jsParser = new JavaScriptParser();
    private mdParser = new MarkdownParser();
    private assetParser = new AssetParser();

    async execute(config: BuildConfig): Promise<ParseOutput> {
        logger.info(`Starting parse stage (${config.mode} mode)`);
        const startTime = Date.now();

        const git = new GitHelper(config.repoPath);
        const currentCommit = await git.getCurrentCommit();

        let filesToProcess: string[] = [];

        if (config.mode === 'full') {
            // Full rebuild - process all files
            filesToProcess = await glob('**/*.{js,ts,jsx,tsx,md,json,yml,yaml}', {
                cwd: config.repoPath,
                ignore: ['node_modules/**', 'dist/**', '.git/**', '**/*.test.*']
            });
            logger.info(`Full rebuild: processing ${filesToProcess.length} files`);
        } else {
            // Incremental - only changed files
            const baseCommit = config.baseCommit || await git.getLastBuildCommit();
            const changes = await git.getChangedFiles(baseCommit || undefined);

            filesToProcess = changes
                .filter(c => c.status !== 'deleted')
                .filter(c => /\.(js|ts|jsx|tsx|md|json|yml|yaml)$/.test(c.file))
                .map(c => c.file);

            logger.info(`Incremental build: processing ${filesToProcess.length} changed files (base commit: ${(baseCommit || 'initial').toString().substring(0, 7)})`);
        }

        const output: ParseOutput = {
            entities: [],
            relationships: [],
            metadata: {
                timestamp: new Date().toISOString(),
                commit: currentCommit,
                filesProcessed: 0
            }
        };

        const total = filesToProcess.length;
        if (total === 0) {
            logger.info('Parse stage: no files to process');
        }
        const progressInterval = total >= 10 ? Math.ceil(total / 10) : 1;

        // Process files
        for (const [index, file] of filesToProcess.entries()) {
            try {
                const ext = path.extname(file);
                let result;

                if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
                    result = await this.jsParser.parseFile(file, config.repoPath);
                } else if (ext === '.md') {
                    result = await this.mdParser.parseFile(file, config.repoPath);
                } else if (['.json', '.yml', '.yaml'].includes(ext)) {
                    result = await this.assetParser.parseFile(file, config.repoPath);
                } else {
                    continue;
                }

                output.entities.push(...result.entities);
                output.relationships.push(...result.relationships);
                output.metadata.filesProcessed++;

            } catch (error) {
                logger.error(`Error processing ${file}:`, error);
            }

            const processed = index + 1;
            if (processed % progressInterval === 0 || processed === total) {
                logger.info(
                    `Parse progress: ${processed}/${total} files processed`
                );
            }
        }

        // Save output
        const outputPath = path.join(config.stagingPath, 'parse', 'output.json');
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(output, null, 2));

        // Save build metadata
        await git.saveLastBuildCommit(currentCommit);

        const duration = Date.now() - startTime;
        logger.info(`Parse stage complete: ${output.entities.length} entities, ${output.relationships.length} relationships in ${duration}ms`);

        return output;
    }
}
