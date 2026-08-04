export interface SearchDocument {
  resumeId: string;
  version: number;
  markdown: string;
  generatedAt: string;
}

export interface SearchDocumentGenerator {
  generate(resumeId: string, ctx: { db: D1Database }): Promise<SearchDocument | null>;
}

export interface SearchIndexRequest {
  resumeId: string;
  version: number;
  document: string;
}
