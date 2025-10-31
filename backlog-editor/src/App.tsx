import { useState } from "react";
import BacklogBoard from "./pages/BacklogBoard.js";
import GraphExplorer from "./pages/GraphExplorer.js";

export default function App() {
  const [view, setView] = useState<"backlog" | "graph">("backlog");

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
      </header>
      <main className="shell__content">
        {view === "backlog" ? <BacklogBoard /> : <GraphExplorer />}
      </main>
    </div>
  );
}
