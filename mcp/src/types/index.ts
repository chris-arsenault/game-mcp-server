export interface ArchitectureDecisionInput {
    decision: string;
    rationale: string;
    alternatives?: string[];
    scope?: string;
    date?: string;
    tags?: string[];
}

export interface ArchitectureDecisionRecord extends ArchitectureDecisionInput {
    id: string;
    created_at: string;
    status?: string;
    author?: string;
    notes?: string;
    score?: number;
}

export interface ValidationMatch {
    name: string;
    description: string;
    score: number;
    source: string;
    metadata?: Record<string, unknown>;
}

export interface ValidationSummary {
    matches: ValidationMatch[];
    recommendations: string[];
    gaps: string[];
}

export type NarrativeElementType =
    | "act"
    | "quest"
    | "character"
    | "beat"
    | "faction"
    | "lore"
    | "theme"
    | "mechanic";

export interface NarrativeElementInput {
    title: string;
    type: NarrativeElementType;
    summary: string;
    details?: string;
    act?: string;
    chapter?: string;
    tags?: string[];
    related_ids?: string[];
    order?: number;
    author?: string;
    status?: string;
}

export interface NarrativeElementRecord extends NarrativeElementInput {
    id: string;
    created_at: string;
    updated_at: string;
    attachments?: string[];
    score?: number;
}

export interface LoreEntryInput {
    title: string;
    category: string;
    content: string;
    region?: string;
    era?: string;
    factions?: string[];
    tags?: string[];
    related_ids?: string[];
}

export interface LoreEntryRecord extends LoreEntryInput {
    id: string;
    created_at: string;
    updated_at: string;
    attachments?: string[];
    score?: number;
}

export interface DialogueSceneInput {
    scene: string;
    characters: string[];
    context: string;
    script: string;
    branching?: Record<string, string>;
    tags?: string[];
    tone?: string;
}

export interface DialogueSceneRecord extends DialogueSceneInput {
    id: string;
    created_at: string;
    updated_at: string;
    score?: number;
}

export interface TestStrategyInput {
    title: string;
    focus_area: string;
    scenario: string;
    coverage: string[];
    automated?: boolean;
    status?: string;
    tags?: string[];
}

export interface GameplayFeedbackInput {
    source: string;
    experience: string;
    positives: string[];
    negatives: string[];
    suggestions?: string[];
    build?: string;
    tags?: string[];
    severity?: "low" | "medium" | "high" | "critical";
}
