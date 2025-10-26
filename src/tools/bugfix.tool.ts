import { randomUUID } from "crypto";

import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";

type RecordBugFixArgs = {
    issue: string;
    summary: string;
    correct_pattern: string;
    incorrect_patterns: string[];
    error_messages?: string[];
    tags?: string[];
    source?: string;
};

type MatchBugFixArgs = {
    query: string;
    errorMessage?: string;
    limit?: number;
    minScore?: number;
    tag?: string;
};

type GetBugFixArgs = {
    issue: string;
};

type BugFixMatch = {
    issue?: string;
    summary?: string;
    correct_pattern?: string;
    incorrect_patterns: string[];
    error_messages: string[];
    tags: string[];
    score: number;
    match_reason: "error_message" | "semantic";
};

const asString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

export class BugFixTool {
    private collection = "bug_fix_patterns";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService
    ) {}

    async recordBugFix(args: RecordBugFixArgs) {
        const {
            issue,
            summary,
            correct_pattern,
            incorrect_patterns,
            error_messages = [],
            tags = [],
            source = ""
        } = args;

        if (!incorrect_patterns || incorrect_patterns.length === 0) {
            throw new Error("At least one incorrect pattern must be provided");
        }

        const normalizedErrors = error_messages
            .map((msg) => msg.trim())
            .filter((msg) => msg.length > 0);
        const normalizedLookup = normalizedErrors.map((msg) => msg.toLowerCase());

        const searchCorpus = [
            issue,
            summary,
            correct_pattern,
            ...incorrect_patterns,
            ...normalizedErrors
        ].join("\n\n");
        const vector = await this.embedding.embed(searchCorpus);
        const id = randomUUID();

        await this.qdrant.upsert(this.collection, [
            {
                id,
                vector,
                payload: {
                    issue,
                    summary,
                    correct_pattern,
                    incorrect_patterns,
                    error_messages: normalizedErrors,
                    error_messages_normalized: normalizedLookup,
                    tags,
                    source,
                    created_at: new Date().toISOString()
                }
            }
        ]);

        return {
            success: true,
            id,
            issue,
            message: `Bug fix '${issue}' recorded successfully`
        };
    }

    async matchBugFix(args: MatchBugFixArgs) {
        const {
            query,
            errorMessage,
            limit = 5,
            minScore = 0.6,
            tag
        } = args;
        const matches: BugFixMatch[] = [];
        const seen = new Set<string>();

        if (errorMessage) {
            const normalized = errorMessage.trim();
            if (normalized.length > 0) {
                const errorFilter: Record<string, unknown> = {
                    must: [
                        {
                            key: "error_messages_normalized",
                            match: { value: normalized.toLowerCase() }
                        }
                    ]
                };

                if (tag) {
                    (errorFilter as any).should = [
                        {
                            key: "tags",
                            match: {
                                any: [tag]
                            }
                        }
                    ];
                }

                const errorMatches = await this.qdrant.scroll(
                    this.collection,
                    errorFilter,
                    limit
                );

                for (const point of errorMatches.points) {
                    const payload = (point.payload ?? {}) as Record<string, unknown>;
                    const id = point.id?.toString() ?? "";
                    if (!id || seen.has(id)) {
                        continue;
                    }
                    seen.add(id);
                    matches.push({
                        issue: asString(payload.issue),
                        summary: asString(payload.summary),
                        correct_pattern: asString(payload.correct_pattern),
                        incorrect_patterns: asStringArray(payload.incorrect_patterns),
                        error_messages: asStringArray(payload.error_messages),
                        tags: asStringArray(payload.tags),
                        score: 1,
                        match_reason: "error_message"
                    });
                    if (matches.length >= limit) {
                        return { matches };
                    }
                }
            }
        }

        const vector = await this.embedding.embed(
            [query, errorMessage?.trim() ?? ""].filter(Boolean).join("\n\n")
        );

        const filter = tag
            ? {
                must: [
                    {
                        key: "tags",
                        match: {
                            any: [tag]
                        }
                    }
                ]
            }
            : undefined;

        const results = await this.qdrant.search(
            this.collection,
            vector,
            limit,
            filter,
            minScore
        );

        for (const result of results) {
            const payload = (result.payload ?? {}) as Record<string, unknown>;
            const id = (result.id as string | number | undefined)?.toString() ?? "";
            if (id && seen.has(id)) {
                continue;
            }
            if (id) {
                seen.add(id);
            }
            matches.push({
                issue: asString(payload.issue),
                summary: asString(payload.summary),
                correct_pattern: asString(payload.correct_pattern),
                incorrect_patterns: asStringArray(payload.incorrect_patterns),
                error_messages: asStringArray(payload.error_messages),
                tags: asStringArray(payload.tags),
                score: typeof result.score === "number" ? result.score : 0,
                match_reason: "semantic"
            });
            if (matches.length >= limit) {
                break;
            }
        }

        return { matches };
    }

    async getBugFix(args: GetBugFixArgs) {
        const { issue } = args;
        const results = await this.qdrant.scroll(this.collection, {
            must: [
                {
                    key: "issue",
                    match: { value: issue }
                }
            ]
        });

        if (results.points.length === 0) {
            return {
                found: false,
                message: `Bug fix '${issue}' not found`
            };
        }

        const payload = results.points[0]?.payload;
        if (!payload) {
            return {
                found: false,
                message: `Bug fix '${issue}' not found`
            };
        }

        const record = payload as Record<string, unknown>;

        return {
            found: true,
            bug_fix: {
                issue: asString(record.issue),
                summary: asString(record.summary),
                correct_pattern: asString(record.correct_pattern),
                incorrect_patterns: asStringArray(record.incorrect_patterns),
                error_messages: asStringArray(record.error_messages),
                tags: asStringArray(record.tags),
                source: asString(record.source),
                created_at: asString(record.created_at)
            }
        };
    }
}
