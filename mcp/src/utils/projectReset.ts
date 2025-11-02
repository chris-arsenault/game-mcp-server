import fs from "node:fs/promises";
import path from "node:path";

import { QdrantService } from "../services/qdrant.service.js";
import { ProjectService } from "../services/project.service.js";
import { Neo4jService } from "../services/neo4j.service.js";

interface SnapshotOptions {
    projectId: string;
    snapshotDir: string;
    qdrant: QdrantService;
    projects: ProjectService;
    neo4j: Neo4jService;
}

async function ensureDirectory(dir: string) {
    await fs.mkdir(dir, { recursive: true });
}

async function snapshotQdrantCollections(options: SnapshotOptions, timestamp: string) {
    const { projectId, snapshotDir, qdrant, projects } = options;
    const definitions = projects.getCollectionConfigs();
    const projectDir = path.join(snapshotDir, projectId, timestamp, "qdrant");
    await ensureDirectory(projectDir);

    for (const definition of definitions) {
        const collectionName = projects.collectionName(projectId, definition.name);
        const legacyFile = path.join(projectDir, `${definition.name}.json`);

        const points: any[] = [];
        let offset: unknown = undefined;
        const limit = 256;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const scrollRequest: Record<string, unknown> = {
                with_payload: true,
                with_vector: true,
                limit
            };
            if (typeof offset === "string" || typeof offset === "number") {
                scrollRequest.offset = offset;
            }

            const response: any = await qdrant.scroll(collectionName, scrollRequest);
            const batch = response.points ?? [];
            if (batch.length > 0) {
                points.push(
                    ...batch.map((point: any) => ({
                        id: point.id,
                        payload: point.payload ?? {},
                        vector: point.vector ?? null
                    }))
                );
            }

            if (!response.next_page_offset) {
                break;
            }
            offset = response.next_page_offset;
        }

        await fs.writeFile(
            legacyFile,
            JSON.stringify(
                {
                    project: projectId,
                    collection: definition.name,
                    points
                },
                null,
                2
            ),
            "utf8"
        );

        // Drop and recreate the collection to clear data
        await qdrant.deleteCollection(collectionName);
        await qdrant.ensureCollection(collectionName, {
            size: definition.dimension,
            distance: definition.distance,
            onDiskPayload: definition.onDiskPayload,
            optimizersConfig: definition.optimizersConfig
        });
    }
}

async function snapshotNeo4j(options: SnapshotOptions, timestamp: string) {
    const { projectId, snapshotDir, neo4j } = options;
    const dir = path.join(snapshotDir, projectId, timestamp);
    await ensureDirectory(dir);

    const snapshot = await neo4j.snapshotProject(projectId);
    await fs.writeFile(
        path.join(dir, "neo4j.json"),
        JSON.stringify({ project: projectId, ...snapshot }, null, 2),
        "utf8"
    );

    await neo4j.clearProject(projectId);
}

export async function snapshotAndResetProject(options: SnapshotOptions) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await ensureDirectory(options.snapshotDir);
    await snapshotQdrantCollections(options, timestamp);
    await snapshotNeo4j(options, timestamp);

    return {
        project: options.projectId,
        timestamp,
        snapshotPath: path.join(options.snapshotDir, options.projectId, timestamp)
    };
}
