import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROJECT_FALLBACK = (process.env.DEFAULT_PROJECT ?? 'default').trim().toLowerCase();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_CONFIG_PATH = path.resolve(__dirname, '../../../mcp/config/projects.json');
const PROJECT_CONFIG_TTL_MS = 30_000;

interface ProjectConfig {
    defaultProject: string;
    projects: string[];
}

let projectCache: { value: ProjectConfig; loadedAt: number } | undefined;

const normalizeProjectId = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

const loadProjectConfig = (): ProjectConfig => {
    if (projectCache && Date.now() - projectCache.loadedAt < PROJECT_CONFIG_TTL_MS) {
        return projectCache.value;
    }

    try {
        const raw = fs.readFileSync(PROJECT_CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
        const defaultProject = parsed.defaultProject
            ? normalizeProjectId(parsed.defaultProject)
            : normalizeProjectId(DEFAULT_PROJECT_FALLBACK);
        const projects = new Set<string>(
            Array.isArray(parsed.projects)
                ? parsed.projects.map(project => normalizeProjectId(project)).filter(Boolean)
                : []
        );
        projects.add(defaultProject);

        const config: ProjectConfig = {
            defaultProject,
            projects: Array.from(projects.values())
        };
        projectCache = { value: config, loadedAt: Date.now() };
        return config;
    } catch (error) {
        const fallback = normalizeProjectId(DEFAULT_PROJECT_FALLBACK);
        const config: ProjectConfig = {
            defaultProject: fallback,
            projects: [fallback]
        };
        projectCache = { value: config, loadedAt: Date.now() };
        return config;
    }
};

export const resolveProjectId = (raw?: string): string => {
    const config = loadProjectConfig();
    if (!raw) {
        return config.defaultProject;
    }
    const candidate = normalizeProjectId(raw);
    if (!candidate) {
        return config.defaultProject;
    }
    if (!config.projects.includes(candidate)) {
        throw new Error(`Unknown project '${raw}'`);
    }
    return candidate;
};

export const collectionName = (projectId: string, baseName: string): string => `${projectId}__${baseName}`;
