#!/usr/bin/env python3
"""
AI Interview — 简历解析 & AI 初筛提示词文档

本文件提取了系统 AI 解析流程的核心提示词（prompt），
展示从 PDF 简历到结构化字段再到 AI 初筛评分的技术链路。

流程：
  前端上传 PDF → Worker 存储 → PDF文本提取(前端pdfjs-dist) → AI 字段解析 → AI 初筛评分

注意：本文件仅用于提示词展示和离线测试，实际生产调用在 Cloudflare Worker 中。
"""

import json

# ========================================================================
# 第一部分：PDF → 文本提取（前端完成）
# ========================================================================

# 前端使用 pdfjs-dist 提取 PDF 文本内容，然后以 POST form-data 形式
# 上传 file + 文本到 Worker。Worker 写库后投递到异步处理队列。
# 
# 生产调用：
#   POST /api/resumes  →  HTTP 202 Accepted
#   返回 resume_id，后台异步处理

# ========================================================================
# 第二部分：字段提取提示词（AI 从简历文本中提取结构化信息）
# ========================================================================

FIELD_EXTRACT_PROMPT = {
    "system": """你是一个简历解析助手。请从简历文本中提取以下字段，用 JSON 返回。重视教育背景部分。找不到的设为 null。

{
  "highest_degree": "最高学历(本科/硕士/博士)",
  "school": "毕业院校全称",
  "major": "专业全称",
  "years_of_experience": "工作年限数字",
  "recent_company": "最近公司",
  "current_position": "最近职位",
  "phone": "手机号",
  "email": "邮箱",
  "skills": ["技能1", "技能2"],
  "self_evaluation": "自我评价"
}""",
    "description": "用于批量 AI 评估时，先从简历文本中提取结构化字段（如学历、学校、专业、工作年限等）",
    "model": "deepseek-chat",
    "used_in": "batch-auto-screen"
}

# ========================================================================
# 第三部分：完整简历解析 + AI 初筛提示词（核心 Prompt）
# ========================================================================

RESUME_PARSE_AND_SCREEN_PROMPT = {
    "system": """你是一位资深招聘专家和简历解析助手。请解析以下简历文本，提取完整信息并进行AI初筛评估。返回JSON格式（不要加markdown代码块），包含三部分：

第一部分 - 基础信息：
- candidate_name: 候选人姓名（全名）
- gender: 性别（男/女）
- age: 年龄（数字）
- phone: 手机号码
- email: 电子邮箱
- highest_degree: 最高学历
- school: 毕业院校
- major: 专业
- graduation_year: 毕业年份
- years_of_experience: 工作年限（数字）
- current_company: 目前/最近所在公司
- current_position: 目前/最近职位
- salary_expectation: 期望薪资（如果有）
- skills: 技能列表（数组）
- certifications: 证书/资质（数组）
- work_experience: 工作经历数组，每个包含 { company, title, duration, description, achievements }
- education: 教育经历数组，每个包含 { school, degree, major, duration }

第二部分 - AI初筛评估：
- position: 应聘岗位
- advantage (优势分析): 用中文描述3-5个核心优势
- risk (风险点/劣势分析): 用中文描述2-4个劣势或风险
- match_score: 人岗匹配度（0-100的整数）
- recommendation: 推荐建议（"strongly_recommend"/"recommend"/"neutral"/"not_recommend"/"strongly_not_recommend"）
- summary: 综合分析摘要（中文，2-3句话）
- suggested_questions: 建议面试问题（中文，3-5个）
- dimensions: 能力维度评分数组，每个包含 { name, score(0-5), reason }

第三部分 - 个性化需求匹配（如果岗位有个性化需求）：
- personalized_match_score: 个性化需求匹配度（0-100的整数）
- personalized_met_items: 已满足的个性化需求列表（数组）
- personalized_unmet_items: 未满足的个性化需求列表（数组）""",
    "user_template": """简历文本（请提取完整信息）：
{resume_text}

【应聘岗位：{position_title}】
岗位职责：
{position_description}

岗位要求：
{position_requirements}

个性化要求：
{personalized_requirements}

能力维度（需要逐项评估）：
{capability_dimensions}""",
    "output_format": "JSON（无 markdown 代码块）",
    "model": "deepseek-v4-flash",
    "used_in": "upload, reparse, single-screen"
}

# 上面 prompt 的简化版（用于"重新解析"场景，无岗位上下文时使用）
RESUME_REPARSE_PROMPT = {
    "system": """你是一位资深招聘专家和简历解析助手。请解析以下简历文本，提取完整信息并进行AI初筛评估。返回JSON格式（不要加markdown代码块），包含两部分：

第一部分 - 基础信息：
- candidate_name: 候选人姓名（全名）
- gender: 性别（男/女）
- age: 年龄（数字）
- phone: 手机号码
- email: 电子邮箱
- highest_degree: 最高学历
- school: 毕业院校
- major: 专业
- graduation_year: 毕业年份
- years_of_experience: 工作年限（数字）
- current_company: 目前/最近所在公司
- current_position: 目前/最近职位
- salary_expectation: 期望薪资（如果有）
- skills: 技能列表（数组）
- certifications: 证书/资质（数组）
- work_experience: 工作经历数组，每个包含 { company, title, duration, description, achievements }
- education: 教育经历数组，每个包含 { school, degree, major, duration }

第二部分 - AI初筛评估：
- position: 应聘岗位（从文件名或文本中提取）
- advantage (优势分析): 用中文描述3-5个核心优势
- risk (风险点/劣势分析): 用中文描述2-4个劣势或风险
- match_score: 人岗匹配度（0-100的整数）
- recommendation: 推荐建议（"strongly_recommend"/"recommend"/"neutral"/"not_recommend"/"strongly_not_recommend"）
- summary: 综合分析摘要（中文，2-3句话）
- suggested_questions: 建议面试问题（中文，3-5个）""",
    "description": "无岗位上下文时的简化版，用于重新解析已有简历",
    "model": "deepseek-v4-flash",
    "used_in": "reparse (no position context)"
}

# ========================================================================
# 第四部分：AI 初筛评分（已有结构化字段 + 简历全文 + 岗位要求）
# ========================================================================

AI_SCREENING_EVALUATE_PROMPT = {
    "system": """你是一位资深的 HR 招聘评估 AI。请基于「候选人结构化信息 + 简历全文 + 岗位要求 + 能力维度 + 个性化要求」进行综合评估，用中文返回 JSON 对象：

- match_score: 人岗匹配度整数 0-100
- recommendation: 推荐建议，取值 "strongly_recommend" / "recommend" / "neutral" / "not_recommend" / "strongly_not_recommend"
- summary: 候选人综合摘要（中文，2-3 句）
- strengths: 3-5 个核心优势（中文数组）
- risks: 2-4 个潜在风险（中文数组）
- suggested_questions: 3-5 个建议面试问题（中文数组）
- dimensions: 能力维度评分明细数组，必须依据岗位给出的「能力维度」逐条打分。每个元素格式：
  { "name": "维度名称（与岗位能力维度保持一致）", "score": 0-5 的整数, "reason": "打分依据（中文，1-2 句）" }
  若岗位未提供能力维度，则基于岗位通用要求自行归纳 3-5 个关键维度打分。""",
    "user_template": """Job Position:
Title: {standard_position}
Salary: {salary_range}
Department: 
Description: 
Requirements: 

Capability Dimensions (能力维度):
{capability_dimensions}

Personalized Requirements (个性化要求):
{personalized_requirements}

候选人结构化信息（已解析字段）：
- 姓名：{name}
- 学历：{highest_degree}（{school} {major}）
- 工作年限：{years_of_experience}年
- 最近公司：{recent_company} / {current_position}
- 技能：{skills}
- 优势：{advantage}
- 风险点：{risk}

Candidate Resume (full text):
{resume_text}

Please analyze and return the JSON assessment.""",
    "model": "deepseek-v4-flash",
    "used_in": "batch-auto-screen, single-screen"
}

# ========================================================================
# 第五部分：能力维度打分（简版，用于上传时即时评分）
# ========================================================================

DIMENSION_SCORING_PROMPT = {
    "system": "你是一位资深的 HR 招聘评估 AI。请按岗位能力维度逐条 0-5 打分，用中文返回 JSON：{match_score:0-100,recommendation,summary,strengths:[],risks:[],suggested_questions:[],dimensions:[{name,score,reason}]}。",
    "user_template": """【岗位】{position_name}
【能力维度】{capability_dimensions}

【简历全文】
{resume_text}""",
    "model": "deepseek-v4-flash",
    "used_in": "upload (immediate scoring)"
}

# ========================================================================
# 第六部分：AI 调用方式（system + user 双 prompt 结构）
# ========================================================================

def build_ai_messages(system_prompt: str, user_prompt: str) -> list:
    """
    构建发送给 AI 的 messages 数组。
    所有场景都使用 system + user 双 prompt 结构，不传历史消息。
    """
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def call_ai_payload(system_prompt: str, user_prompt: str, model: str = "deepseek-chat") -> dict:
    """
    构造发送给 DeepSeek API 的请求体。
    """
    return {
        "model": model,
        "messages": build_ai_messages(system_prompt, user_prompt),
        "max_tokens": 4096,
    }


# ========================================================================
# 第七部分：完整处理流程演示
# ========================================================================

def simulate_full_flow(resume_text: str, position_context: dict = None):
    """
    模拟完整的简历解析 + AI 初筛流程，输出每一步的 prompt。
    
    Args:
        resume_text: 从 PDF 提取的简历文本
        position_context: 岗位上下文，包含：
            - position_title: 岗位名称
            - description: 岗位职责
            - requirements: 岗位要求
            - personalized_requirements: 个性化要求
            - capability_dimensions: 能力维度列表
    """
    print("=" * 60)
    print("📄 简历 AI 解析流程")
    print("=" * 60)
    print()

    # Step 1: 字段提取
    print("─" * 40)
    print("第一步：AI 字段提取（从简历文本提取结构化信息）")
    print("─" * 40)
    print(f"Model: {FIELD_EXTRACT_PROMPT['model']}")
    print(f"System Prompt:\n{FIELD_EXTRACT_PROMPT['system']}")
    print()
    payload = call_ai_payload(FIELD_EXTRACT_PROMPT['system'], resume_text[:200] + "...[truncated]")
    print(f"API Payload:\n{json.dumps(payload, ensure_ascii=False, indent=2)}")
    print()

    # Step 2: AI 初筛评分（如果有岗位上下文）
    if position_context:
        print("─" * 40)
        print("第二步：AI 初筛评分")
        print("─" * 40)
        prompt = AI_SCREENING_EVALUATE_PROMPT
        user_prompt = prompt['user_template'].format(
            standard_position=position_context.get('position_title', ''),
            salary_range=position_context.get('salary_range', ''),
            capability_dimensions='\n'.join(
                f"  - {d['name']}: {d.get('description', '')}"
                for d in (position_context.get('capability_dimensions') or [])
            ) if position_context.get('capability_dimensions') else '无',
            personalized_requirements=position_context.get('personalized_requirements', '无'),
            name='[从前端或文件名提取]',
            highest_degree='[AI 提取]',
            school='[AI 提取]',
            major='[AI 提取]',
            years_of_experience='[AI 提取]',
            recent_company='[AI 提取]',
            current_position='[AI 提取]',
            skills='[AI 提取]',
            advantage='[AI 提取]',
            risk='[AI 提取]',
            resume_text=resume_text[:500] + "...[truncated]",
        )
        print(f"Model: {prompt['model']}")
        print(f"System Prompt:\n{prompt['system']}")
        print()
        print(f"User Prompt:\n{user_prompt[:2000]}")
        print()
        payload = call_ai_payload(prompt['system'], user_prompt, prompt['model'])
        print(f"API Payload:\n{json.dumps(payload, ensure_ascii=False, indent=2)[:500]}...")

    # 返回所有的 prompt 供参考
    print()
    print("=" * 60)
    print("✅ 提示词汇总")
    print("=" * 60)
    return {
        "field_extract": FIELD_EXTRACT_PROMPT,
        "parse_and_screen": RESUME_PARSE_AND_SCREEN_PROMPT,
        "ai_evaluate": AI_SCREENING_EVALUATE_PROMPT,
        "reparse": RESUME_REPARSE_PROMPT,
        "dimension_scoring": DIMENSION_SCORING_PROMPT,
    }


# ========================================================================
# 第八部分：AI 返回结果解析逻辑
# ========================================================================

def extract_json(text: str) -> str:
    """
    从 AI 响应中提取 JSON。
    兼容多种格式：纯 JSON、带 ```json 代码块、嵌套对象。
    """
    text = text.strip()

    # 尝试解析 ```json ... ``` 代码块
    import re
    json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
    if json_match:
        return json_match.group(1).strip()

    # 尝试直接解析为 JSON
    if text.startswith('{'):
        return text

    # 尝试找到第一个 { 到最后一个 }
    brace_start = text.find('{')
    brace_end = text.rfind('}')
    if brace_start >= 0 and brace_end > brace_start:
        return text[brace_start:brace_end + 1]

    return text


def normalize_parsed_data(parsed: dict) -> dict:
    """
    归一化 AI 返回的字段名（兼容新旧格式）。
    """
    normalized = dict(parsed)

    # 展平嵌套对象（某些 AI 模型将基础信息/AI评估包装为子对象）
    for key, value in list(normalized.items()):
        if isinstance(value, dict) and not key.startswith('_'):
            normalized.update(value)

    # 字段名映射
    field_mapping = {
        'education': 'highest_degree',         # 某些模型返回 education 字段
        'work_years': 'years_of_experience',    # 旧版字段名
        'current_company': 'recent_company',    # 旧版字段名
    }
    for old_key, new_key in field_mapping.items():
        if old_key in normalized and new_key not in normalized:
            normalized[new_key] = normalized.pop(old_key)

    return normalized


def parse_screening_result(recommendation: str) -> str:
    """
    将 recommendation 映射为中文屏幕标签。
    """
    mapping = {
        'strongly_recommend': '强烈推荐',
        'recommend': '推荐',
        'neutral': '待定',
        'not_recommend': '不推荐',
        'strongly_not_recommend': '强烈不推荐',
    }
    return mapping.get(recommendation, recommendation)


# ========================================================================
# 使用示例
# ========================================================================

if __name__ == '__main__':
    # 模拟简历文本
    demo_resume = """
    姓名：张三
    性别：男
    年龄：28岁
    手机：13800138000
    邮箱：zhangsan@example.com
    学历：本科 - 华中科技大学 - 计算机科学与技术
    毕业时间：2019年
    工作年限：5年

    工作经历：
    2022-2025  字节跳动  高级后端工程师
    负责招聘平台微服务架构设计和开发，日活百万级
    主导简历解析系统的架构升级，将处理延迟降低60%

    2019-2022  阿里巴巴  后端工程师
    参与电商平台订单系统开发
    负责高并发场景下的数据一致性保障

    技能：Python, Go, Java, Kubernetes, PostgreSQL, Redis, Elasticsearch

    证书：PMP, AWS Solutions Architect
    """

    # 模拟岗位上下文
    demo_position = {
        'position_title': '资深后端工程师（招聘平台方向）',
        'description': '负责招聘平台后端架构设计、核心模块开发，确保系统高可用、可扩展',
        'requirements': '5年以上后端开发经验，精通 Python/Go，有微服务架构经验，熟悉招聘业务者优先',
        'personalized_requirements': '有高并发系统设计经验，团队管理经验优先',
        'capability_dimensions': [
            {'name': '技术深度', 'description': '后端架构设计、核心代码能力'},
            {'name': '业务理解', 'description': '对招聘业务流程的理解程度'},
            {'name': '系统设计', 'description': '高并发、分布式系统设计能力'},
            {'name': '团队协作', 'description': '跨团队沟通、代码规范、文档能力'},
        ],
        'salary_range': '35K-50K',
    }

    simulate_full_flow(demo_resume, demo_position)
