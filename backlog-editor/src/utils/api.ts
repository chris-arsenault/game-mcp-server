const PROJECT_STORAGE_KEY = "backlog-editor:project";
const DEFAULT_PROJECT =
  (import.meta.env.VITE_DEFAULT_PROJECT as string | undefined)?.trim().toLowerCase() ?? "default";

const normalizeProjectId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export function getCurrentProject(): string {
  if (typeof window === "undefined") {
    return DEFAULT_PROJECT;
  }

  const params = new URLSearchParams(window.location.search);
  const paramValue = params.get("project");

  if (paramValue) {
    const normalized = normalizeProjectId(paramValue);
    if (normalized) {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, normalized);
      return normalized;
    }
  }

  const stored = window.localStorage.getItem(PROJECT_STORAGE_KEY);
  if (stored) {
    return normalizeProjectId(stored);
  }

  return DEFAULT_PROJECT;
}

function appendProjectQuery(url: string, projectId: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(url, base);
    if (!parsed.searchParams.has("project")) {
      parsed.searchParams.set("project", projectId);
    }
    if (parsed.origin === base) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function apiRequest<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const projectId = getCurrentProject();
  let requestInfo: RequestInfo = input;

  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (projectId && !headers.has("X-Project-Id")) {
    headers.set("X-Project-Id", projectId);
  }

  if (typeof input === "string" && projectId) {
    requestInfo = appendProjectQuery(input, projectId);
  }

  const response = await fetch(requestInfo, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  return (await response.json()) as T;
}

export function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
