import { useCallback, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CompanyShortInfo, CompanyShortInfoPayload } from "../../shared/types";

function formatOrgno(orgno: string, countryCode: string): string {
  if (!orgno) return "";
  if (countryCode === "SE") return `${orgno.slice(0, 6)}-${orgno.slice(6)}`;
  if (countryCode === "FI") {
    const rest = orgno.slice(6);
    return `${rest.slice(0, -1)}-${rest.slice(-1)}`;
  }
  return orgno;
}

function formatRegistrationDate(raw: string | null): string | null {
  if (!raw || raw.length < 8) return raw;
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  const date = new Date(`${year}-${month}-${day}`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatTime(iso: string): string {
  if (!iso) return "Unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function extractPayload(content: unknown): CompanyShortInfoPayload | null {
  if (!Array.isArray(content)) return null;
  const textItem = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null && (item as { type?: string }).type === "text",
  );
  if (!textItem) return null;
  try {
    return JSON.parse(textItem.text) as CompanyShortInfoPayload;
  } catch {
    return null;
  }
}

export function CompanyShortInfoBlock() {
  const [payload, setPayload] = useState<CompanyShortInfoPayload | null>(null);
  const [orgno, setOrgno] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasReceivedInput = useRef(false);

  const { app, isConnected, error: connectError } = useApp({
    appInfo: { name: "Company Short Info", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = (params) => {
        hasReceivedInput.current = true;
        const orgnoArg = params.arguments?.orgno;
        if (typeof orgnoArg === "string") setOrgno(orgnoArg);
        setLoading(true);
        setError(null);
      };
      app.ontoolresult = (result) => {
        setLoading(false);
        if (result.isError) {
          setError("The server could not fetch company info.");
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
    if (!app || !orgno) return;
    setLoading(true);
    setError(null);
    try {
      const result = await app.callServerTool({ name: "get_company_by_orgno", arguments: { orgno } });
      setLoading(false);
      if (result.isError) {
        setError("The server could not fetch company info.");
        return;
      }
      const parsed = extractPayload(result.content);
      if (parsed) setPayload(parsed);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to refresh company info.");
    }
  }, [app, orgno]);

  if (connectError) {
    return <div className="viz-root state-message">Couldn&apos;t connect to the host: {connectError.message}</div>;
  }

  const company = payload?.company ?? null;

  return (
    <div className="viz-root">
      <header className="header">
        <h1>Company Info</h1>
        <button className="refresh-btn" onClick={() => void refresh()} disabled={!isConnected || !orgno || loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {!isConnected && !payload && <div className="state-message">Connecting…</div>}
      {isConnected && loading && !company && !hasReceivedInput.current && <div className="state-message">Waiting for a company lookup…</div>}
      {isConnected && loading && !company && hasReceivedInput.current && <div className="state-message">Loading company info…</div>}
      {isConnected && !loading && !company && !error && <div className="state-message">No company found.</div>}

      {company && <CompanyCard company={company} fetchedAt={payload?.fetchedAt} />}
    </div>
  );
}

function CompanyCard({ company, fetchedAt }: { company: CompanyShortInfo; fetchedAt?: string }) {
  const registrationDate = formatRegistrationDate(company.registrationDate);

  return (
    <article className="company-card">
      <div className="company-card-top">
        {company.imageUrl && <img className="company-avatar" src={company.imageUrl} alt="" />}
        <div className="company-heading">
          <h2 className="company-title">{company.title || company.name || "Unknown company"}</h2>
          {fetchedAt && <span className="company-fetched-at">Last updated {formatTime(fetchedAt)}</span>}
        </div>
      </div>

      {company.description && <p className="company-description">{company.description}</p>}

      <div className="company-info-grid">
        <div className="company-info-row">
          <span className="company-info-label">Org. number</span>
          <span className="company-info-value">{formatOrgno(company.orgno, company.countryCode)}</span>
        </div>

        {registrationDate && (
          <div className="company-info-row">
            <span className="company-info-label">Registered</span>
            <span className="company-info-value">{registrationDate}</span>
          </div>
        )}

        <div className="company-info-row">
          <span className="company-info-label">Website</span>
          <span className="company-info-value">
            {company.website ? (
              <a href={company.website} target="_blank" rel="noreferrer">
                {company.website}
              </a>
            ) : (
              "—"
            )}
          </span>
        </div>

        {company.primaryLineOfBusinessText && (
          <div className="company-info-row">
            <span className="company-info-label">Line of business</span>
            <span className="company-info-value">{company.primaryLineOfBusinessText}</span>
          </div>
        )}
      </div>

      {company.naceCategories.length > 0 && (
        <div className="company-tags" aria-label="Industry categories">
          {company.naceCategories.map((c) => (
            <span className="company-tag" key={c.sniCode} title={c.sniText}>
              {c.sniCode} · {c.sniText}
            </span>
          ))}
        </div>
      )}

      {company.activityText && <p className="company-activity">{company.activityText}</p>}
    </article>
  );
}
