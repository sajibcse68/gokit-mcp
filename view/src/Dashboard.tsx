import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { Incident, IncidentsPayload } from "../../shared/types";

const CATEGORY_SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];
const OTHER_COLOR = "var(--text-muted)";

function categoryColor(category: string, orderedCategories: string[]): string {
  const index = orderedCategories.indexOf(category);
  return index >= 0 && index < CATEGORY_SLOTS.length ? CATEGORY_SLOTS[index] : OTHER_COLOR;
}

function formatTime(iso: string): string {
  if (!iso) return "Unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function extractPayload(content: unknown): IncidentsPayload | null {
  if (!Array.isArray(content)) return null;
  const textItem = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null && (item as { type?: string }).type === "text",
  );
  if (!textItem) return null;
  try {
    return JSON.parse(textItem.text) as IncidentsPayload;
  } catch {
    return null;
  }
}

export function Dashboard() {
  const [payload, setPayload] = useState<IncidentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const hasSelfFetched = useRef(false);

  const { app, isConnected, error: connectError } = useApp({
    appInfo: { name: "Police Dashboard", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = () => {
        setLoading(true);
        setError(null);
      };
      app.ontoolresult = (result) => {
        setLoading(false);
        if (result.isError) {
          setError("The server could not fetch the latest incidents.");
          return;
        }
        const parsed = extractPayload(result.content);
        if (parsed) setPayload(parsed);
      };
      app.ontoolcancelled = () => setLoading(false);
    },
  });

  useHostStyles(app, app?.getHostContext());

  const refresh = useCallback(async () => {
    if (!app) return;
    setLoading(true);
    setError(null);
    try {
      const result = await app.callServerTool({ name: "get_incidents", arguments: {} });
      setLoading(false);
      if (result.isError) {
        setError("The server could not fetch the latest incidents.");
        return;
      }
      const parsed = extractPayload(result.content);
      console.log("🚀 ~ Dashboard ~ parsed:", parsed)
      if (parsed) setPayload(parsed);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to refresh incidents.");
    }
  }, [app]);

  useEffect(() => {
    if (isConnected && !hasSelfFetched.current) {
      hasSelfFetched.current = true;
      void refresh();
    }
  }, [isConnected, refresh]);

  const incidents = payload?.incidents ?? [];

  const orderedCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const incident of incidents) {
      counts.set(incident.category, (counts.get(incident.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  }, [incidents]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const incident of incidents) {
      counts.set(incident.category, (counts.get(incident.category) ?? 0) + 1);
    }
    return counts;
  }, [incidents]);

  const filteredIncidents = useMemo(
    () => (categoryFilter ? incidents.filter((i) => i.category === categoryFilter) : incidents),
    [incidents, categoryFilter],
  );

  const activeCount = useMemo(() => incidents.filter((i) => i.isActive).length, [incidents]);
  const maxCategoryCount = useMemo(
    () => Math.max(1, ...[...categoryCounts.values()]),
    [categoryCounts],
  );

  if (connectError) {
    return (
      <div className="viz-root state-message">
        Couldn&apos;t connect to the host: {connectError.message}
      </div>
    );
  }

  return (
    <div className="viz-root">
      <header className="header">
        <h1>Police Dashboard</h1>
        <button className="refresh-btn" onClick={() => void refresh()} disabled={!isConnected || loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="stat-row" aria-label="Summary statistics">
        <div className="stat-tile">
          <span className="stat-label">Loaded incidents</span>
          <span className="stat-value">{incidents.length}</span>
          {payload && payload.totalCount > incidents.length && (
            <span className="stat-caption">of {payload.totalCount} total</span>
          )}
        </div>
        <div className="stat-tile">
          <span className="stat-label">Active</span>
          <span className="stat-value stat-value-good">{activeCount}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Categories</span>
          <span className="stat-value">{categoryCounts.size}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Last updated</span>
          <span className="stat-value stat-value-small">
            {payload ? formatTime(payload.fetchedAt) : "—"}
          </span>
        </div>
      </section>

      <section className="filter-row" aria-label="Category filter">
        <button
          className={`chip ${categoryFilter === null ? "chip-selected" : ""}`}
          onClick={() => setCategoryFilter(null)}
        >
          All ({incidents.length})
        </button>
        {orderedCategories.map((category) => (
          <button
            key={category}
            className={`chip ${categoryFilter === category ? "chip-selected" : ""}`}
            onClick={() => setCategoryFilter(category)}
          >
            <span
              className="chip-dot"
              style={{ background: categoryColor(category, orderedCategories) }}
            />
            {category} ({categoryCounts.get(category)})
          </button>
        ))}
      </section>

      {categoryCounts.size > 0 && (
        <section className="bars" aria-label="Incidents by category">
          {orderedCategories.map((category) => {
            const count = categoryCounts.get(category) ?? 0;
            return (
              <div className="bar-row" key={category}>
                <span className="bar-label">{category}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(count / maxCategoryCount) * 100}%`,
                      background: categoryColor(category, orderedCategories),
                    }}
                  />
                </div>
                <span className="bar-value">{count}</span>
              </div>
            );
          })}
        </section>
      )}

      <section className="incident-list" aria-label="Incidents">
        {!isConnected && !payload && <div className="state-message">Connecting…</div>}
        {isConnected && loading && incidents.length === 0 && <div className="state-message">Loading incidents…</div>}
        {isConnected && !loading && filteredIncidents.length === 0 && incidents.length > 0 && (
          <div className="state-message">No incidents in this category.</div>
        )}
        {isConnected && !loading && incidents.length === 0 && !error && (
          <div className="state-message">No incidents found.</div>
        )}
        {filteredIncidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} color={categoryColor(incident.category, orderedCategories)} />
        ))}
      </section>
    </div>
  );
}

function IncidentCard({ incident, color }: { incident: Incident; color: string }) {
  return (
    <article className="incident-card">
      <div className="incident-card-top">
        <span className="chip-dot" style={{ background: color }} />
        <span className="incident-category">{incident.category}</span>
        <span className={`status-badge ${incident.isActive ? "status-good" : "status-muted"}`}>
          {incident.isActive ? "Active" : "Closed"}
        </span>
        <time className="incident-time">{formatTime(incident.createdOn)}</time>
      </div>
      <p className="incident-text">{incident.text}</p>
      <div className="incident-meta">
        {[incident.district, incident.municipality, incident.area].filter(Boolean).join(" · ")}
      </div>
    </article>
  );
}
