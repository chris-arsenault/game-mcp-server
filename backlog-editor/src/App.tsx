import { FormEvent, useState } from "react";
import BacklogBoard from "./pages/BacklogBoard.js";
import GraphExplorer from "./pages/GraphExplorer.js";
import { getCurrentProject } from "./utils/api.js";

const normalizeProjectId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function App() {
  const [view, setView] = useState<"backlog" | "graph">("backlog");
  const [projectDraft, setProjectDraft] = useState(() => getCurrentProject());

  const handleProjectSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeProjectId(projectDraft);
    const url = new URL(window.location.href);
    if (normalized) {
      url.searchParams.set("project", normalized);
    } else {
      url.searchParams.delete("project");
    }
    window.location.href = `${url.pathname}${url.search}${url.hash}`;
  };

  return (
    <div className="shell">
      <header className="shell__header">
        <h1>Project Workspace</h1>
        <nav className="shell__nav">
          <button
            type="button"
            className={view === "backlog" ? "shell__tab shell__tab--active" : "shell__tab"}
            onClick={() => setView("backlog")}
          >
            Backlog &amp; Handoff
          </button>
          <button
            type="button"
            className={view === "graph" ? "shell__tab shell__tab--active" : "shell__tab"}
            onClick={() => setView("graph")}
          >
            Graph Explorer
          </button>
        </nav>
        <form className="shell__project" onSubmit={handleProjectSubmit}>
          <label className="shell__project-label" htmlFor="project-input">
            Project
          </label>
          <input
            id="project-input"
            type="text"
            value={projectDraft}
            onChange={(event) => setProjectDraft(event.target.value)}
            className="shell__project-input"
          />
          <button type="submit" className="shell__project-apply">
            Switch
          </button>
        </form>
      </header>
      <main className="shell__content">
        {view === "backlog" ? <BacklogBoard /> : <GraphExplorer />}
      </main>
    </div>
  );
}
