import OpenAI from 'openai';
import { ParsedEntity, EnrichedEntity } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import axios from 'axios';

export class CodeEnricher {
    private openai?: OpenAI;
    private embeddingUrl: string;
    private model: string;

    constructor() {
        if (!config.openai.apiKey) {
            logger.warn(
                'OPENAI_API_KEY is not set; semantic enrichment will return empty metadata.'
            );
        } else {
            this.openai = new OpenAI({
                apiKey: config.openai.apiKey
            });
        }

        this.embeddingUrl = config.embedding.url;
        this.model = config.openai.model;
    }

    async enrichEntity(entity: ParsedEntity): Promise<EnrichedEntity> {
        // Skip enrichment for simple entities
        if (entity.type === 'file' && !entity.content) {
            return entity as EnrichedEntity;
        }

        try {
            // Generate embedding
            const embedding = await this.generateEmbedding(
                `${entity.name}\n${entity.content || ''}`
            );

            // For classes and functions, use LLM for semantic understanding
            if (['class', 'function', 'component', 'system'].includes(entity.type)) {
                const semantic = await this.getSemanticInfo(entity);

                return {
                    ...entity,
                    ...semantic,
                    embedding
                };
            }

            return {
                ...entity,
                embedding
            };

        } catch (error) {
            logger.error(`Error enriching entity ${entity.id}:`, error);
            return entity as EnrichedEntity;
        }
    }

    private async getSemanticInfo(entity: ParsedEntity): Promise<{
        semanticDescription?: string;
        purpose?: string;
        patterns?: string[];
        architecturalRole?: string;
        complexity?: number;
    }> {
        if (!this.openai) {
            return {};
        }

        const systemPrompt =
            'You are a knowledge-graph enrichment microservice. Return concise JSON summaries of code artifacts. Do not include prose, markdown, or explanations.';

        const userPrompt = `Analyze this ${entity.type} and return JSON only.

Name: ${entity.name}
Code (may be truncated):
\`\`\`typescript
${entity.content || 'No content'}
\`\`\`

Metadata: ${JSON.stringify(entity.metadata ?? {}, null, 2)}

Expected JSON schema:
{
  "semanticDescription": "string",
  "purpose": "string",
  "patterns": ["string", "..."],
  "architecturalRole": "string",
  "complexity": number (1-10)
}`;

        try {
            logger.info(`OpenAI enrichment request for ${entity.id}: ${userPrompt}`);
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_completion_tokens: 1000,
                response_format: { type: 'json_object' }
            });

            const rawContent = response.choices[0]?.message?.content;
            const text = this.normaliseContent(rawContent);
            logger.debug(`OpenAI raw response for ${entity.id}: ${text}`);

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                logger.warn(
                    `Semantic enrichment returned non-JSON payload for ${entity.id}`
                );
                return {};
            }

            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            logger.warn(`Failed to get semantic info for ${entity.id}:`, error);
            return {};
        }
    }

    private normaliseContent(
        content: string | Array<{ type: string; text?: string }> | null | undefined
    ): string {
        if (!content) {
            return "";
        }

        if (typeof content === "string") {
            return content;
        }

        const parts = content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }
                if (typeof part?.text === "string") {
                    return part.text;
                }
                return "";
            })
            .filter((segment) => segment.length > 0);

        return parts.join("");
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            const response = await axios.post(`${this.embeddingUrl}/embed`, {
                inputs: text.substring(0, 512) // Limit length
            });
            return response.data[0];
        } catch (error) {
            logger.error('Error generating embedding:', error);
            return [];
        }
    }

    async enrichBatch(entities: ParsedEntity[]): Promise<EnrichedEntity[]> {
        const enriched: EnrichedEntity[] = [];

        if (entities.length === 0) {
            return enriched;
        }

        const batchSize = 5;
        const total = entities.length;

        for (let i = 0; i < entities.length; i += batchSize) {
            const batch = entities.slice(i, i + batchSize);
            const results = await Promise.all(batch.map((e) => this.enrichEntity(e)));
            enriched.push(...results);

            const processed = Math.min(i + batchSize, total);
            logger.info(`Code enrichment progress: ${processed}/${total}`);

            if (processed < total) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        return enriched;
    }
}
