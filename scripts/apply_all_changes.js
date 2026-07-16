const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'worker', 'src', 'index.ts');
let src = fs.readFileSync(filePath, 'utf8');

// ============== Change 1: Add getResumeText + fix PDF upload + auto-evaluate endpoints ==============

// Find where to insert getResumeText - before "notifyInterviewersForCandidate"
const notifyPos = src.indexOf('async function notifyInterviewersForCandidate');
const getResumeTextFn = `
/**
 * 获取简历原文（多维尝试）
 * 1. resume_markdown
 * 2. raw_text
 * 3. 从 resume_files 表取 PDF base64 → 用 AI 提取文本
 * 4. 兜底：仅返回基本信息汇总
 */
async function getResumeText(env: Env, candidateName: string): Promise<string> {
  try {
    const d1Row = await env.DB.prepare(
      'SELECT resume_markdown, raw_text, id FROM resumes WHERE candidate_name = ? LIMIT 1'
    ).bind(candidateName).first() as any;
    if (d1Row?.resume_markdown) return d1Row.resume_markdown;
    if (d1Row?.raw_text) return d1Row.raw_text;
    if (d1Row?.id) {
      const fileRow = await env.DB.prepare(
        'SELECT content, file_name FROM resume_files WHERE id = ? LIMIT 1'
      ).bind(d1Row.id).first() as any;
      if (fileRow?.content) {
        const base64Content = fileRow.content.substring(0, 100000);
        try {
          const extraction = await callAI(env,
            'You are a PDF text extractor. Extract ALL readable text from this base64 PDF content. Return ONLY the extracted text, no explanations.',
            'Extract resume text from this base64 PDF (' + (fileRow.file_name || 'resume.pdf') + '):\\n\\n' + base64Content,
            'deepseek-chat'
          );
          if (extraction && extraction.length > 50) {
            try {
              await env.DB.prepare('UPDATE resumes SET raw_text = ? WHERE id = ?')
                .bind(extraction, d1Row.id).run();
            } catch {}
            return extraction;
          }
        } catch {}
      }
    }
    try {
      const tableId = getBitableTableId(env, 'talent');
      const records = await bitableListRecords(env, tableId);
      const rec = records.find((r: any) => {
        const f = r.fields || {};
        return getFirstValue(f['姓名']) === candidateName;
      });
      if (rec) {
        const f = rec.fields || {};
        const parts: string[] = [];
        if (getFirstValue(f['姓名'])) parts.push('姓名: ' + getFirstValue(f['姓名']));
        if (getFirstValue(f['性别'])) parts.push('性别: ' + getFirstValue(f['性别']));
        if (f['年龄']) parts.push('年龄: ' + f['年龄']);
        if (getFirstValue(f['学历'])) parts.push('学历: ' + getFirstValue(f['学历']));
        if (getFirstValue(f['学校'])) parts.push('学校: ' + getFirstValue(f['学校']));
        if (getFirstValue(f['专业'])) parts.push('专业: ' + getFirstValue(f['专业']));
        if (getFirstValue(f['优势分析'])) parts.push('\\n优势分析:\\n' + getFirstValue(f['优势分析']));
        if (getFirstValue(f['风险点'])) parts.push('\\n风险点:\\n' + getFirstValue(f['风险点']));
        if (parts.length > 0) return parts.join('\\n');
      }
    } catch {}
  } catch {}
  return candidateName + ' - 无法获取简历原文';
}

`;

src = src.substring(0, notifyPos) + getResumeTextFn + src.substring(notifyPos);

// ============== Change 2: Add auto-evaluate endpoints after the last function before app.notFound ==============

const notFoundPos = src.indexOf("app.notFound((c) =>");
const autoEvalEndpoints = `
// ==================== 自动 AI 评估端点 ====================

app.post('/api/resumes/auto-evaluate', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const candidateName = body.candidate_name || '';
    if (!candidateName) return c.json({ detail: '需要提供候选人姓名' }, 400);
    const resumeText = await getResumeText(c.env, candidateName);
    if (resumeText.length < 10) return c.json({ detail: '无法获取简历原文' }, 400);
    const evalResult = await callAIScreening(c.env, resumeText);
    if (!evalResult) return c.json({ detail: 'AI评估失败' }, 500);
    await c.env.DB.prepare('UPDATE resumes SET ai_evaluation = ?, updated_at = ? WHERE candidate_name = ?')
      .bind(JSON.stringify(evalResult), new Date().toISOString(), candidateName).run();
    try {
      const tableId = getBitableTableId(c.env, 'talent');
      const records = await bitableListRecords(c.env, tableId);
      const rec = records.find((r: any) => {
        const f = r.fields || {};
        return getFirstValue(f['姓名']) === candidateName;
      });
      if (rec) {
        await bitableUpdateRecord(c.env, tableId, rec.record_id, {
          'AI简历评估': JSON.stringify(evalResult, null, 2),
        });
      }
    } catch {}
    return c.json({ ok: true, candidate_name: candidateName, dimensions: evalResult.dimensions || [], overall_score: evalResult.overall_score, summary: evalResult.summary });
  } catch (e: any) {
    return c.json({ detail: '自动评估失败: ' + e.message }, 500);
  }
});

app.post('/api/resumes/auto-evaluate-all', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const force = body.force === true;
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    let myPositions: string[] = [];
    if (user.role !== 'admin' && user.full_name) {
      const posRows = await c.env.DB.prepare(
        'SELECT DISTINCT title FROM positions WHERE (responsible_person = ? OR responsible_person LIKE ?)'
      ).bind(user.full_name, '%' + user.full_name + '%').all();
      for (const row of (posRows.results || [])) myPositions.push((row as any).title);
    }
    let evaluated = 0, skipped = 0, failed = 0;
    const errors: string[] = [], results: any[] = [];
    for (const rec of records) {
      const f = rec.fields || {};
      const candidateName = getFirstValue(f['姓名']) || 'Unknown';
      const position = getFirstValue(f['面试岗位']) || getFirstValue(f['招聘岗位匹配']) || '';
      const existingEval = f['AI简历评估'];
      if (user.role !== 'admin' && user.full_name && myPositions.length > 0 && !myPositions.includes(position)) continue;
      if (!force && existingEval && String(existingEval).trim().length > 10) { skipped++; continue; }
      try {
        const resumeText = await getResumeText(c.env, candidateName);
        if (resumeText.length < 10) { results.push({ name: candidateName, status: 'skip', reason: '无法获取简历原文' }); skipped++; continue; }
        const evalResult = await callAIScreening(c.env, resumeText);
        if (!evalResult) { results.push({ name: candidateName, status: 'fail', reason: 'AI评估返回空' }); failed++; continue; }
        try { await c.env.DB.prepare('UPDATE resumes SET ai_evaluation = ?, raw_text = ?, updated_at = ? WHERE candidate_name = ?').bind(JSON.stringify(evalResult), resumeText.substring(0, 50000), new Date().toISOString(), candidateName).run(); } catch {}
        try { await bitableUpdateRecord(c.env, tableId, rec.record_id, { 'AI简历评估': JSON.stringify(evalResult, null, 2), '简历文本': resumeText.substring(0, 50000) }); } catch {}
        results.push({ name: candidateName, status: 'ok', dims: (evalResult.dimensions || []).length, score: evalResult.overall_score });
        evaluated++;
      } catch (e: any) { failed++; errors.push(candidateName + ': ' + e.message.substring(0, 100)); }
    }
    return c.json({ ok: true, total: records.length, evaluated, skipped, failed, results, errors: errors.slice(0, 20) });
  } catch (e: any) { return c.json({ detail: '批量自动评估失败: ' + e.message }, 500); }
});

`;

src = src.substring(0, notFoundPos) + autoEvalEndpoints + src.substring(notFoundPos);

// ============== Change 3: Fix PDF upload - add full resume text extraction ==============

// Find the PDF upload section - the part that sends base64 to AI
const uploadAiParseSection = src.indexOf('// 用 base64 数据作为 PDF 内容发送给 AI');
const uploadResumeTextSection = src.indexOf("// 6. 自动进行维度 AI 评估（异步，不阻塞返回）");

if (uploadAiParseSection > 0 && uploadResumeTextSection > 0) {
  // Add resume text extraction after AI parsing
  const textToInsert = `
      // 4. 提取完整简历文本并保存到 DB（首次上传时）
      let fullResumeText = '';
      try {
        fullResumeText = await callAI(c.env,
          '你是一个简历文本提取器。从下方base64编码的PDF中提取所有可读的简历文本内容，只输出原文，不要解释。',
          '提取这个PDF简历中的所有文本（base64编码）：\\n\\n' + fileBase64.substring(0, 80000),
          'deepseek-chat'
        );
        if (fullResumeText && fullResumeText.length > 20) {
          await c.env.DB.prepare('UPDATE resumes SET raw_text = ? WHERE candidate_name = ?')
            .bind(fullResumeText.substring(0, 50000), parsedName || fileNameWithoutExt).run().catch(() => {});
        } else { fullResumeText = ''; }
      } catch { fullResumeText = ''; }

      // 5. 自动进行维度 AI 评估（使用完整简历文本，兜底用基础信息）
      const evalText = fullResumeText || [\`姓名: \${parsedName || fileNameWithoutExt}\``;

  // Replace "// 6. 自动进行维度 AI 评估（异步，不阻塞返回）" with our version
  src = src.replace("// 6. 自动进行维度 AI 评估（异步，不阻塞返回）", textToInsert);
}

// ============== Change 4: Modify GET /api/positions to filter by user ==============

const positionsEndpoint = 'app.get(\'/api/positions\', authMiddleware, async (c) => {';
const positionsPos = src.indexOf(positionsEndpoint);
if (positionsPos > 0) {
  const oldPositions = `app.get('/api/positions', authMiddleware, async (c) => {
  const user = c.get('user');
  const titleFilter = c.req.query('title');
  const statusFilter = c.req.query('status');
  let sql = 'SELECT * FROM positions WHERE id IN (SELECT MIN(id) FROM positions';
  const binds: any[] = [];
  if (statusFilter) {
    sql += ' WHERE status = ?';
    binds.push(statusFilter);
  }
  sql += ' GROUP BY title)';
  if (titleFilter) {
    sql += ' AND title LIKE ?';
    binds.push('%' + titleFilter + '%');
  }
  sql += ' ORDER BY created_at DESC';
  const result = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(result.results.map(transformRow));
});`;

  const newPositions = `app.get('/api/positions', authMiddleware, async (c) => {
  const user = c.get('user');
  const titleFilter = c.req.query('title');
  const statusFilter = c.req.query('status');
  let sql = 'SELECT * FROM positions WHERE id IN (SELECT MIN(id) FROM positions';
  const binds: any[] = [];
  const conditions: string[] = [];
  if (statusFilter) {
    conditions.push('status = ?');
    binds.push(statusFilter);
  }
  sql += (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
  sql += ' GROUP BY title)';
  // 非管理员只能看到自己负责的岗位
  if (user.role !== 'admin' && user.full_name) {
    sql += ' AND (responsible_person = ? OR responsible_person LIKE ?)';
    binds.push(user.full_name, '%' + user.full_name + '%');
  }
  if (titleFilter) {
    sql += ' AND title LIKE ?';
    binds.push('%' + titleFilter + '%');
  }
  sql += ' ORDER BY created_at DESC';
  const result = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(result.results.map(transformRow));
});`;

  src = src.replace(oldPositions, newPositions);
}

// ============== Change 5: Modify GET /api/resumes to filter by user ==============

const resumesEndpoint = "app.get('/api/resumes', authMiddleware, async (c) => {";
const resumesPos = src.indexOf(resumesEndpoint);
if (resumesPos > 0) {
  // Find the body - from "const tableId" to just before "const nameFilter"
  const tableLinePos = src.indexOf('const tableId = getBitableTableId(c.env, \'talent\');', resumesPos);
  const nameFilterPos = src.indexOf('const nameFilter = c.req.query(\'candidate_name\');', tableLinePos);
  
  if (tableLinePos > 0 && nameFilterPos > 0) {
    const oldContent = src.substring(tableLinePos, nameFilterPos);
    const newContent = `const user = c.get('user');
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    let items = records.map(parseTalentRecord);

    // 非管理员：只显示自己负责岗位的简历
    if (user.role !== 'admin' && user.full_name) {
      const posRows = await c.env.DB.prepare(
        'SELECT DISTINCT title FROM positions WHERE (responsible_person = ? OR responsible_person LIKE ?) AND status = ?'
      ).bind(user.full_name, '%' + user.full_name + '%', 'open').all();
      const myPositions: string[] = [];
      for (const row of (posRows.results || [])) myPositions.push((row as any).title);
      const mapRows = await c.env.DB.prepare(
        'SELECT DISTINCT mapped_name FROM position_mappings WHERE (responsible_person = ? OR responsible_person LIKE ?)'
      ).bind(user.full_name, '%' + user.full_name + '%').all();
      for (const row of (mapRows.results || [])) myPositions.push((row as any).mapped_name);
      const posSet = new Set(myPositions.map((p: string) => p.trim().toLowerCase()));
      items = items.filter((i: any) => { const pos = (i.mapped_position || i.position_applied || '').trim().toLowerCase(); return posSet.has(pos); });
    }

    const nameFilter = c.req.query('candidate_name');`;
    
    src = src.replace(oldContent, newContent);
  }
}

// ============== Change 6: Modify dashboard overview to filter by user ==============

const dashEndpoint = "app.get('/api/dashboard/overview', authMiddleware, async (c) => {";
const dashPos = src.indexOf(dashEndpoint);
if (dashPos > 0) {
  // Find the reqRecords filter section
  const reqLoopPos = src.indexOf("for (const r of reqRecords) {", dashPos);
  const nextSectionPos = src.indexOf("// 处理人才库", dashPos);
  
  if (reqLoopPos > 0 && nextSectionPos > reqLoopPos) {
    // Insert user filtering before the loop
    const talentLoopPos = src.indexOf("for (const r of talentRecords) {", nextSectionPos);
    
    // Add myPositions query
    const dashInsert = `    // 非管理员：先查出自己的岗位列表
    let myPositions: string[] = [];
    if (user.role !== 'admin' && user.full_name) {
      const posRows = await c.env.DB.prepare(
        'SELECT DISTINCT title FROM positions WHERE (responsible_person = ? OR responsible_person LIKE ?)'
      ).bind(user.full_name, '%' + user.full_name + '%').all();
      for (const row of (posRows.results || [])) myPositions.push((row as any).title);
    }

    for (const r of reqRecords) {`;
    
    src = src.replace("for (const r of reqRecords) {", dashInsert);
    
    // Now find and modify the req filter - after the if (status === '招聘中') block, there should be a `}` closing the for loop
    // And then the talent loop starts
    
    // Add filter in the reqRecords loop - after "div.positions.push(title);"
    const pushTitlePos = src.indexOf("div.positions.push(title);", dashPos);
    if (pushTitlePos > 0) {
      const userFilterInsert = `
      // 非管理员：跳过非自己负责的岗位
      if (user.role !== 'admin' && user.full_name && myPositions.length > 0) {
        if (!myPositions.includes(title)) continue;
      }
`;
      src = src.substring(0, pushTitlePos) + userFilterInsert + src.substring(pushTitlePos);
    }
    
    // Add filter in talentRecords loop
    const posFieldPos = src.indexOf("const pos = String(getFirstValue(f['面试岗位'])", nextSectionPos);
    if (posFieldPos > 0) {
      const talentInsert = `const pos = String(getFirstValue(f['面试岗位']) || getFirstValue(f['招聘岗位匹配']) || '');
      // 非管理员：只统计自己负责岗位的简历
      if (user.role !== 'admin' && user.full_name && myPositions.length > 0) {
        if (!myPositions.includes(pos)) continue;
      }
`;
      src = src.substring(0, posFieldPos) + talentInsert + src.substring(posFieldPos + src.substring(posFieldPos).indexOf(';') + 1);
    }
  }
}

// ============== Change 7: Add fix-responsible endpoint ==============

const fixEndpoint = `
// 修复 position_mappings 中 responsible_person 字段（可能是对象而非字符串）
app.post('/api/position-mappings/fix-responsible', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const rows = await c.env.DB.prepare('SELECT id, mapped_name, responsible_person FROM position_mappings').all();
    let fixed = 0;
    for (const row of (rows.results || [])) {
      const r = row as any;
      let person = r.responsible_person;
      if (person && typeof person === 'object') {
        try {
          const parsed = typeof person === 'string' ? JSON.parse(person) : person;
          if (parsed.name) person = parsed.name;
          else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) person = parsed[0].name;
          else person = String(parsed);
        } catch { person = String(person); }
        await c.env.DB.prepare('UPDATE position_mappings SET responsible_person = ? WHERE id = ?').bind(person, r.id).run();
        fixed++;
      }
    }
    return c.json({ ok: true, fixed });
  } catch (e: any) { return c.json({ detail: e.message }, 500); }
});
`;

// Insert fix endpoint before app.notFound
src = src.replace("app.notFound((c) => {", fixEndpoint + "\napp.notFound((c) => {");

// Write result
fs.writeFileSync(filePath, src);
console.log('All changes applied successfully');
console.log('File size:', src.length, 'bytes');
