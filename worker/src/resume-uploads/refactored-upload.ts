/**
 * 重构后的上传逻辑
 * 当 DIRECT_R2_UPLOAD=true 时使用 R2 存储 PDF，替代 D1 Base64
 */
import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { R2ArtifactStore } from '../resume-storage/r2-artifact-store';
import { generateObjectKey, generateArtifactId } from '../resume-storage/object-key';
import { createOrGetActiveJob } from '../resume-processing/job-repository';
import { EventRepository } from '../recruitment-events/repository';
import { buildResumeIngestionIdentity } from '../recruiting-operations/resume-ingestion';

export async function handleR2Upload(
  c: any,
  formData: FormData,
  parsedCandidateName: string,
  parsedPositionName: string,
  positionId: string | null,
  now: () => string
): Promise<Response> {
  const file = formData.get('file') as File | null;
  if (!file) {
    return c.json({ detail: '请上传简历文件' }, 400);
  }

  const fileBuffer = await file.arrayBuffer();
  const fileSize = file.size;
  const resumeId = crypto.randomUUID();
  const artifactId = generateArtifactId();
  const objectKey = generateObjectKey('pdf', resumeId, 1);
  const displayName = parsedCandidateName || file.name.replace(/\.pdf$/i, '');
  const fileSha256 = await sha256Hex(fileBuffer);
  const ingestion = buildResumeIngestionIdentity({ source: 'local_upload', fileSha256, receivedAt: now() });
  const existing = await c.env.DB.prepare(
    'SELECT id, candidate_name FROM resumes WHERE file_sha256 = ? OR resume_ingest_key = ? LIMIT 1',
  ).bind(fileSha256, ingestion.ingestKey).first<any>().catch(() => null);
  if (existing) {
    return c.json({ id: existing.id, candidate_name: existing.candidate_name, dedup: true, detail: '文件已存在，返回已有记录' }, 200);
  }

  // 1. 创建简历记录
  const mappedPos = positionId || parsedPositionName || '';
  await c.env.DB.prepare(`
    INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, parse_status, file_sha256, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    resumeId,
    displayName,
    mappedPos,
    mappedPos,
    JSON.stringify({ name: displayName }),
    '',
    'pending_screening',
    fileSha256,
    ingestion.receivedAt,
    ingestion.source,
    ingestion.sourceRecordId,
    ingestion.ingestKey,
    now()
  ).run();

  // 2. 写入 R2
  const r2Store = new R2ArtifactStore(c.env.RESUME_ARTIFACTS);
  await r2Store.put({
    resumeId,
    type: 'pdf',
    objectKey,
    contentType: 'application/pdf',
    content: fileBuffer,
    byteSize: fileSize,
    version: 1,
  });

  // 3. 创建 artifact 记录
  const artifactRepo = new ArtifactRepository(c.env.DB);
  await artifactRepo.insert({
    id: artifactId,
    resumeId,
    type: 'pdf',
    objectKey,
    bucket: 'ai-interview-resume-artifacts',
    contentType: 'application/pdf',
    byteSize: fileSize,
    version: 1,
  });

  // 注意：不写 resume_files (Base64) 表

  // 埋点
  if (typeof c.get === 'function') {
    await logOperation(c.env, {
      action: 'resume.create',
      entityType: 'resume',
      entityId: resumeId,
      actor: c.get('user')?.email,
      detail: JSON.stringify({ file: file.name, size: fileSize, candidate: displayName, storage: 'r2' }),
    }).catch(() => {});
  }

  // 4. 入队处理
  const job = await createOrGetActiveJob(c.env.DB, resumeId);
  await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId });

  // 5. 事件记录（当 RECRUITMENT_EVENTS=true 时）
  const eventsEnabled = (c.env.RECRUITMENT_EVENTS || '').toLowerCase() === 'true';
  if (eventsEnabled) {
    const eventRepo = new EventRepository(c.env.DB);
    await eventRepo.append({
      resumeId,
      positionId: positionId || undefined,
      stage: 'resume_received',
      action: 'upload',
      source: 'manual',
      dedupeKey: `manual:${resumeId}:resume_received:upload`,
      metadata: { filename: file.name, fileSize },
    }).catch(() => {});
  }

  return c.json({
    id: resumeId,
    job_id: job.id,
    candidate_name: displayName,
    parse_status: 'queued',
    detail: '简历已入队（R2 存储），正在后台处理',
  }, 202);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 从 index.ts 复用的 logOperation 和 bitable 相关函数
// 这些通过 index.ts 中的全局函数调用
async function logOperation(env: any, data: any): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO operation_logs (id, action, entity_type, entity_id, actor, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      data.action || 'unknown',
      data.entityType || 'unknown',
      data.entityId || '',
      data.actor || 'unknown',
      data.detail || '',
    ).run();
  } catch {}
}
