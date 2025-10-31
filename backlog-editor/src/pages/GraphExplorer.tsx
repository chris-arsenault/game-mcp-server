import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../utils/api.js";

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

type GraphEntityResponse = {
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

type ApiResponse<T> = { data: T };

type LayoutNode = GraphNode & {
  x: number;
  y: number;
};

type LayoutData = {
  nodes: LayoutNode[];
  links: GraphRelationship[];
};

const MAX_NODES_FOR_LAYOUT = 120;

export default function GraphExplorer() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<GraphSearchResult[]>([]);
  const [graphData, setGraphData] = useState<GraphEntityResponse | null>(null);
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const panState = useRef<{ dragging: boolean; startX: number; startY: number; originX: number; originY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  });

  useEffect(() => {
    if (!graphData) {
      setLayout(null);
      return;
    }

    const computed = computeLayout(graphData);
    setLayout(computed);
    setViewport({ scale: 1, x: 0, y: 0 });
    setSelectedNodeId(graphData.center?.id ?? null);
  }, [graphData]);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchTerm.trim();
    if (!query) {
      setSearchResults([]);
      setError("Enter a search query to explore graph content.");
      return;
    }

    try {
      setError(null);
      setSearchLoading(true);
      const result = await apiRequest<ApiResponse<GraphSearchResult[]>>(
        `/api/graph/search?query=${encodeURIComponent(query)}`
      );
      setSearchResults(result.data);
      if (result.data.length === 0) {
        setError("No matching graph entities found.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to search graph entities.");
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadEntity(id: string, nextDepth = depth) {
    try {
      setLoading(true);
      setError(null);
      const response = await apiRequest<ApiResponse<GraphEntityResponse>>(
        `/api/graph/entity?id=${encodeURIComponent(id)}&depth=${nextDepth}`
      );
      setGraphData(response.data);
      setDepth(nextDepth);
    } catch (err) {
      console.error(err);
      setError("Failed to load graph neighborhood.");
    } finally {
      setLoading(false);
    }
  }

  const selectedNode = useMemo(() => {
    if (!layout || !selectedNodeId) return null;
    return layout.nodes.find(node => node.id === selectedNodeId) ?? null;
  }, [layout, selectedNodeId]);

  const handleWheel: React.WheelEventHandler<SVGSVGElement> = (event) => {
    event.preventDefault();
    if (!svgRef.current) return;
    const { scale, x, y } = viewport;
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    const newScale = clamp(scale * factor, 0.3, 3);
    const rect = svgRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const newX = pointerX - ((pointerX - x) * newScale) / scale;
    const newY = pointerY - ((pointerY - y) * newScale) / scale;
    setViewport({ scale: newScale, x: newX, y: newY });
  };

  const handleMouseDown: React.MouseEventHandler<SVGSVGElement> = (event) => {
    panState.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y
    };
  };

  const handleMouseMove: React.MouseEventHandler<SVGSVGElement> = (event) => {
    if (!panState.current.dragging) return;
    const dx = event.clientX - panState.current.startX;
    const dy = event.clientY - panState.current.startY;
    setViewport(prev => ({
      ...prev,
      x: panState.current.originX + dx,
      y: panState.current.originY + dy
    }));
  };

  const handleMouseUp = () => {
    panState.current.dragging = false;
  };

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
  };

  function handleDepthChange(nextDepth: number) {
    if (!graphData?.center?.id) return;
    loadEntity(graphData.center.id, nextDepth);
  }

  return (
    <div className="graph-page">
      <header className="graph-header">
        <div>
          <h2>Graph Explorer</h2>
          <p>Investigate relationships from the code graph produced by graph-builder.</p>
        </div>
        <form className="graph-search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search by description, filename, component…"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
          />
          <button type="submit" disabled={searchLoading}>
            {searchLoading ? "Searching…" : "Search"}
          </button>
        </form>
      </header>

      {error && (
        <div className="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="graph-layout">
        <aside className="graph-sidebar">
          <div className="graph-sidebar__section">
            <h3>Results</h3>
            {searchResults.length === 0 ? (
              <p className="graph-empty">Run a search to discover graph entities.</p>
            ) : (
              <ul className="graph-results">
                {searchResults.map(result => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => loadEntity(result.id)}
                      className={graphData?.center?.id === result.id ? "graph-results__item graph-results__item--active" : "graph-results__item"}
                    >
                      <span className="graph-results__title">{result.title}</span>
                      <span className="graph-results__meta">
                        {result.labels.slice(0, 3).join(", ") || "unlabeled"}
                      </span>
                      <span className="graph-results__score">{result.score.toFixed(3)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="graph-sidebar__section">
            <h3>Neighborhood depth</h3>
            <div className="graph-depth">
              {[1, 2, 3].map(value => (
                <button
                  key={value}
                  type="button"
                  className={value === depth ? "graph-depth__button graph-depth__button--active" : "graph-depth__button"}
                  disabled={!graphData?.center?.id}
                  onClick={() => handleDepthChange(value)}
                >
                  {value} hop{value > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="graph-viewport">
          <svg
            ref={svgRef}
            className="graph-svg"
            viewBox="-600 -400 1200 800"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <rect className="graph-svg__background" x="0" y="0" width="100%" height="100%" />
            <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.scale})`}>
              {layout?.links.map(link => {
                const source = layout.nodes.find(node => node.id === link.start);
                const target = layout.nodes.find(node => node.id === link.end);
                if (!source || !target) {
                  return null;
                }
                return (
                  <line
                    key={link.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="graph-link"
                  />
                );
              })}

              {layout?.nodes.map(node => {
                const isCenter = graphData?.center?.id === node.id;
                const isActive = selectedNodeId === node.id;
                const radius = isCenter ? 12 : 9;
                return (
                  <g
                    key={node.id}
                    className={isActive ? "graph-node graph-node--active" : "graph-node"}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => handleNodeClick(node.id)}
                  >
                    <circle
                      r={radius}
                      fill={colorForLabels(node.labels)}
                      stroke={isCenter ? "#fde68a" : "#0f172a"}
                      strokeWidth={isCenter ? 2.5 : 1.5}
                    />
                    <text dy={radius + 12} className="graph-node__label">
                      {node.properties.name ?? node.properties.title ?? node.id}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          {!layout && !loading && (
            <div className="graph-placeholder">
              <p>Search for a node to visualise its neighborhood within the project graph.</p>
            </div>
          )}
          {loading && <div className="graph-loading">Loading neighborhood…</div>}
        </div>

        <aside className="graph-details">
          {selectedNode ? (
            <NodeDetails node={selectedNode} />
          ) : (
            <div className="graph-empty">Select a node to inspect its properties.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeDetails({ node }: { node: LayoutNode }) {
  const entries = Object.entries(node.properties ?? {});
  return (
    <div className="graph-details__panel">
      <h3>Node Details</h3>
      <p className="graph-details__id">{node.id}</p>
      <p className="graph-details__labels">{node.labels.join(", ") || "unlabeled"}</p>
      {entries.length === 0 ? (
        <p className="graph-empty">No properties available.</p>
      ) : (
        <dl className="graph-details__list">
          {entries.map(([key, value]) => (
            <div key={key} className="graph-details__item">
              <dt>{key}</dt>
              <dd>{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function computeLayout(graph: GraphEntityResponse): LayoutData {
  const nodeMap = new Map<string, LayoutNode>();
  const addNode = (node: GraphNode | null | undefined) => {
    if (!node) return;
    const existing = nodeMap.get(node.id);
    if (existing) return;
    nodeMap.set(node.id, {
      ...node,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400
    });
  };

  addNode(graph.center);
  graph.nodes.slice(0, MAX_NODES_FOR_LAYOUT).forEach(addNode);

  const nodes = Array.from(nodeMap.values());
  if (nodes.length === 0) {
    return { nodes: [], links: [] };
  }

  const links = graph.relationships.filter(
    rel => nodeMap.has(rel.start) && nodeMap.has(rel.end)
  );

  // Initialize positions in a circle for stability
  const angleStep = (Math.PI * 2) / nodes.length;
  nodes.forEach((node, index) => {
    node.x = Math.cos(angleStep * index) * 200;
    node.y = Math.sin(angleStep * index) * 200;
  });
  if (graph.center && nodeMap.has(graph.center.id)) {
    const center = nodeMap.get(graph.center.id)!;
    center.x = 0;
    center.y = 0;
  }

  const repulsionStrength = 4200;
  const attractionStrength = 0.015;
  const damping = 0.9;
  const targetDistance = 140;
  const iterations = 280;

  const velocity = new Map<string, { vx: number; vy: number }>();
  nodes.forEach(node => velocity.set(node.id, { vx: 0, vy: 0 }));

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsive forces
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const source = nodes[i];
        const target = nodes[j];
        let dx = source.x - target.x;
        let dy = source.y - target.y;
        let distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const force = repulsionStrength / (distance * distance);
        dx /= distance;
        dy /= distance;
        const vSource = velocity.get(source.id)!;
        const vTarget = velocity.get(target.id)!;
        vSource.vx += dx * force;
        vSource.vy += dy * force;
        vTarget.vx -= dx * force;
        vTarget.vy -= dy * force;
      }
    }

    // Attractive forces along links
    for (const link of links) {
      const source = nodeMap.get(link.start)!;
      const target = nodeMap.get(link.end)!;
      let dx = target.x - source.x;
      let dy = target.y - source.y;
      let distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const offset = (distance - targetDistance) * attractionStrength;
      dx /= distance;
      dy /= distance;
      const vSource = velocity.get(source.id)!;
      const vTarget = velocity.get(target.id)!;
      vSource.vx += dx * offset;
      vSource.vy += dy * offset;
      vTarget.vx -= dx * offset;
      vTarget.vy -= dy * offset;
    }

    // Apply velocities
    for (const node of nodes) {
      const vel = velocity.get(node.id)!;
      vel.vx *= damping;
      vel.vy *= damping;
      node.x += vel.vx;
      node.y += vel.vy;
    }
  }

  // Recentre graph
  const avgX = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
  const avgY = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
  nodes.forEach(node => {
    node.x = node.x - avgX;
    node.y = node.y - avgY;
  });

  return { nodes, links };
}

function colorForLabels(labels: string[]) {
  if (labels.length === 0) {
    return "#38bdf8";
  }
  const label = labels[0];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash << 5) - hash + label.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(v => formatValue(v)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value ?? "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
