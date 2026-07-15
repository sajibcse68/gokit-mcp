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
