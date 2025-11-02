import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QdrantService, CollectionOptions } from "./qdrant.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const projectsFilePath = path.join(projectRoot, "config", "projects.json");
const collectionsFilePath = path.join(projectRoot, "config", "collections.json");

type CollectionConfig = {
    name: string;
    description?: string;
    dimension: number;
    distance: CollectionOptions["distance"];
    onDiskPayload?: boolean;
    optimizersConfig?: Record<string, unknown>;
    primaryAgents?: string[];
};

type ProjectsFile = {
    defaultProject: string;
    projects: string[];
    locks?: {
        features?: string[];
    };
};

export class ProjectService {
    private projects = new Set<string>();
    private defaultProject = "default";
    private collections: CollectionConfig[] = [];
    private featureLocks = new Set<string>();

    constructor(private qdrant: QdrantService) {}

    async initialize() {
        await this.loadCollectionsConfig();
        await this.loadProjectsFile();
        await this.ensureDefaultProject();
    }

    getDefaultProject(): string {
        return this.defaultProject;
    }

    listProjects(): string[] {
        return Array.from(this.projects.values()).sort();
    }

    hasProject(projectId: string): boolean {
        try {
            return this.projects.has(this.normalizeProjectId(projectId));
        } catch {
            return false;
        }
    }

    isFeatureCreationLocked(projectId: string): boolean {
        return this.featureLocks.has(this.normalizeProjectId(projectId));
    }

    async setFeatureCreationLock(projectId: string, locked: boolean): Promise<void> {
        const normalized = this.normalizeProjectId(projectId);
        this.requireProject(normalized);
        if (locked) {
            this.featureLocks.add(normalized);
        } else {
            this.featureLocks.delete(normalized);
        }
        await this.saveProjectsFile();
    }

    requireProject(projectId: string): string {
        const normalized = this.normalizeProjectId(projectId);
        if (!this.projects.has(normalized)) {
            throw new Error(`Unknown project '${projectId}'`);
        }
        return normalized;
    }

    collectionName(projectId: string, baseCollection: string): string {
        return `${projectId}__${baseCollection}`;
    }

    getCollectionConfigs(): CollectionConfig[] {
        return [...this.collections];
    }

    getProjectCollections(projectId: string) {
        this.requireProject(projectId);
        return this.collections.map((definition) => ({
            baseName: definition.name,
            name: this.collectionName(projectId, definition.name),
            definition
        }));
    }

    async createProject(rawProjectId: string) {
        const projectId = this.normalizeProjectId(rawProjectId);

        if (this.projects.has(projectId)) {
            throw new Error(`Project '${projectId}' already exists`);
        }

        for (const definition of this.collections) {
            const collectionName = this.collectionName(projectId, definition.name);
            await this.qdrant.ensureCollection(collectionName, {
                size: definition.dimension,
                distance: definition.distance,
                onDiskPayload: definition.onDiskPayload,
                optimizersConfig: definition.optimizersConfig
            });
        }

        this.projects.add(projectId);
        this.featureLocks.delete(projectId);
        await this.saveProjectsFile();

        return {
            projectId,
            collections: this.getProjectCollections(projectId)
        };
    }

    private async ensureDefaultProject() {
        const desiredDefault =
            process.env.DEFAULT_PROJECT?.trim().toLowerCase() ||
            this.defaultProject;

        const normalizedDefault = this.normalizeProjectId(desiredDefault);
        this.defaultProject = normalizedDefault;
        this.featureLocks.delete(normalizedDefault);

        if (!this.projects.has(normalizedDefault)) {
            await this.createProject(normalizedDefault);
            this.defaultProject = normalizedDefault;
        }
    }

    private async loadCollectionsConfig() {
        const raw = await readFile(collectionsFilePath, "utf8");
        const parsed = JSON.parse(raw) as { collections?: CollectionConfig[] };
        const collections = parsed.collections ?? [];
        if (!Array.isArray(collections) || collections.length === 0) {
            throw new Error("config/collections.json must define at least one collection");
        }
        this.collections = collections.map((collection) => ({
            ...collection,
            name: this.normalizeCollectionName(collection.name)
        }));
    }

    private async loadProjectsFile() {
        try {
            const raw = await readFile(projectsFilePath, "utf8");
            const parsed = JSON.parse(raw) as ProjectsFile;
            const entries = Array.isArray(parsed.projects) ? parsed.projects : [];
            this.defaultProject = parsed.defaultProject
                ? this.normalizeProjectId(parsed.defaultProject)
                : this.defaultProject;
            entries
                .map((project) => this.normalizeProjectId(project))
                .forEach((project) => this.projects.add(project));

            const featureLockEntries = parsed.locks?.features ?? [];
            featureLockEntries
                .map((project) => this.normalizeProjectId(project))
                .forEach((project) => {
                    if (this.projects.has(project)) {
                        this.featureLocks.add(project);
                    }
                });
        } catch (error: any) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
            this.projects.add(this.defaultProject);
            await this.saveProjectsFile();
        }
    }

    private async saveProjectsFile() {
        const featureLocks = Array.from(this.featureLocks.values()).sort();
        const payload: ProjectsFile = {
            defaultProject: this.defaultProject,
            projects: this.listProjects()
        };
        if (featureLocks.length > 0) {
            payload.locks = { features: featureLocks };
        }
        await writeFile(projectsFilePath, JSON.stringify(payload, null, 2), "utf8");
    }

    private normalizeProjectId(projectId: string): string {
        const trimmed = projectId.trim().toLowerCase();
        const sanitized = trimmed
            .replace(/[^a-z0-9-_]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (!sanitized) {
            throw new Error("Project identifier must contain alphanumeric characters");
        }
        return sanitized;
    }

    private normalizeCollectionName(name: string): string {
        return name.trim();
    }
}
