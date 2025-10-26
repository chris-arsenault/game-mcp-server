import { parse } from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import type { NodePath, TraverseOptions } from '@babel/traverse';
import * as t from '@babel/types';
import { readFile } from 'fs/promises';
import path from 'path';
import { ParsedEntity, ParsedRelationship } from '../types/index.js';
import { logger } from '../utils/logger.js';

type ImportSpecifierType =
    t.ImportSpecifier |
    t.ImportDefaultSpecifier |
    t.ImportNamespaceSpecifier;

export class JavaScriptParser {
    async parseFile(filePath: string, repoPath: string): Promise<{
        entities: ParsedEntity[];
        relationships: ParsedRelationship[];
    }> {
        const entities: ParsedEntity[] = [];
        const relationships: ParsedRelationship[] = [];

        try {
            const content = await readFile(path.join(repoPath, filePath), 'utf-8');
            const relativePath = filePath;

            // File entity
            const fileEntity: ParsedEntity = {
                id: `file:${relativePath}`,
                type: 'file',
                name: path.basename(filePath),
                path: relativePath,
                content: content.substring(0, 1000), // First 1000 chars for context
                metadata: {
                    extension: path.extname(filePath),
                    size: content.length
                }
            };
            entities.push(fileEntity);

            const ast = parse(content, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript']
            });

            type TraverseFunction = (node: t.Node, opts?: TraverseOptions) => void;
            const traverseFn: TraverseFunction =
                ((babelTraverse as unknown as { default?: TraverseFunction }).default) ??
                (babelTraverse as unknown as TraverseFunction);

            const visitor: TraverseOptions = {
                ImportDeclaration: (astPath: NodePath<t.ImportDeclaration>) => {
                    const source = astPath.node.source.value;
                    relationships.push({
                        id: `${fileEntity.id}-imports-${source}`,
                        type: 'IMPORTS',
                        source: fileEntity.id,
                        target: `module:${source}`,
                        properties: {
                            specifiers: astPath.node.specifiers.map((specifier: ImportSpecifierType) => {
                                if (t.isImportDefaultSpecifier(specifier)) {
                                    return 'default';
                                }
                                if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
                                    return specifier.imported.name;
                                }
                                return 'namespace';
                            })
                        }
                    });
                },

                ClassDeclaration: (astPath: NodePath<t.ClassDeclaration>) => {
                    if (!t.isIdentifier(astPath.node.id)) return;

                    const className = astPath.node.id.name;
                    const classId = `class:${relativePath}:${className}`;

                    const methods = astPath.node.body.body
                        .filter((member): member is t.ClassMethod => t.isClassMethod(member))
                        .map((member) =>
                            t.isIdentifier(member.key) ? member.key.name : 'unknown'
                        );

                    const properties = astPath.node.body.body
                        .filter((member): member is t.ClassProperty => t.isClassProperty(member))
                        .map((member) =>
                            t.isIdentifier(member.key) ? member.key.name : 'unknown'
                        );

                    const classEntity: ParsedEntity = {
                        id: classId,
                        type: 'class',
                        name: className,
                        path: relativePath,
                        metadata: {
                            methods,
                            properties
                        },
                        sourceLocation: {
                            file: relativePath,
                            line: astPath.node.loc?.start.line || 0,
                            column: astPath.node.loc?.start.column || 0
                        }
                    };
                    entities.push(classEntity);

                    relationships.push({
                        id: `${fileEntity.id}-defines-${classId}`,
                        type: 'DEFINES',
                        source: fileEntity.id,
                        target: classId,
                        properties: {}
                    });

                    if (astPath.node.superClass && t.isIdentifier(astPath.node.superClass)) {
                        relationships.push({
                            id: `${classId}-extends-${astPath.node.superClass.name}`,
                            type: 'EXTENDS',
                            source: classId,
                            target: `class:${astPath.node.superClass.name}`,
                            properties: {}
                        });
                    }
                },

                FunctionDeclaration: (astPath: NodePath<t.FunctionDeclaration>) => {
                    if (!t.isIdentifier(astPath.node.id)) return;

                    const funcName = astPath.node.id.name;
                    const funcId = `function:${relativePath}:${funcName}`;

                    const params = astPath.node.params.map((param) =>
                        t.isIdentifier(param) ? param.name : 'unknown'
                    );

                    const funcEntity: ParsedEntity = {
                        id: funcId,
                        type: 'function',
                        name: funcName,
                        path: relativePath,
                        metadata: {
                            params,
                            async: astPath.node.async
                        },
                        sourceLocation: {
                            file: relativePath,
                            line: astPath.node.loc?.start.line || 0,
                            column: astPath.node.loc?.start.column || 0
                        }
                    };
                    entities.push(funcEntity);

                    relationships.push({
                        id: `${fileEntity.id}-defines-${funcId}`,
                        type: 'DEFINES',
                        source: fileEntity.id,
                        target: funcId,
                        properties: {}
                    });
                },

                CallExpression: (astPath: NodePath<t.CallExpression>) => {
                    if (
                        t.isMemberExpression(astPath.node.callee) &&
                        t.isIdentifier(astPath.node.callee.property)
                    ) {
                        const methodName = astPath.node.callee.property.name;

                        if (methodName === 'on' && astPath.node.arguments[0]) {
                            const arg = astPath.node.arguments[0];
                            if (t.isStringLiteral(arg)) {
                                const eventName = arg.value;
                                relationships.push({
                                    id: `${fileEntity.id}-subscribes-${eventName}`,
                                    type: 'SUBSCRIBES_TO',
                                    source: fileEntity.id,
                                    target: `event:${eventName}`,
                                    properties: {}
                                });
                            }
                        }

                        if (methodName === 'emit' && astPath.node.arguments[0]) {
                            const arg = astPath.node.arguments[0];
                            if (t.isStringLiteral(arg)) {
                                const eventName = arg.value;
                                relationships.push({
                                    id: `${fileEntity.id}-emits-${eventName}`,
                                    type: 'EMITS',
                                    source: fileEntity.id,
                                    target: `event:${eventName}`,
                                    properties: {}
                                });
                            }
                        }
                    }
                }
            };

            traverseFn(ast, visitor);

            const patternMatches = content.match(/\/\/ @implements ([\w-]+)/g);
            if (patternMatches) {
                for (const match of patternMatches) {
                    const patternName = match.replace('// @implements ', '');
                    relationships.push({
                        id: `${fileEntity.id}-implements-${patternName}`,
                        type: 'IMPLEMENTS_PATTERN',
                        source: fileEntity.id,
                        target: `pattern:${patternName}`,
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
