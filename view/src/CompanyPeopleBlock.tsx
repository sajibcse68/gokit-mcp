import { useCallback, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CompanyPeoplePayload, CompanyPerson } from "../../shared/types";

const SHOW_MORE_COUNT = 8;

function extractPayload(content: unknown): CompanyPeoplePayload | null {
  if (!Array.isArray(content)) return null;
  const textItem = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" && item !== null && (item as { type?: string }).type === "text",
  );
  if (!textItem) return null;
  try {
    return JSON.parse(textItem.text) as CompanyPeoplePayload;
  } catch {
    return null;
  }
}

export function CompanyPeopleBlock() {
  const [payload, setPayload] = useState<CompanyPeoplePayload | null>(null);
  const [orgno, setOrgno] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(true);
  const hasReceivedInput = useRef(false);

  const { app, isConnected, error: connectError } = useApp({
    appInfo: { name: "Company Contacts", version: "1.0.0" },
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
          setError("The server could not fetch company contacts.");
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
      const result = await app.callServerTool({ name: "get_company_people", arguments: { orgno } });
      setLoading(false);
      if (result.isError) {
        setError("The server could not fetch company contacts.");
        return;
      }
      const parsed = extractPayload(result.content);
      if (parsed) setPayload(parsed);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to refresh company contacts.");
    }
  }, [app, orgno]);

  if (connectError) {
    return <div className="viz-root state-message">Couldn&apos;t connect to the host: {connectError.message}</div>;
  }

  const people = payload?.people ?? [];
  const showMoreCount = people.length > SHOW_MORE_COUNT ? people.length - SHOW_MORE_COUNT : 0;
  const shouldShowMoreLink = showMoreCount > 0;
  const visiblePeople = shouldShowMoreLink && showMore ? people.slice(0, SHOW_MORE_COUNT) : people;

  return (
    <div className="viz-root">
      <header className="header">
        <h1>Company Contacts</h1>
        <button className="refresh-btn" onClick={() => void refresh()} disabled={!isConnected || !orgno || loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {!isConnected && !payload && <div className="state-message">Connecting…</div>}
      {isConnected && loading && people.length === 0 && !hasReceivedInput.current && (
        <div className="state-message">Waiting for a company lookup…</div>
      )}
      {isConnected && loading && people.length === 0 && hasReceivedInput.current && (
        <div className="state-message">Loading contacts…</div>
      )}
      {isConnected && !loading && people.length === 0 && !error && <div className="state-message">No contacts found.</div>}

      {people.length > 0 && (
        <div className="company-block-wrapper company-people-block">
          <div className="company-block">
            <div className="people-section-container">
              <div className="people-section-title-wrapper">
                <div className="company-block-header">Contacts with email</div>
                {payload && (
                  <span className="people-revealed-count">
                    {payload.revealedCount} of {people.filter((p) => p.hasEmail).length} emails revealed
                  </span>
                )}
              </div>

              <div className="people-items">
                {visiblePeople.map((person) => (
                  <PersonItem key={person.id} person={person} />
                ))}
              </div>

              {shouldShowMoreLink && (
                <div className="people-show-more" onClick={() => setShowMore((v) => !v)}>
                  <a href="#" onClick={(e) => e.preventDefault()}>
                    {showMore ? `Show ${showMoreCount} more` : "Show less"}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonItem({ person }: { person: CompanyPerson }) {
  const isLinkedIn = person.sourceName === "linkedin";
  const category = [person.designation, person.designationCategory].filter(Boolean).join(" · ");

  return (
    <div className={`person-item ${isLinkedIn ? "person-item-linkedin" : "person-item-default"}`}>
      <div className="person-item-name">
        {person.name || "Unknown"}
        {isLinkedIn && <span className="person-item-badge person-item-badge-linkedin">LinkedIn</span>}
        {person.isVerified && <span className="person-item-badge person-item-badge-verified">Verified</span>}
      </div>

      {category && <div className="person-item-designation">{category}</div>}

      <div className="person-item-contact-row">
        {person.email ? (
          <span className="person-item-contact">✉ {person.email}</span>
        ) : person.hasEmail ? (
          <span className="person-item-contact person-item-contact-muted">✉ Email on file (not revealed)</span>
        ) : null}
        {person.phone && <span className="person-item-contact">☎ {person.phone}</span>}
      </div>
    </div>
  );
}
