import { useEffect, useMemo, useState } from "react";
import { apiRequest, formatTimestamp } from "../utils/api.js";

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
  updated_at: string;
  created_at: string;
};

type HandoffPayload = {
  content: string;
  updated_by?: string | null;
  updated_at?: string | null;
};

type ApiResponse<T> = {
  data: T;
};

type StatusColumn = {
  key: string;
  label: string;
  aliases?: string[];
};

const STATUS_COLUMNS: StatusColumn[] = [
  { key: "todo", label: "To Do" },
  { key: "in-progress", label: "In Progress", aliases: ["pending"] },
  { key: "blocked", label: "Blocked" },
  { key: "review", label: "In Review" },
  { key: "done", label: "Done" }
];

const PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3", "Backlog"];

export default function BacklogBoard() {
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [handoff, setHandoff] = useState<HandoffPayload>({ content: "" });
  const [handoffDraft, setHandoffDraft] = useState("");
  const [handoffAuthor, setHandoffAuthor] = useState("");
  const [loadingBacklog, setLoadingBacklog] = useState(true);
  const [loadingHandoff, setLoadingHandoff] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSavingHandoff, setIsSavingHandoff] = useState(false);
  const [newItem, setNewItem] = useState({
    title: "",
    description: "",
    priority: "P2",
    status: "todo"
  });

  useEffect(() => {
    void loadBacklog();
    void loadHandoff();
  }, []);

  async function loadBacklog() {
    try {
      setLoadingBacklog(true);
      const result = await apiRequest<ApiResponse<BacklogItem[]>>("/api/backlog");
      setBacklog(result.data);
    } catch (err) {
      console.error(err);
      setError("Failed to load backlog items");
    } finally {
      setLoadingBacklog(false);
    }
  }

  async function loadHandoff() {
    try {
      setLoadingHandoff(true);
      const result = await apiRequest<ApiResponse<HandoffPayload>>("/api/handoff");
      setHandoff(result.data);
      setHandoffDraft(result.data.content ?? "");
    } catch (err) {
      console.error(err);
      setError("Failed to load handoff notes");
    } finally {
      setLoadingHandoff(false);
    }
  }

  async function handleUpdateItem(id: string, changes: Partial<BacklogItem>) {
    setBacklog(current =>
      current.map(item => (item.id === id ? { ...item, ...changes } : item))
    );
    try {
      await apiRequest(`/api/backlog/${id}`, {
        method: "PUT",
        body: JSON.stringify(changes)
      });
    } catch (err) {
      console.error(err);
      setError("Failed to update backlog item");
      void loadBacklog();
    }
  }

  async function handleCreateItem() {
    if (!newItem.title.trim() || !newItem.description.trim()) {
      setError("Title and description are required for new backlog items.");
      return;
    }

    try {
      const payload = {
        title: newItem.title.trim(),
        description: newItem.description.trim(),
        priority: newItem.priority,
        status: newItem.status
      };
      const response = await apiRequest<ApiResponse<BacklogItem>>("/api/backlog", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setBacklog(current => [...current, response.data]);
      setNewItem({
        title: "",
        description: "",
        priority: "P2",
        status: "todo"
      });
    } catch (err) {
      console.error(err);
      setError("Failed to create backlog item");
    }
  }

  async function handleSaveHandoff() {
    try {
      setIsSavingHandoff(true);
      const payload = {
        content: handoffDraft,
        updated_by: handoffAuthor || undefined
      };
      const response = await apiRequest<ApiResponse<HandoffPayload>>("/api/handoff", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setHandoff(response.data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to save handoff notes");
    } finally {
      setIsSavingHandoff(false);
    }
  }

  const backlogByStatus = useMemo(() => {
    const grouped: Record<string, BacklogItem[]> = {};
    for (const column of STATUS_COLUMNS) {
      grouped[column.key] = [];
    }

    for (const item of backlog) {
      const normalizedStatus = (item.status ?? "todo").toLowerCase();
      const column = STATUS_COLUMNS.find(col => {
        if (normalizedStatus === col.key.toLowerCase()) {
          return true;
        }
        return col.aliases?.some(alias => alias.toLowerCase() === normalizedStatus);
      });

      const targetKey = column?.key ?? "todo";
      if (!grouped[targetKey]) {
        grouped[targetKey] = [];
      }
      grouped[targetKey].push(item);
    }

    for (const key of Object.keys(grouped)) {
      grouped[key] = grouped[key].sort(
        (a, b) => PRIORITY_OPTIONS.indexOf(a.priority) - PRIORITY_OPTIONS.indexOf(b.priority)
      );
    }

    return grouped;
  }, [backlog]);

  return (
    <div className="board-page">
      <header className="board-header">
        <div>
          <h2>Backlog &amp; Handoff Editor</h2>
          <p>Keep work items and session context synchronized across the team.</p>
        </div>
        <div className="board-header__actions">
          <button className="refresh-button" onClick={() => void loadBacklog()} disabled={loadingBacklog}>
            Refresh Backlog
          </button>
          <button className="refresh-button" onClick={() => void loadHandoff()} disabled={loadingHandoff}>
            Refresh Handoff
          </button>
        </div>
      </header>

      {error && (
        <div className="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="handoff">
        <div className="handoff__header">
          <h3>Session Handoff Notes</h3>
          <div className="handoff__meta">
            <span>Last updated: {formatTimestamp(handoff.updated_at)}</span>
            {handoff.updated_by && <span> by {handoff.updated_by}</span>}
          </div>
        </div>
        <textarea
          className="handoff__textarea"
          value={handoffDraft}
          onChange={event => setHandoffDraft(event.target.value)}
          placeholder="Describe the current state, blockers, next steps, etc."
          rows={8}
        />
        <div className="handoff__actions">
          <input
            className="handoff__author"
            type="text"
            value={handoffAuthor}
            onChange={event => setHandoffAuthor(event.target.value)}
            placeholder="Updated by (optional)"
          />
          <button onClick={() => void handleSaveHandoff()} disabled={isSavingHandoff}>
            {isSavingHandoff ? "Saving…" : "Save Handoff"}
          </button>
        </div>
      </section>

      <section className="new-item">
        <h3>Create New Backlog Item</h3>
        <div className="new-item__form">
          <input
            type="text"
            placeholder="Title"
            value={newItem.title}
            onChange={event => setNewItem({ ...newItem, title: event.target.value })}
          />
          <textarea
            placeholder="Description"
            rows={3}
            value={newItem.description}
            onChange={event => setNewItem({ ...newItem, description: event.target.value })}
          />
          <div className="new-item__controls">
            <label>
              Status
              <select
                value={newItem.status}
                onChange={event => setNewItem({ ...newItem, status: event.target.value })}
              >
                {STATUS_COLUMNS.map(column => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={newItem.priority}
                onChange={event => setNewItem({ ...newItem, priority: event.target.value })}
              >
                {PRIORITY_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => void handleCreateItem()}>Add Item</button>
          </div>
        </div>
      </section>

      <section className="board">
        {STATUS_COLUMNS.map(column => (
          <div key={column.key} className="board__column">
            <header className="board__column-header">
              <h4>{column.label}</h4>
              <span>{backlogByStatus[column.key]?.length ?? 0}</span>
            </header>
            <div className="board__column-content">
              {loadingBacklog && backlog.length === 0 ? (
                <div className="board__empty">Loading…</div>
              ) : (backlogByStatus[column.key] ?? []).length === 0 ? (
                <div className="board__empty">No items</div>
              ) : (
                backlogByStatus[column.key].map(item => (
                  <article key={item.id} className="card">
                    <div className="card__header">
                      <h5>{item.title}</h5>
                      <span className={`card__priority card__priority--${item.priority.toLowerCase()}`}>
                        {item.priority}
                      </span>
                    </div>
                    <textarea
                      className="card__description"
                      value={item.description}
                      onChange={event =>
                        setBacklog(current =>
                          current.map(currentItem =>
                            currentItem.id === item.id
                              ? { ...currentItem, description: event.target.value }
                              : currentItem
                          )
                        )
                      }
                      onBlur={event => {
                        const newDescription = event.target.value;
                        void handleUpdateItem(item.id, { description: newDescription });
                      }}
                    />
                    <div className="card__controls">
                      <label>
                        Status
                        <select
                          value={item.status}
                          onChange={event =>
                            void handleUpdateItem(item.id, { status: event.target.value })
                          }
                        >
                          {STATUS_COLUMNS.map(option => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Priority
                        <select
                          value={item.priority}
                          onChange={event =>
                            void handleUpdateItem(item.id, { priority: event.target.value })
                          }
                        >
                          {PRIORITY_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <footer className="card__footer">
                      <span>Updated: {formatTimestamp(item.updated_at)}</span>
                    </footer>
                  </article>
                ))
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
