import os
from typing import Dict, Any
from app.config.database import SessionLocal

# 默认提示词配置（仅在数据库为空时使用）
DEFAULT_PROMPTS = {
    "prompts": {
        "analyze_resume": {
            "system": "你是一个专业的招聘专家，擅长简历分析和人岗匹配。请严格按照JSON格式返回结果，不要添加任何额外的文字。",
            "user": """请分析以下简历内容，并根据岗位描述进行匹配度评估。

## 主要应聘岗位
岗位描述:
{position_description}

## 其他相近岗位（请同时评估是否更适合这些岗位）
{other_positions}

简历内容:
{resume_text}

请严格按照以下JSON格式返回结果（不要添加任何额外的文字说明）：

{{
  "candidate_name": "候选人姓名",
  "contact": "联系方式",
  "email": "邮箱地址",
  "years_of_experience": 工作年限数字,
  "highest_degree": "最高学历",
  "school": "毕业院校",
  "major": "专业",
  "recent_company": "最近工作单位",
  "match_score": 主岗位匹配度评分0到100的数字,
  "screening_result": "passed或rejected或waitlist三选一",
  "ai_review": "AI评审意见，使用Markdown格式，必须包含三个部分：### ✅ 优势、### ⚠️ 不足、### 💡 综合建议",
  "other_position_matches": [
    {{
      "position_id": "岗位ID",
      "position_title": "岗位名称",
      "match_score": 匹配度评分0到100的数字,
      "is_better_match": true或false,
      "reason": "适合该岗位的简要原因"
    }}
  ]
}}

注意：
1. 如果主岗位匹配度低于60，但有其他岗位匹配度高于70，screening_result 必须设为 waitlist
2. other_position_matches 数组中列出候选人可能更适合的其他岗位
3. ai_review 必须使用Markdown格式，包含优势、不足、综合建议三个部分"""
        },
        "generate_resume_markdown": {
            "system": "你是一个专业的简历优化专家。",
            "user": """请将以下简历内容整理为 Markdown 格式，要求美观、易读、结构清晰。

简历内容:
{resume_text}

请包含以下部分（如果有）:
- 个人信息 (使用 H2 标题，如 ## 👤 个人信息)
- 教育背景 (使用 H2 标题，如 ## 🎓 教育背景)
- 工作经历 (使用 H2 标题，如 ## 💼 工作经历)
- 项目经历 (使用 H2 标题，如 ## 🚀 项目经历)
- 技能清单 (使用 H2 标题，如 ## 🛠 技能清单)
- 其他信息 (使用 H2 标题)

请直接返回 Markdown 文本，不要包含 Markdown 代码块标记（如 ```markdown ... ```）。"""
        },
        "generate_interview_questions": {
            "system": "你是一个资深的面试官。",
            "user": """请根据以下简历、岗位描述、参考题库以及面试类型，生成一套面试题。

岗位描述:
{position_description}

简历信息:
{resume_data}

参考题库内容 (如果有):
{question_bank_content}

面试类型: {interview_category}

请生成 {count} 道面试题，根据面试类型调整题目侧重点：
- HR面试：侧重综合素质、沟通能力、团队协作、职业规划、薪资期望等
- 技术面试：侧重专业技能、技术深度、问题解决能力、项目经验等
- 主管面试：侧重业务理解、团队管理、项目把控、跨部门协作等能力
- CEO面试：侧重战略思维、价值观匹配、行业洞察、长期发展潜力等
- 综合面试：全面考察技术能力、综合素质、发展潜力等各方面

包含:
- 题目标题 (简短概括，如项目名称或技术点)
- 题目内容 (详细的问题描述，简洁清晰，重点突出)
- 简历关联 (指出该问题关联简历中的哪段经历或技能)
- 参考答案 (包含理想回答要点、个人职责、技术决策、具体贡献)
- 评分标准 (优秀5分、良好4分、一般3分、较差2分 的具体标准)
- 追问方向 (2-3个追问问题)
- 难度 (junior/intermediate/senior)
- 类型 (technical/project/behavioral)

要求：
1. 题目内容要具体明确，避免宽泛的提问。
2. 如果是技术问题，最好结合候选人的项目经历进行提问。
3. 参考答案和评分标准要条理清晰，使用 Markdown 列表格式。
4. 根据面试类型调整题目内容和评分标准。

请返回 JSON 对象，格式如下：
{{
  "questions": [
    {{
      "title": "...",
      "content": "...",
      "resume_association": "...",
      "reference_answer": "...",
      "grading_criteria": "优秀(5分):...\\n良好(4分):...\\n一般(3分):...\\n较差(2分):...",
      "follow_up": ["追问1", "追问2"],
      "difficulty": "...",
      "type": "..."
    }}
  ]
}}"""
        },
        "generate_interview_evaluation": {
            "system": "你是一个资深的面试官，正在进行面试复盘和综合评估。",
            "user": """请根据以下面试详细信息，生成一份专业的面试综合评价报告。

### 1. 面试题目及标准
{questions}

### 2. 面试官评分概览
{scores}

### 3. 面试官详细评语 (按题目分组)
{panel_details}

### 4. 候选人回答录音转写 (部分题目可能有)
{transcripts}

### 5. 综合总分
{total_score}

请综合考虑面试官的评分、具体评语以及候选人的实际回答内容（如果有转写文本），生成一份客观、全面的评价。

**要求**：
1. **综合分析**：不要仅复述分数，要结合评语和候选人回答内容分析其技术深度、表达能力和项目经验。
2. **回答质量评估**：如果提供了候选人的回答转写，请特别点评其回答的逻辑性、准确性和完整性。
3. **优缺点总结**：明确列出候选人的主要优势和待改进之处。
4. **最终建议**：给出明确的录用建议。

请返回 JSON 格式，包含:
- evaluation: 综合评价内容 (Markdown 格式，包含 '### 🌟 综合表现'、'### 💬 回答质量点评'、'### ✅ 优势'、'### ⚠️ 不足' 四个部分)
- suggestion: 录用建议 (passed/rejected/waitlist)"""
        },
        "generate_interview_evaluation_from_transcript": {
            "system": "你是一个资深的面试官，正在进行面试复盘和综合评估。",
            "user": """请根据以下面试录音转写内容和面试官评价，生成一份专业的面试综合评价报告。

### 1. 面试录音转写
{transcript}

### 2. 面试官评价
{interviewer_evaluation}

### 3. 面试官评分
{interviewer_score} 分 (满分10分)

请综合分析候选人在面试中的表现，结合面试官的评价，生成一份客观、全面的评价报告。

**要求**：
1. **综合分析**：根据对话内容分析候选人的技术能力、沟通能力、逻辑思维等。
2. **回答质量评估**：点评候选人回答问题的逻辑性、准确性和完整性。
3. **优缺点总结**：明确列出候选人的主要优势和待改进之处。
4. **最终建议**：给出明确的录用建议。

请返回 JSON 格式，包含:
- evaluation: 综合评价内容 (Markdown 格式，包含 '### 🌟 综合表现'、'### 💬 回答质量点评'、'### ✅ 优势'、'### ⚠️ 不足' 四个部分)
- suggestion: 录用建议 (passed/rejected/waitlist)"""
        },
        "generate_coding_test_evaluation": {
            "system": "你是一个资深算法面试官，擅长评估候选人代码质量与算法能力。",
            "user": """请根据以下信息生成对候选人笔试代码的评价（面向面试复盘与录用决策）。

### 1. 题目
标题：{title}
描述：
{description}

### 2. 候选人代码
语言：{language}
代码：
{code}

### 3. 测试用例运行结果
{run_result}

请返回 JSON 对象，仅包含：
- evaluation: Markdown 文本，包含以下部分：
  - ### ✅ 正确性与边界情况
  - ### ⚙️ 复杂度与性能
  - ### 🧩 代码风格与可维护性
  - ### 💡 改进建议"""
        },
        "generate_jd": {
            "system": "你是一个专业的招聘专家，擅长撰写岗位描述和任职要求。",
            "user": """请根据以下信息，生成一份专业的岗位描述（JD）。

### 基本信息
- 岗位名称：{title}
- 所属部门：{department}
- 工作地点：{location}
- 薪资范围：{salary_range}
- 关键词/特殊要求：{keywords}

请返回 JSON 对象，包含以下字段：
- description: 岗位职责描述（使用 Markdown 格式，包含 5-8 条职责，每条以 "- " 开头）
- requirements: 任职要求（使用 Markdown 格式，包含学历、经验、技能等要求，分点列出）

要求：
1. 职责描述要具体、可量化，避免空泛的表述
2. 任职要求要明确学历、工作年限、核心技能等硬性条件
3. 根据岗位名称和关键词，添加相关的专业技能要求
4. 语言要专业、简洁，符合企业招聘风格"""
        }
    }
}


class PromptManager:
    _instance = None
    _db_prompts = None  # 缓存数据库中的提示词配置

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(PromptManager, cls).__new__(cls)
        return cls._instance

    def _load_from_db(self) -> Dict[str, Any]:
        """从数据库加载提示词配置"""
        db = SessionLocal()
        try:
            from app.models.models import SystemConfig
            config = db.query(SystemConfig).first()
            if config and config.prompt_configs:
                # 如果数据库中有配置，使用数据库的配置
                self._db_prompts = config.prompt_configs
            else:
                # 如果数据库中没有配置，将默认配置写入数据库
                if config:
                    config.prompt_configs = DEFAULT_PROMPTS["prompts"]
                    db.commit()
                    self._db_prompts = DEFAULT_PROMPTS["prompts"]
                else:
                    self._db_prompts = None
        except Exception as e:
            print(f"Error loading prompts from database: {e}")
            self._db_prompts = None
        finally:
            db.close()
        return self._db_prompts or DEFAULT_PROMPTS["prompts"]

    def reload_from_db(self):
        """强制从数据库重新加载提示词配置（清除缓存）"""
        self._db_prompts = None
        return self._load_from_db()

    def _get_prompt_config(self, key: str) -> Dict[str, str]:
        """获取指定 key 的提示词配置"""
        if self._db_prompts is None:
            self._load_from_db()

        if self._db_prompts:
            prompt_config = self._db_prompts.get(key)
            if prompt_config:
                return {
                    "system": prompt_config.get('system', ""),
                    "user": prompt_config.get('user', "")
                }

        # Fallback 到默认配置
        default_config = DEFAULT_PROMPTS["prompts"].get(key)
        if not default_config:
            print(f"Prompt key '{key}' not found in configuration.")
            return {"system": "", "user": ""}

        return {
            "system": default_config.get('system', ""),
            "user": default_config.get('user', "")
        }

    def get_prompt(self, key: str, **kwargs) -> Dict[str, str]:
        """
        Get prompt template by key and format it with kwargs.
        Returns a dictionary with 'system' and 'user' keys.
        """
        prompt_config = self._get_prompt_config(key)

        system_prompt = prompt_config.get('system', "")
        user_prompt_template = prompt_config.get('user', "")

        if not user_prompt_template:
            print(f"Prompt key '{key}' has no user template.")
            return {"system": system_prompt, "user": ""}

        try:
            # Format the user prompt with provided kwargs
            user_prompt = user_prompt_template.format(**kwargs)
        except KeyError as e:
            print(f"Missing variable for prompt '{key}': {e}")
            user_prompt = f"Error: Missing variable {e}. Template: {user_prompt_template}"
        except Exception as e:
            print(f"Error formatting prompt '{key}': {e}")
            user_prompt = user_prompt_template

        return {
            "system": system_prompt,
            "user": user_prompt
        }

    def get_all_prompts(self) -> Dict[str, Any]:
        """获取所有提示词配置"""
        if self._db_prompts is None:
            self._load_from_db()

        if self._db_prompts:
            return self._db_prompts

        return DEFAULT_PROMPTS["prompts"]

# Global instance
prompt_manager = PromptManager()