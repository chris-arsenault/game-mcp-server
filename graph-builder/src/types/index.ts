export interface BuildConfig {
    repoPath: string;
    stagingPath: string;
    mode: 'incremental' | 'full';
    projectId: string;
    baseCommit?: string;
}

export interface ParsedEntity {
    id: string;
    type: 'file' | 'class' | 'function' | 'component' | 'system' | 'document' | 'pattern' | 'decision' | 'asset';
    name: string;
    path: string;
    content?: string;
    metadata: Record<string, any>;
    sourceLocation?: {
        file: string;
        line: number;
        column: number;
    };
}

export interface ParsedRelationship {
    id: string;
    type: string;
    source: string;  // Entity ID
    target: string;  // Entity ID
    properties: Record<string, any>;
}

export interface EnrichedEntity extends ParsedEntity {
    semanticDescription?: string;
    purpose?: string;
    patterns?: string[];
    architecturalRole?: string;
    complexity?: number;
    embedding?: number[];
}

export interface ParseOutput {
    entities: ParsedEntity[];
    relationships: ParsedRelationship[];
    metadata: {
        timestamp: string;
        commit: string;
        filesProcessed: number;
    };
}

export interface EnrichOutput {
    entities: EnrichedEntity[];
    relationships: ParsedRelationship[];
    metadata: {
        timestamp: string;
        entitiesEnriched: number;
    };
}

export interface GitChange {
    file: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    oldPath?: string;
}

export type BuildStage = 'parse' | 'enrich' | 'populate' | 'all';

export interface BuildRequest {
    mode: 'incremental' | 'full';
    stage?: BuildStage;
    baseCommit?: string;
    repoUrl?: string;
    branch?: string;
    project?: string;
}

export interface BuildStageSummary {
    stage: 'parse' | 'enrich' | 'populate';
    durationMs: number;
    entitiesProcessed: number;
    relationshipsProcessed: number;
    metadata?: Record<string, unknown>;
}

export interface BuildRunSummary {
    request: BuildRequest;
    startedAt: string;
    finishedAt: string;
    success: boolean;
    stages: BuildStageSummary[];
    error?: string;
}

export interface BuildStatus {
    running: boolean;
    current?: {
        request: BuildRequest;
        startedAt: string;
    };
    lastRun?: BuildRunSummary;
}
