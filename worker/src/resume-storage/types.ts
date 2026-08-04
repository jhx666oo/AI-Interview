/**
 * 简历存储核心类型定义
 * 对应架构设计中的 ResumeArtifactType, ResumeArtifactStatus 等契约
 */

export type ResumeArtifactType =
  | 'pdf'
  | 'ocr'
  | 'ai_analysis'
  | 'interview_report'
  | 'search_document';

export type ResumeArtifactStatus =
  | 'pending'
  | 'available'
  | 'expired'
  | 'deleted'
  | 'failed';

export interface ResumeArtifact {
  id: string;
  resumeId: string;
  type: ResumeArtifactType;
  objectKey: string;
  bucket: string;
  contentType: string;
  contentSha256?: string;
  byteSize: number;
  version: number;
  status: ResumeArtifactStatus;
  isCurrent: boolean;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PutArtifactInput {
  resumeId: string;
  type: ResumeArtifactType;
  objectKey: string;
  contentType: string;
  content: ArrayBuffer | ReadableStream;
  contentSha256?: string;
  byteSize: number;
  version?: number;
  expiresAt?: string;
}

export interface StoredArtifactObject {
  objectKey: string;
  version: number;
  byteSize: number;
  contentSha256?: string;
}

export interface ResumeArtifactStore {
  put(input: PutArtifactInput): Promise<StoredArtifactObject>;
  get(objectKey: string): Promise<R2ObjectBody | null>;
  head(objectKey: string): Promise<R2Object | null>;
  delete(objectKey: string): Promise<void>;
}

export interface ResumeTextRepository {
  getCurrent(resumeId: string): Promise<{ text: string; artifactId?: string; source: 'r2' | 'legacy_d1' } | null>;
  putVersion(input: { resumeId: string; text: string; source: string; version: number }): Promise<string>;
}

export interface ResumeAnalysisRepository {
  getCurrent(resumeId: string): Promise<Record<string, unknown> | null>;
  putVersion(input: { resumeId: string; analysis: Record<string, unknown>; model: string; promptVersion: string; version: number }): Promise<string>;
}

export interface ResumeSearchQuery {
  query: string;
  filters?: {
    positionId?: string;
    responsiblePerson?: string;
    dateFrom?: string;
    dateTo?: string;
    minScore?: number;
    maxScore?: number;
    degree?: string;
    gender?: string;
    minAge?: number;
    maxAge?: number;
  };
  page?: number;
  pageSize?: number;
}

export interface ResumeAccessScope {
  userId: string;
  role: string;
  ownerFilter?: string[];
}

export interface ResumeSearchPage {
  results: Array<{ resumeId: string; score: number; snippet?: string }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface ResumeSearchHealth {
  healthy: boolean;
  indexCount?: number;
  pendingCount?: number;
  lastError?: string;
}

export interface ResumeSearchService {
  search(input: ResumeSearchQuery, scope: ResumeAccessScope): Promise<ResumeSearchPage>;
  requestIndex(resumeId: string, version: number): Promise<void>;
  requestDelete(resumeId: string): Promise<void>;
  getHealth(): Promise<ResumeSearchHealth>;
}
