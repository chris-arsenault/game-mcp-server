import { simpleGit, SimpleGit } from 'simple-git';
import { GitChange } from '../types/index.js';
import { logger } from './logger.js';

export class GitHelper {
    private git: SimpleGit;

    constructor(repoPath: string) {
        this.git = simpleGit(repoPath);
    }

    async getCurrentCommit(): Promise<string> {
        const log = await this.git.log(['-1']);
        return log.latest?.hash || '';
    }

    async getChangedFiles(baseCommit?: string): Promise<GitChange[]> {
        try {
            const current = await this.getCurrentCommit();

            if (!baseCommit) {
                // First build - treat all files as added
                const files = await this.git.raw(['ls-files']);
                return files.split('\n')
                    .filter(f => f.trim())
                    .map(file => ({
                        file,
                        status: 'added' as const
                    }));
            }

            const diff = await this.git.diff([
                '--name-status',
                baseCommit,
                current
            ]);

            const changes: GitChange[] = [];

            for (const line of diff.split('\n')) {
                if (!line.trim()) continue;

                const parts = line.split('\t');
                const status = parts[0];
                const file = parts[1];

                if (status.startsWith('R')) {
                    // Renamed file
                    changes.push({
                        file: parts[2],
                        status: 'renamed',
                        oldPath: file
                    });
                } else {
                    const statusMap: Record<string, GitChange['status']> = {
                        'A': 'added',
                        'M': 'modified',
                        'D': 'deleted'
                    };

                    changes.push({
                        file,
                        status: statusMap[status] || 'modified'
                    });
                }
            }

            logger.info(`Found ${changes.length} changed files since ${baseCommit.substring(0, 7)}`);
            return changes;

        } catch (error) {
            logger.error('Error getting changed files:', error);
            throw error;
        }
    }

    async getLastBuildCommit(): Promise<string | null> {
        try {
            // Read last build commit from staging metadata
            const fs = await import('fs/promises');
            const path = await import('path');
            const metadataPath = path.join(
                process.env.STAGING_PATH || '/staging',
                'last-build.json'
            );

            const data = await fs.readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(data);
            return metadata.commit || null;
        } catch (error) {
            return null;
        }
    }

    async saveLastBuildCommit(commit: string): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const metadataPath = path.join(
            process.env.STAGING_PATH || '/staging',
            'last-build.json'
        );

        await fs.writeFile(
            metadataPath,
            JSON.stringify({
                commit,
                timestamp: new Date().toISOString()
            }, null, 2)
        );
    }
}
