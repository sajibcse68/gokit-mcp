import type { CompanyShortInfo } from "../shared/types.js";

const GOAVA_API_URL = process.env.GOAVA_API_URL ?? "https://dev-dataapi.goava.com/graphql";
// TODO: temporary hardcoded token until proper auth wiring exists. Set GOAVA_API_TOKEN in the
// environment (e.g. a local .env, which is gitignored) rather than committing a real value here.
const GOAVA_API_TOKEN = process.env.GOAVA_API_TOKEN ?? "";

const GET_COMPANY_BY_ORGNO_QUERY = `
  query getCompanyByOrgno($orgno: String!) {
    getCompanyByOrgno(orgno: $orgno) {
      orgno
      name
      title
      description
      image_url
      registration_date
      country_code
      legalgroup_text
      nace_categories {
        sni_code
        sni_text
      }
      activities {
        activity_text
        sequence
      }
      social {
        www {
          address
        }
      }
    }
  }
`;

export interface FetchCompanyResult {
  company: CompanyShortInfo | null;
  source: "live" | "mock";
}

/** Clearly-labeled fabricated company, used only as a fallback when the Goava API can't be reached. */
const MOCK_COMPANY: CompanyShortInfo = {
  orgno: "5560000000",
  name: "Demo Aktiebolag",
  title: "Demo Aktiebolag",
  description: "[DEMO DATA - ikke en reell hendelse] Fabricated company shown because the Goava API is unreachable.",
  imageUrl: null,
  registrationDate: "20100115",
  countryCode: "SE",
  website: "https://example.com",
  primaryLineOfBusinessText: "Demo consulting services",
  activityText: "Demo Aktiebolag provides fabricated consulting services for demonstration purposes.",
  naceCategories: [{ sniCode: "70220", sniText: "Business and other management consultancy activities" }],
};

interface RawNaceCategory {
  sni_code?: string | null;
  sni_text?: string | null;
}

interface RawActivity {
  activity_text?: string | null;
  sequence?: number | null;
}

interface RawCompany {
  orgno?: string;
  name?: string;
  title?: string;
  description?: string;
  image_url?: string | null;
  registration_date?: string | number | null;
  country_code?: string;
  legalgroup_text?: string | null;
  nace_categories?: RawNaceCategory[] | null;
  activities?: RawActivity[] | null;
  social?: { www?: Array<{ address?: string | null }> | null } | null;
}

interface GraphQLResponse {
  data?: { getCompanyByOrgno?: RawCompany | null };
  errors?: Array<{ message: string }>;
}

function normalizeCompany(raw: RawCompany): CompanyShortInfo {
  const activities = [...(raw.activities ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return {
    orgno: String(raw.orgno ?? ""),
    name: raw.name ?? "",
    title: raw.title ?? raw.name ?? "",
    description: raw.description ?? "",
    imageUrl: raw.image_url ?? null,
    registrationDate: raw.registration_date == null ? null : String(raw.registration_date),
    countryCode: raw.country_code ?? "",
    website: raw.social?.www?.[0]?.address ?? null,
    primaryLineOfBusinessText: raw.legalgroup_text ?? "",
    activityText: activities.map((a) => a.activity_text ?? "").join(""),
    naceCategories: (raw.nace_categories ?? []).map((c) => ({
      sniCode: c.sni_code ?? "",
      sniText: c.sni_text ?? "",
    })),
  };
}

/** Generic GraphQL POST, mirroring the webapp's `$axios.post('', { query, variables })` pattern. */
async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GOAVA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(GOAVA_API_TOKEN ? { Authorization: GOAVA_API_TOKEN } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Goava API responded ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as GraphQLResponse;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  return json as T;
}

/** Falls back to labeled demo data if the Goava API is unreachable or unauthorized. */
export async function fetchCompanyByOrgno(orgno: string): Promise<FetchCompanyResult> {
  try {
    const json = await gqlRequest<GraphQLResponse>(GET_COMPANY_BY_ORGNO_QUERY, { orgno });
    const raw = json.data?.getCompanyByOrgno;
    return { company: raw ? normalizeCompany(raw) : null, source: "live" };
  } catch (err) {
    console.error(`Goava API unreachable, falling back to demo data: ${err instanceof Error ? err.message : String(err)}`);
    return { company: { ...MOCK_COMPANY, orgno }, source: "mock" };
  }
}
