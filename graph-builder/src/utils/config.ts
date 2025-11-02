import dotenv from 'dotenv';
import { BuildConfig } from '../types/index.js';

dotenv.config();

export const config = {
    repoPath: process.env.REPO_PATH || '/repo',
    stagingPath: process.env.STAGING_PATH || '/staging',
    server: {
        port: Number(process.env.GRAPH_BUILDER_PORT || 4100)
    },
    neo4j: {
        url: process.env.NEO4J_URL || 'bolt://localhost:7687',
        user: process.env.NEO4J_USER || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'password'
    },
    qdrant: {
        url: process.env.QDRANT_URL || 'http://localhost:6333'
    },
    embedding: {
        url: process.env.EMBEDDING_URL || 'http://localhost:80'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-5'
    },
    repository: {
        url: process.env.REPO_URL || 'https://github.com/chris-arsenault/genai-game-engine.git',
        branch: process.env.REPO_BRANCH || 'main'
    }
};

export function getBuildConfig(mode: 'incremental' | 'full', projectId: string, baseCommit?: string): BuildConfig {
    return {
        repoPath: config.repoPath,
        stagingPath: config.stagingPath,
        mode,
        projectId,
        baseCommit
    };
}
