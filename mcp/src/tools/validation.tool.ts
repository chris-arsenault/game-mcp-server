import { QdrantService } from "../services/qdrant.service.js";
import { EmbeddingService } from "../services/embedding.service.js";
import { CacheService } from "../services/cache.service.js";
import { ProjectService } from "../services/project.service.js";
import { ValidationSummary, ValidationMatch } from "../types/index.js";

type ValidateArgs = {
    content: string;
    type: string;
    category?: string;
    limit?: number;
    min_score?: number;
};

type ConsistencyArgs = {
    description: string;
    category?: string;
    limit?: number;
};

export class ValidationTool {
    private patternCollection = "code_implementations";
    private architectureCollection = "architectural_patterns";

    constructor(
        private qdrant: QdrantService,
        private embedding: EmbeddingService,
        private cache: CacheService,
        private projects: ProjectService
    ) {}

    async validatePatterns(projectId: string, args: ValidateArgs): Promise<ValidationSummary> {
        const {
            content,
            type,
            category,
            limit = 5,
            min_score = 0.6,
        } = args;

        const vector = await this.embedWithCache(content);

        const filter = category
            ? {
                must: [
                    {
                        key: "category",
                        match: { value: category },
                    },
                ],
            }
            : undefined;

        const points: any[] = await this.qdrant.search(
            this.getPatternCollection(projectId),
            vector,
            limit,
            filter,
            min_score
        );

        const matches = points.map(point =>
            this.toMatch(point, "pattern")
        );

        const recommendations = this.buildRecommendations(matches, type);
        const gaps = matches.length === 0
            ? [`No stored patterns found for ${type}. Consider capturing this implementation once finalized.`]
            : matches
                .filter(match => match.score < 0.7)
                .map(match => `Similarity with '${match.name}' is moderate (${this.formatScore(match.score)}). Review implementation details before reuse.`);

        return {
            matches,
            recommendations,
            gaps,
        };
    }

    async checkConsistency(projectId: string, args: ConsistencyArgs): Promise<ValidationSummary> {
        const {
            description,
            category,
            limit = 5,
        } = args;

        const vector = await this.embedWithCache(description);

        const filter = category
            ? {
                must: [
                    {
                        key: "category",
                        match: { value: category },
                    },
                ],
            }
            : undefined;

        const architecturePoints: any[] = await this.qdrant.search(
            this.getArchitectureCollection(projectId),
            vector,
            limit,
            filter,
            0.55
        );

        const patternPoints: any[] = await this.qdrant.search(
            this.getPatternCollection(projectId),
            vector,
            Math.max(3, Math.floor(limit / 2)),
            filter,
            0.55
        );

        const matches: ValidationMatch[] = [
            ...architecturePoints.map(point =>
                this.toMatch(point, "architecture")
            ),
            ...patternPoints.map(point =>
                this.toMatch(point, "pattern")
            ),
        ].sort((a, b) => b.score - a.score);

        const recommendations = this.buildConsistencyRecommendations(matches, description);
        const gaps = matches.length === 0
            ? ["No related architectural guidance detected. Document decisions after alignment with the broader architecture."]
            : [];

        return {
            matches,
            recommendations,
            gaps,
        };
    }

    private async embedWithCache(text: string) {
        const key = `embedding:${text}`;
        const cached = this.cache.get<number[]>(key);
        if (cached) {
            return cached;
        }

        const vector = await this.embedding.embed(text);
        this.cache.set(key, vector, 60 * 60 * 1000);
        return vector;
    }

    private toMatch(point: any, source: string): ValidationMatch {
        const payload = point.payload ?? {};
        return {
            name: payload.name ?? payload.decision ?? "unknown",
            description: payload.description ?? payload.rationale ?? "",
            score: point.score ?? 0,
            source,
            metadata: {
                scope: payload.scope,
                tags: payload.tags,
                created_at: payload.created_at,
                usage: payload.usage,
            },
        };
    }

    private buildRecommendations(matches: ValidationMatch[], type: string) {
        if (matches.length === 0) {
            return [
                `No direct matches found for ${type}. Validate with senior engineers before adoption.`,
            ];
        }

        const top = matches[0];
        return [
            `Review '${top.name}' (${this.formatScore(top.score)}) as the closest stored pattern for this ${type}.`,
            "If the implementation diverges, consider documenting a new pattern or updating the existing one.",
        ];
    }

    private buildConsistencyRecommendations(matches: ValidationMatch[], description: string) {
        if (matches.length === 0) {
            return [
                `Proceed with caution: no architectural references match "${description}".`,
            ];
        }

        const recommendations = [
            `Top related item '${matches[0].name}' (${matches[0].source}) scores ${this.formatScore(matches[0].score)}.`,
        ];

        const architectureMatches = matches.filter(match => match.source === "architecture");
        if (architectureMatches.length > 0) {
            recommendations.push(
                `Align with architectural guidance from '${architectureMatches[0].name}' before finalizing.`,
            );
        }

        if (matches.length > 3) {
            recommendations.push("Multiple similar references found; consolidate or deduplicate related knowledge after review.");
        }

        return recommendations;
    }

    private getPatternCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.patternCollection);
    }

    private getArchitectureCollection(projectId: string) {
        return this.projects.collectionName(projectId, this.architectureCollection);
    }

    private formatScore(score: number) {
        return `${Math.round(score * 100)}%`;
    }
}
