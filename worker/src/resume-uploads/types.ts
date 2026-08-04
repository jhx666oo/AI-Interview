export interface InitUploadRequest {
  originalFilename: string;
  fileSize: number;
  fileSha256: string;
  extractedText?: string;
  extractedTextSize?: number;
  extractedTextSha256?: string;
}

export interface InitUploadResponse {
  uploadId: string;
  resumeId: string;
  presignedUrl: string;
  pdfObjectKey: string;
  textObjectKey?: string;
  expiresInSeconds: number;
}

export interface CompleteUploadResponse {
  resumeId: string;
  jobId: string;
  status: 'completed';
}

export interface UploadSession {
  id: string;
  resumeId: string;
  pdfArtifactId: string;
  textArtifactId?: string;
  createdBy: string;
  originalFilename: string;
  expectedPdfSize: number;
  expectedPdfSha256: string;
  status: 'initiated' | 'completed' | 'expired' | 'failed';
  errorCode?: string;
  jobId?: string;
  expiresAt: string;
  createdAt: string;
}
