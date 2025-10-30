import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

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
