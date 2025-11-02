import neo4j, { Driver, Record as Neo4jRecord } from "neo4j-driver";

type RelationshipDirection = "outbound" | "inbound";

export interface GraphRelationship {
    type: string;
    direction: RelationshipDirection;
    sourceId: string;
    targetId: string;
    properties: Record<string, unknown>;
    node: GraphEntitySummary;
}

export interface GraphEntitySummary {
    id: string;
    labels: string[];
    type?: string;
    name?: string;
    path?: string;
    semanticDescription?: string;
    purpose?: string;
    architecturalRole?: string;
    complexity?: number;
    metadata?: Record<string, unknown>;
}

export class Neo4jService {
    private driver: Driver;

    constructor(url: string, user: string, password: string) {
        this.driver = neo4j.driver(url, neo4j.auth.basic(user, password), {
            disableLosslessIntegers: true
        });
    }

    async getEntity(projectId: string, id: string): Promise<GraphEntitySummary | null> {
        const session = this.driver.session();
        try {
            const result = await session.run(
                `
                MATCH (n:Entity {id: $id, project: $project})
                RETURN n LIMIT 1
                `,
                { id, project: projectId }
            );

            if (result.records.length === 0) {
                return null;
            }

            const node = result.records[0].get("n") as neo4j.Node;
            return this.mapNode(node);
        } finally {
            await session.close();
        }
    }

    async getEntityWithNeighbors(
        projectId: string,
        id: string,
        limit: number = 25
    ): Promise<{
        entity: GraphEntitySummary;
        relationships: GraphRelationship[];
    } | null> {
        const session = this.driver.session();
        try {
            const entity = await this.getEntity(projectId, id);
            if (!entity) {
                return null;
            }

            const relationships: GraphRelationship[] = [];

            const outboundResult = await session.run(
                `
                MATCH (source:Entity {id: $id, project: $project})-[rel]->(target:Entity {project: $project})
                RETURN source.id AS sourceId,
                       target.id AS targetId,
                       type(rel) AS type,
                       rel AS relationship,
                       target AS node
                LIMIT $limit
                `,
                { id, project: projectId, limit }
            );

            for (const record of outboundResult.records as Neo4jRecord[]) {
                const type = record.get("type") as string | undefined;
                const sourceId = record.get("sourceId") as string | undefined;
                const targetId = record.get("targetId") as string | undefined;
                const relationship = record.get("relationship") as neo4j.Relationship;
                const node = record.get("node") as neo4j.Node;

                if (!type || !sourceId || !targetId) {
                    continue;
                }

                relationships.push({
                    type,
                    direction: "outbound",
                    sourceId,
                    targetId,
                    properties: this.mapRelationshipProperties(relationship),
                    node: this.mapNode(node)
                });
            }

            const inboundResult = await session.run(
                `
                MATCH (source:Entity {project: $project})-[rel]->(target:Entity {id: $id, project: $project})
                RETURN source.id AS sourceId,
                       target.id AS targetId,
                       type(rel) AS type,
                       rel AS relationship,
                       source AS node
                LIMIT $limit
                `,
                { id, project: projectId, limit }
            );

            for (const record of inboundResult.records as Neo4jRecord[]) {
                const type = record.get("type") as string | undefined;
                const sourceId = record.get("sourceId") as string | undefined;
                const targetId = record.get("targetId") as string | undefined;
                const relationship = record.get("relationship") as neo4j.Relationship;
                const node = record.get("node") as neo4j.Node;

                if (!type || !sourceId || !targetId) {
                    continue;
                }

                relationships.push({
                    type,
                    direction: "inbound",
                    sourceId,
                    targetId,
                    properties: this.mapRelationshipProperties(relationship),
                    node: this.mapNode(node)
                });
            }

            return { entity, relationships };
        } finally {
            await session.close();
        }
    }

    async findEntitiesByType(
        projectId: string,
        type: string,
        limit: number = 20
    ): Promise<GraphEntitySummary[]> {
        const session = this.driver.session();
        try {
            const result = await session.run(
                `
                MATCH (n:Entity {type: $type, project: $project})
                RETURN n
                ORDER BY n.updatedAt DESC
                LIMIT $limit
                `,
                { project: projectId, type, limit }
            );

            return result.records.map((record: Neo4jRecord) =>
                this.mapNode(record.get("n") as neo4j.Node)
            );
        } finally {
            await session.close();
        }
    }

    async close(): Promise<void> {
        await this.driver.close();
    }

    private mapNode(node: neo4j.Node): GraphEntitySummary {
        const properties = node.properties ?? {};
        const type =
            typeof properties.type === "string" ? properties.type : undefined;

        return {
            id: properties.id as string,
            labels: node.labels,
            type,
            name: typeof properties.name === "string" ? properties.name : undefined,
            path: typeof properties.path === "string" ? properties.path : undefined,
            semanticDescription:
                typeof properties.semanticDescription === "string"
                    ? properties.semanticDescription
                    : undefined,
            purpose:
                typeof properties.purpose === "string" ? properties.purpose : undefined,
            architecturalRole:
                typeof properties.architecturalRole === "string"
                    ? properties.architecturalRole
                    : undefined,
            complexity:
                typeof properties.complexity === "number"
                    ? properties.complexity
                    : undefined,
            metadata:
                typeof properties.metadata === "string"
                    ? this.safeParseJSON(properties.metadata)
                    : (properties.metadata as Record<string, unknown> | undefined)
        };
    }

    private mapRelationshipProperties(
        relationship: neo4j.Relationship
    ): Record<string, unknown> {
        return {
            ...relationship.properties
        };
    }

    private safeParseJSON<T = Record<string, unknown>>(
        text: string | undefined
    ): T | undefined {
        if (!text) {
            return undefined;
        }

        try {
            return JSON.parse(text) as T;
        } catch {
            return undefined;
        }
    }
}
