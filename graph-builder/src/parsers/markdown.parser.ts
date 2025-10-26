import { readFile } from 'fs/promises';
import matter from 'gray-matter';
import { marked } from 'marked';
import { ParsedEntity, ParsedRelationship } from '../types/index.js';
import { logger } from '../utils/logger.js';
import path from 'path';

export class MarkdownParser {
    async parseFile(filePath: string, repoPath: string): Promise<{
        entities: ParsedEntity[];
        relationships: ParsedRelationship[];
    }> {
        const entities: ParsedEntity[] = [];
        const relationships: ParsedRelationship[] = [];

        try {
            const content = await readFile(path.join(repoPath, filePath), 'utf-8');
            const { data: frontmatter, content: markdown } = matter(content);

            // Document entity
            const docId = `doc:${filePath}`;
            const docEntity: ParsedEntity = {
                id: docId,
                type: 'document',
                name: path.basename(filePath, '.md'),
                path: filePath,
                content: markdown.substring(0, 2000),
                metadata: {
                    frontmatter,
                    wordCount: markdown.split(/\s+/).length
                }
            };
            entities.push(docEntity);

            // Extract links to code files
            const codeLinks = markdown.match(/`([^`]+\.(js|ts|jsx|tsx))`/g) || [];
            for (const link of codeLinks) {
                const file = link.replace(/`/g, '');
                relationships.push({
                    id: `${docId}-documents-${file}`,
                    type: 'DOCUMENTS',
                    source: docId,
                    target: `file:${file}`,
                    properties: {}
                });
            }

            // Extract markdown links
            const mdLinks = markdown.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
            for (const link of mdLinks) {
                const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
                if (match && match[2].endsWith('.md')) {
                    relationships.push({
                        id: `${docId}-links-${match[2]}`,
                        type: 'LINKS_TO',
                        source: docId,
                        target: `doc:${match[2]}`,
                        properties: { text: match[1] }
                    });
                }
            }

            // Parse frontmatter relationships
            if (frontmatter.relates_to) {
                const relatedItems = Array.isArray(frontmatter.relates_to)
                    ? frontmatter.relates_to
                    : [frontmatter.relates_to];

                for (const item of relatedItems) {
                    relationships.push({
                        id: `${docId}-relates-${item}`,
                        type: 'RELATES_TO',
                        source: docId,
                        target: item,
                        properties: {}
                    });
                }
            }

            if (frontmatter.documents) {
                const documentedItems = Array.isArray(frontmatter.documents)
                    ? frontmatter.documents
                    : [frontmatter.documents];

                for (const item of documentedItems) {
                    relationships.push({
                        id: `${docId}-documents-${item}`,
                        type: 'DOCUMENTS',
                        source: docId,
                        target: item,
                        properties: {}
                    });
                }
            }

            logger.debug(`Parsed ${filePath}: ${entities.length} entities, ${relationships.length} relationships`);
            return { entities, relationships };

        } catch (error) {
            logger.error(`Error parsing ${filePath}:`, error);
            return { entities, relationships };
        }
    }
}