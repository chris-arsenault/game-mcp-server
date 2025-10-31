import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import axios from "axios";

import { QdrantService } from "./services/qdrant.service.js";
import { EmbeddingService } from "./services/embedding.service.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

const PORT = Number(process.env.PORT ?? 4005);
const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const EMBEDDING_URL = process.env.EMBEDDING_URL ?? "http://localhost:8080";
const BACKLOG_COLLECTION = process.env.BACKLOG_COLLECTION ?? "backlog_items";
const HANDOFF_COLLECTION = process.env.HANDOFF_COLLECTION ?? "handoff_notes";
const HANDOFF_ID =
  process.env.HANDOFF_ID ?? "11111111-1111-1111-1111-111111111111";
const GRAPH_COLLECTION = process.env.GRAPH_COLLECTION ?? "code_graph";
const NEO4J_HTTP_URL = process.env.NEO4J_HTTP_URL ?? "http://localhost:7474";
const NEO4J_DATABASE = process.env.NEO4J_DATABASE ?? "neo4j";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "password";
const NEO4J_ENDPOINT = `${NEO4J_HTTP_URL.replace(/\/$/, "")}/db/${NEO4J_DATABASE}/tx/commit`;
const NEO4J_AUTH_HEADER = "Basic " + Buffer.from(`${NEO4J_USER}:${NEO4J_PASSWORD}`).toString("base64");
const GRAPH_MAX_DEPTH = Math.max(1, Number(process.env.GRAPH_MAX_DEPTH ?? 3));

const qdrant = new QdrantService(QDRANT_URL);
const embedding = new EmbeddingService(EMBEDDING_URL);

type BacklogItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  next_steps: string[];
  completed_work: string[];
  tags: string[];
  owner: string | null;
  due_date: string | null;
  sprint: string | null;
  story_points: number | null;
  acceptance_criteria: string[];
  dependencies: string[];
  notes: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
};

type HandoffResult = {
  content: string;
  updated_by: string | null;
  updated_at: string | null;
};

type GraphNode = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
};

type GraphRelationship = {
  id: string;
  type: string;
  start: string;
  end: string;
  properties: Record<string, unknown>;
};

type GraphEntityPayload = {
  center: GraphNode | null;
  nodes: GraphNode[];
  relationships: GraphRelationship[];
};

type GraphSearchResult = {
  id: string;
  title: string;
  score: number;
  labels: string[];
  properties: Record<string, unknown>;
};

app.get("/api/handoff", async (_req, res) => {
  try {
    const response = await qdrant.retrieve(HANDOFF_COLLECTION, [HANDOFF_ID]);
    const point = response?.[0];
    const payload = point?.payload ?? {};
    const data: HandoffResult = {
      content: (payload.content as string) ?? "",
      updated_by: (payload.updated_by as string) ?? null,
      updated_at: (payload.updated_at as string) ?? null
    };
    res.json({ data });
  } catch (error) {
    console.error("Failed to fetch handoff:", error);
    res.status(500).json({ error: "Failed to fetch handoff notes" });
  }
});

app.put("/api/handoff", async (req, res) => {
  try {
    const { content, updated_by } = req.body as {
      content: string;
      updated_by?: string;
    };

    const trimmed = (content ?? "").trim();
    const vector = await embedding.embed(trimmed || "handoff");
    const now = new Date().toISOString();

    await qdrant.upsert(HANDOFF_COLLECTION, [
      {
        id: HANDOFF_ID,
        vector,
        payload: {
          content: trimmed,
          updated_by: updated_by ?? null,
          updated_at: now
        }
      }
    ]);

    res.json({
      data: {
        content: trimmed,
        updated_by: updated_by ?? null,
        updated_at: now
      }
    });
  } catch (error) {
    console.error("Failed to store handoff:", error);
    res.status(500).json({ error: "Failed to store handoff notes" });
  }
});

app.get("/api/backlog", async (_req, res) => {
  try {
    const response = await qdrant.scroll(BACKLOG_COLLECTION, undefined, 200);
    const items = mapPoints(response.points ?? []);
    res.json({ data: items });
  } catch (error) {
    console.error("Failed to fetch backlog:", error);
    res.status(500).json({ error: "Failed to fetch backlog" });
  }
});

app.get("/api/backlog/top", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 5), 1), 20);
    const includeCompleted = req.query.includeCompleted === "true";

    const filter = includeCompleted
      ? undefined
      : {
          must_not: [
            {
              key: "status",
              match: { any: ["done", "completed", "archived"] }
            }
          ]
        };

    const response = await qdrant.scroll(
      BACKLOG_COLLECTION,
      filter,
      limit * 5
    );

    const items = mapPoints(response.points ?? [])
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .slice(0, limit);

    res.json({ data: items });
  } catch (error) {
    console.error("Failed to fetch top backlog items:", error);
    res.status(500).json({ error: "Failed to fetch top backlog items" });
  }
});

app.post("/api/backlog", async (req, res) => {
  try {
    const {
      title,
      description,
      status = "todo",
      priority = "P2"
    } = req.body as Partial<BacklogItem>;

    if (!title || !description) {
      return res
        .status(400)
        .json({ error: "title and description are required" });
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const payload = {
      title,
      description,
      status,
      priority,
      next_steps: [],
      completed_work: [],
      tags: [],
      owner: null,
      due_date: null,
      sprint: null,
      story_points: null,
      acceptance_criteria: [],
      dependencies: [],
      notes: null,
      category: null,
      created_at: now,
      updated_at: now
    };

    const vector = await embedBacklog(payload);

    await qdrant.upsert(BACKLOG_COLLECTION, [
      {
        id,
        vector,
        payload
      }
    ]);

    res.status(201).json({
      data: {
        id,
        ...payload
      }
    });
  } catch (error) {
    console.error("Failed to create backlog item:", error);
    res.status(500).json({ error: "Failed to create backlog item" });
  }
});

app.put("/api/backlog/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body as Partial<BacklogItem>;

    const existing = await fetchBacklogById(id);
    if (!existing) {
      return res.status(404).json({ error: "Backlog item not found" });
    }

    const now = new Date().toISOString();
    const merged = {
      ...existing,
      ...cleanUpdates(updates),
      updated_at: now
    };

    const shouldReembed =
      updates.description !== undefined || updates.title !== undefined;
    const vector = shouldReembed
      ? await embedBacklog(merged)
      : await embedBacklog(existing);

    await qdrant.upsert(BACKLOG_COLLECTION, [
      {
        id,
        vector,
        payload: merged
      }
    ]);

    res.json({ data: merged });
  } catch (error) {
    console.error("Failed to update backlog item:", error);
    res.status(500).json({ error: "Failed to update backlog item" });
  }
});

app.get("/api/graph/search", async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const limitParam = Number(req.query.limit ?? 12);
  const limit = Math.min(Math.max(isNaN(limitParam) ? 12 : limitParam, 1), 25);

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    const vector = await embedding.embed(query);
    const results = await qdrant.search(GRAPH_COLLECTION, vector, limit, undefined, undefined);
    const mapped = (results ?? []).map(mapGraphSearchResult);
    res.json({ data: mapped });
  } catch (error) {
    console.error("Failed to search graph collection:", error);
    res.status(500).json({ error: "Failed to search graph data" });
  }
});

app.get("/api/graph/entity", async (req, res) => {
  const identifier = typeof req.query.id === "string" ? req.query.id.trim() : "";
  const depthParam = Number(req.query.depth ?? 1);
  const depth = Math.min(Math.max(isNaN(depthParam) ? 1 : depthParam, 1), GRAPH_MAX_DEPTH);

  if (!identifier) {
    return res.status(400).json({ error: "id is required" });
  }

  const statement = `
    MATCH (center)
    WHERE center.id = $id OR elementId(center) = $id OR toString(id(center)) = $id
    WITH center
    OPTIONAL MATCH path = (center)-[rels*1..${depth}]-(neighbor)
    UNWIND CASE WHEN rels IS NULL THEN [NULL] ELSE rels END AS rel
    WITH center, neighbor, rel
    RETURN center,
           collect(DISTINCT neighbor) AS neighbors,
           collect(DISTINCT rel) AS relationships
  `;

  try {
    const rows = await runCypher(statement, { id: identifier });
    if (rows.length === 0) {
      return res.status(404).json({ error: "Graph entity not found" });
    }

    const row = rows[0]?.row ?? [];
    const centerRaw = row[0] ?? null;
    const neighborsRaw = Array.isArray(row[1]) ? row[1] : [];
    const relationshipsRaw = Array.isArray(row[2]) ? row[2] : [];

    const center = centerRaw ? mapGraphNode(centerRaw) : null;
    if (!center) {
      return res.status(404).json({ error: "Graph entity not found" });
    }
    const nodeMap = new Map<string, GraphNode>();
    if (center) {
      nodeMap.set(center.id, center);
    }

    for (const neighbor of neighborsRaw) {
      const mapped = mapGraphNode(neighbor);
      if (mapped) {
        nodeMap.set(mapped.id, mapped);
      }
    }

    const relationships = relationshipsRaw
      .map(mapGraphRelationship)
      .filter((rel): rel is GraphRelationship => Boolean(rel) && nodeMap.has(rel!.start) && nodeMap.has(rel!.end));

    const nodes = Array.from(nodeMap.values());

    const payload: GraphEntityPayload = {
      center,
      nodes,
      relationships
    };

    res.json({ data: payload });
  } catch (error) {
    console.error("Failed to fetch graph entity:", error);
    res.status(500).json({ error: "Failed to fetch graph entity" });
  }
});

const distDir = path.resolve(process.cwd(), "dist/client");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(
    `Backlog editor listening on http://localhost:${PORT} (Qdrant: ${QDRANT_URL})`
  );
});

function mapPoints(points: any[]): BacklogItem[] {
  return points.map(point => mapPoint(point)).filter(Boolean) as BacklogItem[];
}

function mapPoint(point: any): BacklogItem | undefined {
  if (!point) return undefined;
  const payload = point.payload ?? {};
  const id = typeof point.id === "string" ? point.id : String(point.id);

  return {
    id,
    title: payload.title ?? "",
    description: payload.description ?? "",
    status: payload.status ?? "todo",
    priority: payload.priority ?? "P2",
    next_steps: payload.next_steps ?? [],
    completed_work: payload.completed_work ?? [],
    tags: payload.tags ?? [],
    owner: payload.owner ?? null,
    due_date: payload.due_date ?? null,
    sprint: payload.sprint ?? null,
    story_points: payload.story_points ?? null,
    acceptance_criteria: payload.acceptance_criteria ?? [],
    dependencies: payload.dependencies ?? [],
    notes: payload.notes ?? null,
    category: payload.category ?? null,
    created_at: payload.created_at ?? new Date().toISOString(),
    updated_at: payload.updated_at ?? new Date().toISOString()
  };
}

async function fetchBacklogById(id: string): Promise<BacklogItem | undefined> {
  const response = await qdrant.retrieve(BACKLOG_COLLECTION, [id]);
  return mapPoint(response?.[0]);
}

function cleanUpdates(updates: Partial<BacklogItem>) {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function priorityRank(priority: string) {
  const normalized = priority.trim().toLowerCase();
  if (normalized === "p0" || normalized === "critical" || normalized === "blocker") {
    return 0;
  }
  if (normalized === "p1" || normalized === "high") {
    return 1;
  }
  if (normalized === "p2" || normalized === "medium") {
    return 2;
  }
  if (normalized === "p3" || normalized === "low") {
    return 3;
  }
  return 4;
}

async function runCypher(statement: string, parameters: Record<string, unknown>) {
  const response = await axios.post(
    NEO4J_ENDPOINT,
    {
      statements: [
        {
          statement,
          parameters
        }
      ]
    },
    {
      headers: {
        Authorization: NEO4J_AUTH_HEADER,
        "Content-Type": "application/json"
      }
    }
  );

  const body = response.data as {
    results: Array<{ data: Array<{ row: any[] }> }>;
    errors: Array<{ message: string }>;
  };

  if (body.errors && body.errors.length > 0) {
    throw new Error(body.errors[0]?.message ?? "Neo4j query failed");
  }

  return body.results?.[0]?.data ?? [];
}

function mapGraphNode(node: any): GraphNode | null {
  if (!node) return null;
  const properties = node.properties ?? {};
  const labels = Array.isArray(node.labels) ? node.labels : [];
  const id =
    normalizeId(node.elementId) ??
    normalizeId(node.id) ??
    normalizeId(node.identity) ??
    (properties.id ? String(properties.id) : undefined);

  if (!id) {
    return null;
  }

  return {
    id,
    labels,
    properties
  };
}

function mapGraphRelationship(rel: any): GraphRelationship | null {
  if (!rel) return null;
  const id = normalizeId(rel.elementId) ?? normalizeId(rel.id) ?? randomUUID();
  const start = normalizeId(rel.start) ?? normalizeId(rel.startNode) ?? normalizeId(rel.startNodeElementId);
  const end = normalizeId(rel.end) ?? normalizeId(rel.endNode) ?? normalizeId(rel.endNodeElementId);
  if (!start || !end) {
    return null;
  }

  return {
    id,
    type: rel.type ?? "RELATED",
    start,
    end,
    properties: rel.properties ?? {}
  };
}

function mapGraphSearchResult(result: any): GraphSearchResult {
  const payload = result?.payload ?? {};
  const labelsRaw = payload.labels ?? payload.label ?? [];
  const labels = Array.isArray(labelsRaw)
    ? labelsRaw.map((label: unknown) => String(label))
    : [String(labelsRaw)].filter(Boolean);
  const id = normalizeId(result?.id) ?? normalizeId(payload.id) ?? randomUUID();
  const title = String(
    payload.name ?? payload.title ?? payload.display ?? payload.id ?? id
  );

  return {
    id,
    title,
    score: typeof result?.score === "number" ? result.score : 0,
    labels,
    properties: payload
  };
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "low" in value && typeof (value as any).low === "number") {
    return String((value as any).low);
  }
  return undefined;
}

async function embedBacklog(item: Pick<BacklogItem, "title" | "description" | "status" | "priority" | "next_steps" | "completed_work" | "acceptance_criteria" | "dependencies" | "notes" | "tags" | "owner" | "category" | "sprint">) {
  const text = [
    item.title,
    item.description,
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    item.next_steps.join("\n"),
    item.completed_work.join("\n"),
    item.acceptance_criteria.join("\n"),
    item.dependencies.join("\n"),
    item.notes ?? "",
    item.tags.join(", "),
    item.owner ?? "",
    item.category ?? "",
    item.sprint ?? ""
  ].join("\n\n");

  return await embedding.embed(text);
}
