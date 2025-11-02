import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QdrantClient } from "@qdrant/js-client-rest";
import neo4j from "neo4j-driver";

type CollectionDefinition = {
    name: string;
    dimension: number;
    distance: "Cosine" | "Euclid" | "Dot";
    onDiskPayload?: boolean;
    optimizersConfig?: Record<string, unknown>;
};

type ProjectsFile = {
    defaultProject: string;
    projects: string[];
    locks?: {
        features?: string[];
    };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const collectionsPath = path.join(projectRoot, "config", "collections.json");
const projectsPath = path.join(projectRoot, "config", "projects.json");
const migrationFlagPath = path.join(projectRoot, "config", ".memory-project-migrated");

const TARGET_PROJECT = (process.env.LEGACY_MIGRATION_PROJECT ?? "memory").trim().toLowerCase();

const normalizeProjectId = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");

async function loadCollections(): Promise<CollectionDefinition[]> {
    const raw = await readFile(collectionsPath, "utf8");
    const parsed = JSON.parse(raw) as { collections: CollectionDefinition[] };
    return parsed.collections ?? [];
}

async function loadProjectsFile(): Promise<ProjectsFile> {
    try {
        const raw = await readFile(projectsPath, "utf8");
        const parsed = JSON.parse(raw) as ProjectsFile;
        return parsed;
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            return {
                defaultProject: TARGET_PROJECT,
                projects: [TARGET_PROJECT]
            };
        }
        throw error;
    }
}

async function saveProjectsFile(data: ProjectsFile) {
    const payload: ProjectsFile = {
        defaultProject: data.defaultProject,
        projects: Array.from(new Set(data.projects))
    };
    const featureLocks = data.locks?.features ?? [];
    const normalizedLocks = Array.from(
        new Set(featureLocks.map((value) => normalizeProjectId(value)))
    ).filter((value) => value.length > 0);
    if (normalizedLocks.length > 0) {
        payload.locks = { features: normalizedLocks };
    }
    await writeFile(projectsPath, JSON.stringify(payload, null, 2), "utf8");
}

async function ensureProjectsConfigured() {
    const current = await loadProjectsFile();
    const normalizedTarget = normalizeProjectId(TARGET_PROJECT);
    const projects = new Set(
        (current.projects ?? []).map((project) => normalizeProjectId(project)).filter(Boolean)
    );
    projects.add(normalizedTarget);

    const featureLocks = new Set(
        (current.locks?.features ?? [])
            .map((project) => normalizeProjectId(project))
            .filter(Boolean)
    );

    const updated: ProjectsFile = {
        defaultProject: normalizedTarget,
        projects: Array.from(projects.values()),
        locks: featureLocks.size > 0 ? { features: Array.from(featureLocks.values()) } : undefined
    };

    await saveProjectsFile(updated);
}

async function collectionExists(client: QdrantClient, name: string): Promise<boolean> {
    try {
        await client.getCollection(name);
        return true;
    } catch (error: any) {
        const status = typeof error?.status === "number" ? error.status : error?.response?.status;
        if (status === 404) {
            return false;
        }
        throw error;
    }
}

async function ensureTargetCollection(
    client: QdrantClient,
    collection: CollectionDefinition,
    targetName: string
) {
    const exists = await collectionExists(client, targetName);
    if (exists) {
        return;
    }

    await client.createCollection(targetName, {
        vectors: {
            size: collection.dimension,
            distance: collection.distance
        },
        on_disk_payload: collection.onDiskPayload,
        optimizers_config: collection.optimizersConfig
    });
}

async function migrateCollection(
    client: QdrantClient,
    collection: CollectionDefinition,
    legacyName: string,
    targetName: string
) {
    const legacyExists = await collectionExists(client, legacyName);
    if (!legacyExists) {
        return;
    }

    await ensureTargetCollection(client, collection, targetName);

    console.info(`[migration] Copying '${legacyName}' -> '${targetName}'`);

    let pageOffset: unknown;
    const limit = 200;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const scrollRequest: Record<string, unknown> = {
            with_payload: true,
            with_vector: true,
            limit
        };

        if (typeof pageOffset === "string" || typeof pageOffset === "number") {
            scrollRequest.offset = pageOffset;
        }

        const response = await client.scroll(legacyName, scrollRequest);

        const points = response.points ?? [];
        if (points.length > 0) {
            type UpsertVector =
                | number[]
                | number[][]
                | { [key: string]: number[] | number[][] | { indices: number[]; values: number[] } };
            type UpsertPoint = {
                id: string | number;
                payload: Record<string, unknown>;
                vector: UpsertVector;
            };

            const batch: UpsertPoint[] = [];
            for (const point of points) {
                const rawVector = point.vector;
                if (!rawVector) {
                    continue;
                }

                batch.push({
                    id: point.id,
                    payload: (point.payload ?? {}) as Record<string, unknown>,
                    vector: rawVector as UpsertVector
                });
            }

            if (batch.length > 0) {
                await client.upsert(targetName, {
                    wait: true,
                    points: batch
                });
            }
        }

        if (!response.next_page_offset) {
            break;
        }

        pageOffset = response.next_page_offset ?? undefined;
    }

    console.info(`[migration] Deleting legacy collection '${legacyName}'`);
    await client.deleteCollection(legacyName);
}

async function migrateQdrantCollections() {
    const url = process.env.QDRANT_URL || "http://localhost:6333";
    const client = new QdrantClient({ url });
    const collections = await loadCollections();
    const targetProject = normalizeProjectId(TARGET_PROJECT);

    for (const definition of collections) {
        const legacyName = definition.name;
        const targetName = `${targetProject}__${definition.name}`;

        try {
            await migrateCollection(client, definition, legacyName, targetName);
        } catch (error) {
            console.error(`[migration] Failed to migrate collection '${legacyName}'`, error);
            throw error;
        }
    }
}

async function migrateNeo4j() {
    const url = process.env.NEO4J_URL || "bolt://localhost:7687";
    const user = process.env.NEO4J_USER || "neo4j";
    const password = process.env.NEO4J_PASSWORD || "password";

    const driver = neo4j.driver(url, neo4j.auth.basic(user, password), {
        disableLosslessIntegers: true
    });

    const session = driver.session();
    try {
        const project = normalizeProjectId(TARGET_PROJECT);
        console.info(`[migration] Tagging Neo4j nodes/relationships with project='${project}'`);

        await session.run(
            `
            MATCH (e:Entity)
            WHERE e.project IS NULL OR e.project = ""
            SET e.project = $project
        `,
            { project }
        );

        await session.run(
            `
            MATCH ()-[r]->()
            WHERE r.project IS NULL OR r.project = ""
            SET r.project = $project
        `,
            { project }
        );
    } finally {
        await session.close();
        await driver.close();
    }
}

function migrationAlreadyDone(): boolean {
    if (process.env.FORCE_LEGACY_MIGRATION === "1") {
        return false;
    }
    return fs.existsSync(migrationFlagPath);
}

async function writeMigrationFlag() {
    const payload = {
        project: normalizeProjectId(TARGET_PROJECT),
        completedAt: new Date().toISOString()
    };
    await writeFile(migrationFlagPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function migrateLegacyData() {
    if (migrationAlreadyDone()) {
        return;
    }

    console.info("[migration] Starting legacy data migration to project namespaces");

    await ensureProjectsConfigured();
    await migrateQdrantCollections();
    await migrateNeo4j();

    await writeMigrationFlag();
    console.info("[migration] Legacy data migration complete");
}
