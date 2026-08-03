import { useCallback, useRef, useState, type SyntheticEvent } from "react";
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

/**
 * Mirrors CompanyShortInfoBlock.jsx from the webapp project: a big image is shown
 * above the text unless it's narrower than half the card and taller than wide, in
 * which case it's shown small, inline with the title/description instead.
 */
function CompanyCard({ company, fetchedAt }: { company: CompanyShortInfo; fetchedAt?: string }) {
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [useBigImage, setUseBigImage] = useState(true);
  const blockRef = useRef<HTMLDivElement>(null);

  const handleImageLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const blockEl = blockRef.current;
    if (!blockEl) return;
    setIsImageLoaded(true);
    setUseBigImage(img.width > blockEl.offsetWidth / 2 && img.width > img.height);
  }, []);

  const registrationDate = formatRegistrationDate(company.registrationDate);
  const orgnoLabel = company.countryCode === "FI" ? "Business ID" : company.countryCode === "DK" ? "CVR number" : "Org. number";
  const hasPrimaryLineOfBusiness = company.primaryLineOfBusinessText.length > 0;
  const hasNaceCategories = company.naceCategories.length > 0;

  return (
    <div className="company-block-wrapper" ref={blockRef}>
      <div className="company-block">
        <div className="company-block-header">Company short info</div>
        <div className="company-block-content">
          <div className="company-img-and-description">
            {useBigImage && isImageLoaded && company.imageUrl && (
              <div className="company-img-wrap">
                <img style={{ maxWidth: "100%", maxHeight: "450px" }} src={company.imageUrl} alt="" />
              </div>
            )}

            <div className="company-description-wrap">
              {!useBigImage && company.imageUrl && <img className="company-small-image" src={company.imageUrl} alt="" />}
              <div className="company-field-description">
                {(company.title || company.name) && (
                  <div className="company-field company-field-title">{company.title || company.name}</div>
                )}
                {company.description && <p className="company-field">{company.description}</p>}
              </div>
            </div>
          </div>

          <div className="company-info">
            <div className="company-info__item">
              <strong className="company-info__item--left">{orgnoLabel}</strong>
              <div className="company-info__item--right">{formatOrgno(company.orgno, company.countryCode)}</div>
            </div>

            {registrationDate && (
              <div className="company-info__item">
                <strong className="company-info__item--left">Registration date</strong>
                <div className="company-info__item--right">{registrationDate}</div>
              </div>
            )}

            <div className="company-info__item">
              <strong className="company-info__item--left">Website</strong>
              <div className="company-info__item--right">
                {company.website ? (
                  <a href={company.website} target="_blank" rel="noreferrer">
                    {company.website}
                  </a>
                ) : (
                  "—"
                )}
              </div>
            </div>

            {hasNaceCategories && (
              <div className="company-info__item">
                <strong className="company-info__item--left">Industry</strong>
                <div className="company-info__item--right">
                  {company.naceCategories.map((c) => (
                    <div key={c.sniCode}>
                      <span className="company-sni-code">{c.sniCode}</span>
                      <span className="company-sni-text">{c.sniText}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasPrimaryLineOfBusiness && (
              <div className="company-info__item">
                <strong className="company-info__item--left">Line of business</strong>
                <div className="company-info__item--right">{company.primaryLineOfBusinessText}</div>
              </div>
            )}

            {company.activityText && (
              <div className="company-info__item">
                <strong className="company-info__item--left">Activity</strong>
                <div className="company-info__item--right">{company.activityText}</div>
              </div>
            )}
          </div>

          {fetchedAt && <span className="company-fetched-at">Last updated {formatTime(fetchedAt)}</span>}

          {company.imageUrl && (
            <img src={company.imageUrl} onLoad={handleImageLoad} alt="" style={{ display: "none" }} />
          )}
        </div>
      </div>
    </div>
  );
}
