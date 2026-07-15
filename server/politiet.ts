import type { Incident } from "../shared/types.js";

const BASE_URL = "https://api.politiloggen.politiet.no";
const PAGE_SIZE = 50; // API-enforced max per request
const MAX_LIMIT = 200;

export interface FetchIncidentsOptions {
  categories?: string[];
  districts?: string[];
  limit?: number;
}

export interface FetchIncidentsResult {
  incidents: Incident[];
  totalCount: number;
  source: "live" | "mock";
}

/** Clearly-labeled fabricated incidents, used only as a fallback when api.politiet.no can't be reached. */
const MOCK_INCIDENTS: Incident[] = [
  {
    id: "mock-1", threadId: null,
    text: "[DEMO DATA - ikke en reell hendelse] Trafikkuhell mellom to biler. Ingen personskade meldt.",
    district: "Oslo", category: "Trafikkuhell", municipality: "Oslo", area: "Sentrum",
    createdOn: "2026-07-15T08:12:00.000Z", updatedOn: "2026-07-15T08:20:00.000Z",
    imageUrl: null, isEdited: false, isActive: true,
  },
  {
    id: "mock-2", threadId: null,
    text: "[DEMO DATA - ikke en reell hendelse] Melding om innbrudd i bolig. Politiet undersøker stedet.",
    district: "Vest", category: "Innbrudd", municipality: "Bergen", area: "Fyllingsdalen",
    createdOn: "2026-07-15T07:40:00.000Z", updatedOn: "2026-07-15T07:40:00.000Z",
    imageUrl: null, isEdited: false, isActive: true,
  },
  {
    id: "mock-3", threadId: null,
    text: "[DEMO DATA - ikke en reell hendelse] Mistenkelig person observert ved skole. Patrulje sendt til stedet.",
    district: "Sør-Øst", category: "Annet", municipality: "Drammen", area: "Bragernes",
    createdOn: "2026-07-15T06:55:00.000Z", updatedOn: "2026-07-15T06:58:00.000Z",
    imageUrl: null, isEdited: true, isActive: false,
  },
  {
    id: "mock-4", threadId: null,
    text: "[DEMO DATA - ikke en reell hendelse] Melding om brann i søppelcontainer. Brannvesen på stedet.",
    district: "Trøndelag", category: "Brann", municipality: "Trondheim", area: "Lademoen",
    createdOn: "2026-07-15T05:30:00.000Z", updatedOn: "2026-07-15T05:45:00.000Z",
    imageUrl: null, isEdited: false, isActive: false,
  },
  {
    id: "mock-5", threadId: null,
    text: "[DEMO DATA - ikke en reell hendelse] Ordensforstyrrelse utenfor utested. Involverte er bortvist.",
    district: "Øst", category: "Ordensforstyrrelse", municipality: "Fredrikstad", area: "Sentrum",
    createdOn: "2026-07-15T02:10:00.000Z", updatedOn: "2026-07-15T02:30:00.000Z",
    imageUrl: null, isEdited: false, isActive: false,
  },
  {
    id: "mock-6", threadId: null,
    text: "[DEMO DATA - ikke en reell hendelse] Melding om tyveri fra butikk. Sak opprettet.",
    district: "Innlandet", category: "Tyveri", municipality: "Hamar", area: "Sentrum",
    createdOn: "2026-07-14T22:05:00.000Z", updatedOn: "2026-07-14T22:05:00.000Z",
    imageUrl: null, isEdited: false, isActive: false,
  },
];

function filterMockIncidents(opts: { categories?: string[]; districts?: string[] }): Incident[] {
  return MOCK_INCIDENTS.filter((incident) => {
    const categoryOk = !opts.categories?.length || opts.categories.some((c) => c.toLowerCase() === incident.category.toLowerCase());
    const districtOk = !opts.districts?.length || opts.districts.some((d) => d.toLowerCase() === incident.district.toLowerCase());
    return categoryOk && districtOk;
  });
}

/** The API's exact response-field casing isn't verifiable from this sandbox
 * (outbound network to api.politiet.no is blocked here), so field lookup is
 * case-insensitive to tolerate either PascalCase or camelCase JSON. */
function pick(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (obj[name] !== undefined) return obj[name];
  }
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const key = lower.get(name.toLowerCase());
    if (key !== undefined && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function normalizeMessage(raw: Record<string, unknown>): Incident {
  const id = pick(raw, "id", "Id");
  const threadId = pick(raw, "threadId", "ThreadId");
  return {
    id: String(id ?? ""),
    threadId: threadId === undefined || threadId === null ? null : String(threadId),
    text: String(pick(raw, "text", "Text") ?? ""),
    district: String(pick(raw, "district", "District") ?? "Unknown"),
    category: String(pick(raw, "category", "Category") ?? "Unknown"),
    municipality: String(pick(raw, "municipality", "Municipality") ?? ""),
    area: String(pick(raw, "area", "Area") ?? ""),
    createdOn: String(pick(raw, "createdOn", "CreatedOn") ?? ""),
    updatedOn: String(pick(raw, "updatedOn", "UpdatedOn") ?? ""),
    imageUrl: (pick(raw, "imageUrl", "ImageUrl") as string | null | undefined) ?? null,
    isEdited: Boolean(pick(raw, "isEdited", "IsEdited") ?? false),
    isActive: Boolean(pick(raw, "isActive", "IsActive") ?? false),
  };
}

async function fetchPage(opts: {
  categories?: string[];
  districts?: string[];
  take: number;
  skip: number;
}): Promise<{ incidents: Incident[]; totalCount: number }> {
  const params = new URLSearchParams();
  for (const c of opts.categories ?? []) params.append("Categories", c);
  for (const d of opts.districts ?? []) params.append("Districts", d);
  params.set("Take", String(opts.take));
  params.set("Skip", String(opts.skip));
  params.set("SortBy", "Date");
  params.set("SortOrder", "Descending");

  const url = `${BASE_URL}/messages?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Politiloggen API responded ${res.status} ${res.statusText} for ${url}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const rawMessages = (pick(data, "messages", "Messages") as Record<string, unknown>[] | undefined) ?? [];
  const totalCount = Number(pick(data, "totalCount", "TotalCount") ?? rawMessages.length);
  return { incidents: rawMessages.map(normalizeMessage), totalCount };
}

/** Pages through the API (its Take cap is 50) to satisfy limits up to MAX_LIMIT.
 * Falls back to labeled demo data if api.politiet.no is unreachable. */
export async function fetchIncidents(opts: FetchIncidentsOptions): Promise<FetchIncidentsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIMIT);

  try {
    const incidents: Incident[] = [];
    let totalCount = 0;
    let skip = 0;

    while (incidents.length < limit) {
      const take = Math.min(PAGE_SIZE, limit - incidents.length);
      const page = await fetchPage({
        categories: opts.categories,
        districts: opts.districts,
        take,
        skip,
      });
      incidents.push(...page.incidents);
      totalCount = page.totalCount;
      skip += take;
      if (page.incidents.length < take) break; // exhausted upstream results
    }

    return { incidents, totalCount, source: "live" };
  } catch (err) {
    console.error(
      `api.politiet.no unreachable, falling back to demo data: ${err instanceof Error ? err.message : String(err)}`,
    );
    const filtered = filterMockIncidents({ categories: opts.categories, districts: opts.districts });
    return { incidents: filtered.slice(0, limit), totalCount: filtered.length, source: "mock" };
  }
}
