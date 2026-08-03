import type { CompanyPeoplePayload, CompanyPerson, CompanyShortInfo } from "../shared/types.js";

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

interface GraphQLResponse<T> {
  data?: T;
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
async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
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

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  return json;
}

/** Falls back to labeled demo data if the Goava API is unreachable or unauthorized. */
export async function fetchCompanyByOrgno(orgno: string): Promise<FetchCompanyResult> {
  try {
    const json = await gqlRequest<{ getCompanyByOrgno?: RawCompany | null }>(GET_COMPANY_BY_ORGNO_QUERY, { orgno });
    const raw = json.data?.getCompanyByOrgno;
    return { company: raw ? normalizeCompany(raw) : null, source: "live" };
  } catch (err) {
    console.error(`Goava API unreachable, falling back to demo data: ${err instanceof Error ? err.message : String(err)}`);
    return { company: { ...MOCK_COMPANY, orgno }, source: "mock" };
  }
}

const GET_COMPANY_PEOPLE_QUERY = `
  query getCompanyByOrgno($orgno: String!) {
    getCompanyByOrgno(orgno: $orgno) {
      people {
        id
        name
        designation
        designation_category
        data_type
        has_email
        phones
        is_verified
        source_name
      }
    }
  }
`;

const GET_CONTACT_EMAIL_QUERY = `
  query getContactEmail($contact: ContactRequest!) {
    getContactEmail(contact: $contact) {
      email
    }
  }
`;

const MAX_REVEAL_LIMIT = 25;
const DEFAULT_REVEAL_LIMIT = 10;

/** Clearly-labeled fabricated contacts, used only as a fallback when the Goava API can't be reached. */
const MOCK_PEOPLE: CompanyPerson[] = [
  {
    id: -1,
    name: "Demo Contact",
    designation: "Head of Demo",
    designationCategory: "demo",
    hasEmail: true,
    email: "demo.contact@example.com",
    phone: null,
    isVerified: false,
    sourceName: "mock",
  },
  {
    id: -2,
    name: "Another Demo Contact",
    designation: "Demo Coordinator",
    designationCategory: "demo",
    hasEmail: false,
    email: null,
    phone: null,
    isVerified: false,
    sourceName: "mock",
  },
];

interface RawPerson {
  id: number;
  name?: string | null;
  designation?: string | null;
  designation_category?: string | null;
  data_type?: string | null;
  has_email?: boolean | null;
  phones?: string | null;
  is_verified?: boolean | null;
  source_name?: string | null;
}

function normalizePerson(raw: RawPerson): CompanyPerson {
  return {
    id: raw.id,
    name: raw.name ?? "",
    designation: raw.designation ?? "",
    designationCategory: raw.designation_category ?? "",
    hasEmail: Boolean(raw.has_email),
    email: null,
    phone: raw.phones ?? null,
    isVerified: Boolean(raw.is_verified),
    sourceName: raw.source_name ?? "",
  };
}

/**
 * Mirrors the webapp's "Contacts with email" tab (CompanyPeopleTab.jsx): the
 * people list filtered to data_type "people". Real email addresses aren't
 * included in that list — each one must be separately revealed via
 * getContactEmail, which appears to consume an account lookup credit (an
 * empty `email` alongside `has_email: true` came back from a live call
 * during development; a follow-up getContactEmail call for that same contact
 * returned the real address). revealLimit bounds how many of those reveal
 * calls a single tool invocation can make.
 */
export async function fetchCompanyPeople(
  orgno: string,
  opts: { revealEmails?: boolean; revealLimit?: number } = {},
): Promise<CompanyPeoplePayload & { source: "live" | "mock" }> {
  const revealEmails = opts.revealEmails ?? true;
  const revealLimit = Math.min(Math.max(opts.revealLimit ?? DEFAULT_REVEAL_LIMIT, 0), MAX_REVEAL_LIMIT);

  try {
    const json = await gqlRequest<{ getCompanyByOrgno?: { people?: RawPerson[] | null } | null }>(
      GET_COMPANY_PEOPLE_QUERY,
      { orgno },
    );
    const rawPeople = (json.data?.getCompanyByOrgno?.people ?? []).filter((p) => p.data_type === "people");
    const people = rawPeople.map(normalizePerson).sort((a, b) => Number(b.hasEmail) - Number(a.hasEmail));

    let revealedCount = 0;
    if (revealEmails) {
      for (const person of people) {
        if (revealedCount >= revealLimit) break;
        if (!person.hasEmail) continue;
        try {
          const emailJson = await gqlRequest<{ getContactEmail?: { email?: string | null } | null }>(
            GET_CONTACT_EMAIL_QUERY,
            { contact: { id: person.id, designation: person.designation } },
          );
          person.email = emailJson.data?.getContactEmail?.email ?? null;
          revealedCount += 1;
        } catch (err) {
          console.error(`Failed to reveal email for contact ${person.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return { orgno, people, totalCount: people.length, revealedCount, fetchedAt: new Date().toISOString(), source: "live" };
  } catch (err) {
    console.error(`Goava API unreachable, falling back to demo data: ${err instanceof Error ? err.message : String(err)}`);
    return {
      orgno,
      people: MOCK_PEOPLE,
      totalCount: MOCK_PEOPLE.length,
      revealedCount: 0,
      fetchedAt: new Date().toISOString(),
      source: "mock",
    };
  }
}
