import { ParseStage } from "../stages/parse.js";
import { EnrichStage } from "../stages/enrich.js";
import { PopulateStage } from "../stages/populate.js";
import {
    BuildRequest,
    BuildRunSummary,
    BuildStageSummary
} from "../types/index.js";
import { getBuildConfig, config as appConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { syncRepository } from "../utils/repo.js";

export class BuildService {
    private running = false;
    private currentRun?: {
        request: BuildRequest;
        startedAt: string;
    };
    private lastRun?: BuildRunSummary;

    private async performBuild(
        request: BuildRequest,
        startedAt: string
    ): Promise<BuildRunSummary> {
        const summary: BuildRunSummary = {
            request,
            startedAt,
            finishedAt: "",
            success: true,
            stages: []
        };

        try {
            const buildConfig = getBuildConfig(request.mode, request.baseCommit);
            const repoUrl = request.repoUrl ?? appConfig.repository.url;
            const branch = request.branch ?? appConfig.repository.branch;

            const stageFilter = request.stage ?? "all";

            if (stageFilter === "all" || stageFilter === "parse") {
                logger.info(`Preparing repository (${repoUrl} @ ${branch}) at ${buildConfig.repoPath}`);
                await syncRepository(buildConfig.repoPath, repoUrl, branch);
                logger.info("Repository ready");
            }

            if (stageFilter === "all" || stageFilter === "parse") {
                const parseStage = new ParseStage();
                const stageStart = Date.now();
                const output = await parseStage.execute(buildConfig);

                summary.stages.push(this.createStageSummary("parse", stageStart, {
                    entitiesProcessed: output.entities.length,
                    relationshipsProcessed: output.relationships.length,
                    metadata: {
                        filesProcessed: output.metadata.filesProcessed
                    }
                }));
            }

            if (stageFilter === "all" || stageFilter === "enrich") {
                const enrichStage = new EnrichStage();
                const stageStart = Date.now();
                const output = await enrichStage.execute(buildConfig);

                summary.stages.push(this.createStageSummary("enrich", stageStart, {
                    entitiesProcessed: output.metadata.entitiesEnriched,
                    relationshipsProcessed: output.relationships.length
                }));
            }

            if (stageFilter === "all" || stageFilter === "populate") {
                const populateStage = new PopulateStage();
                const stageStart = Date.now();
                const counts = await populateStage.execute(buildConfig);

                summary.stages.push(this.createStageSummary("populate", stageStart, {
                    entitiesProcessed: counts.entities,
                    relationshipsProcessed: counts.relationships
                }));
            }

            summary.finishedAt = new Date().toISOString();
            logger.info(
                `Build complete (${request.mode}/${request.stage ?? "all"}) in ${
                    new Date(summary.finishedAt).getTime() -
                    new Date(summary.startedAt).getTime()
                }ms`
            );
            return summary;
        } catch (error) {
            summary.success = false;
            summary.error = error instanceof Error ? error.message : String(error);
            summary.finishedAt = new Date().toISOString();
            logger.error("Build failed:", error);
            return summary;
        } finally {
            summary.finishedAt ||= new Date().toISOString();
        }
    }

    startBuild(request: BuildRequest): void {
        if (this.running) {
            throw new Error("A build is already in progress");
        }

        const repoUrl = request.repoUrl ?? appConfig.repository.url;
        const branch = request.branch ?? appConfig.repository.branch;
        const normalizedRequest: BuildRequest = {
            ...request,
            repoUrl,
            branch
        };

        this.running = true;
        const startedAt = new Date().toISOString();
        logger.info(
            `Build queued: mode=${normalizedRequest.mode}, stage=${normalizedRequest.stage ?? "all"}, repo=${repoUrl}, branch=${branch}`
        );

        this.currentRun = {
            request: normalizedRequest,
            startedAt
        };

        void this.performBuild(normalizedRequest, startedAt)
            .then((summary) => {
                this.lastRun = summary;
            })
            .catch((error) => {
                logger.error("Unexpected error in build execution:", error);
            })
            .finally(() => {
                this.running = false;
                this.currentRun = undefined;
            });
    }

    getStatus() {
        return {
            running: this.running,
            current: this.currentRun,
            lastRun: this.lastRun
        };
    }

    private createStageSummary(
        stage: BuildStageSummary["stage"],
        startedAt: number,
        options: {
            entitiesProcessed: number;
            relationshipsProcessed: number;
            metadata?: Record<string, unknown>;
        }
    ): BuildStageSummary {
        return {
            stage,
            durationMs: Date.now() - startedAt,
            entitiesProcessed: options.entitiesProcessed,
            relationshipsProcessed: options.relationshipsProcessed,
            metadata: options.metadata
        };
    }
}
