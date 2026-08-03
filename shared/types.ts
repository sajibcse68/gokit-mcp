export interface Incident {
  id: string;
  threadId: string | null;
  text: string;
  district: string;
  category: string;
  municipality: string;
  area: string;
  createdOn: string;
  updatedOn: string;
  imageUrl: string | null;
  isEdited: boolean;
  isActive: boolean;
}

export interface IncidentsPayload {
  incidents: Incident[];
  totalCount: number;
  fetchedAt: string;
  /** "mock" means api.politiet.no was unreachable and this is fabricated demo data, not real incidents. */
  source: "live" | "mock";
}

export interface GetIncidentsArgs {
  category?: string;
  district?: string;
  limit?: number;
}

export interface NaceCategory {
  sniCode: string;
  sniText: string;
}

export interface CompanyShortInfo {
  orgno: string;
  name: string;
  title: string;
  description: string;
  imageUrl: string | null;
  /** Raw upstream format (YYYYMMDD), formatted for display client-side. */
  registrationDate: string | null;
  countryCode: string;
  website: string | null;
  primaryLineOfBusinessText: string;
  activityText: string;
  naceCategories: NaceCategory[];
}

export interface CompanyShortInfoPayload {
  company: CompanyShortInfo | null;
  fetchedAt: string;
  /** "mock" means the Goava API was unreachable and this is fabricated demo data, not a real company. */
  source: "live" | "mock";
}

export interface GetCompanyByOrgnoArgs {
  orgno: string;
}

export interface CompanyPerson {
  id: number;
  name: string;
  designation: string;
  designationCategory: string;
  /** True if an email is on file upstream — the address itself must be separately revealed (costs a lookup credit). */
  hasEmail: boolean;
  /** Populated only for entries revealed via the email-reveal step; null otherwise. */
  email: string | null;
  phone: string | null;
  isVerified: boolean;
  sourceName: string;
}

export interface CompanyPeoplePayload {
  orgno: string;
  people: CompanyPerson[];
  totalCount: number;
  /** How many of `people` had their email revealed (consumed a lookup credit) in this call. */
  revealedCount: number;
  fetchedAt: string;
  /** "mock" means the Goava API was unreachable and this is fabricated demo data, not real contacts. */
  source: "live" | "mock";
}

export interface GetCompanyPeopleArgs {
  orgno: string;
  /** Reveal real email addresses for contacts flagged as having one. Each reveal consumes an account lookup credit. Default: true. */
  revealEmails?: boolean;
  /** Max number of emails to reveal in one call (safety cap on credit usage). Default: 10, max: 25. */
  revealLimit?: number;
}
