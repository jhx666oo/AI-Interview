from openai import OpenAI
import os
from typing import Dict, Any
import json
from dotenv import load_dotenv
from app.utils.prompt_manager import prompt_manager
from app.config.database import SessionLocal
from app.models.models import SystemConfig

load_dotenv()

_DEFAULT_PROVIDER = os.getenv("LLM_PROVIDER", "dashscope")
_DEFAULT_BASE_URL = os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or "qwen3.5-plus"
_DEFAULT_TEMPERATURE = 0.2
_DEFAULT_BASE_URL_BY_PROVIDER = {
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "openai": "https://api.openai.com/v1",
    "openai_compatible": None,
}

_client_cache = None
_client_cache_key = None


def _get_llm_config() -> Dict[str, Any]:
    db = SessionLocal()
    try:
        cfg = db.query(SystemConfig).first()
        llm_provider = (cfg.llm_provider if cfg else None) or _DEFAULT_PROVIDER
        llm_base_url = (cfg.llm_base_url if cfg else None) or _DEFAULT_BASE_URL_BY_PROVIDER.get(llm_provider) or _DEFAULT_BASE_URL
        llm_model = (cfg.llm_model if cfg else None) or _DEFAULT_MODEL
        llm_temperature = (cfg.llm_temperature if cfg and cfg.llm_temperature is not None else None)
        llm_temperature = _DEFAULT_TEMPERATURE if llm_temperature is None else llm_temperature
        llm_max_tokens = cfg.llm_max_tokens if cfg else None
        llm_api_key = (cfg.llm_api_key if cfg else None) or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
        return {
            "llm_provider": llm_provider,
            "llm_base_url": llm_base_url,
            "llm_model": llm_model,
            "llm_temperature": llm_temperature,
            "llm_max_tokens": llm_max_tokens,
            "llm_api_key": llm_api_key,
        }
    finally:
        db.close()


def _get_client() -> OpenAI:
    global _client_cache, _client_cache_key
    cfg = _get_llm_config()
    key = (cfg.get("llm_base_url"), cfg.get("llm_api_key"))
    if _client_cache is not None and _client_cache_key == key:
        return _client_cache
    _client_cache_key = key
    _client_cache = OpenAI(
        api_key=cfg.get("llm_api_key"),
        base_url=cfg.get("llm_base_url"),
    )
    return _client_cache

def _get_extra_body() -> Dict[str, Any]:
    cfg = _get_llm_config()
    if cfg.get("llm_provider") == "dashscope":
        return {"enable_thinking": False}
    return {}

def analyze_resume(resume_text: str, position_description: str, other_positions: str = "") -> Dict[str, Any]:
    prompt_data = prompt_manager.get_prompt(
        "analyze_resume",
        resume_text=resume_text,
        position_description=position_description,
        other_positions=other_positions
    )

    if not prompt_data.get("user"):
        print("Failed to load prompt for analyze_resume")
        return {}

    cfg = _get_llm_config()

    # 自动重试：最多3次，指数退避
    import time
    max_retries = 3
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            extra = {"temperature": cfg["llm_temperature"]}
            if cfg["llm_max_tokens"] is not None:
                extra["max_tokens"] = cfg["llm_max_tokens"]
            completion = _get_client().chat.completions.create(
                model=cfg["llm_model"],
                messages=[
                    {'role': 'system', 'content': prompt_data['system']},
                    {'role': 'user', 'content': prompt_data['user']}
                ],
                response_format={"type": "json_object"},
                extra_body=_get_extra_body(),
                **extra,
            )
            result = json.loads(completion.choices[0].message.content)
            return result
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                wait = attempt * 2  # 2s, 4s, 6s
                print(f"AI analysis attempt {attempt}/{max_retries} failed: {e}, retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"AI analysis failed after {max_retries} attempts: {e}")

    return {}

def generate_resume_markdown(resume_text: str) -> str:
    prompt_data = prompt_manager.get_prompt(
        "generate_resume_markdown", 
        resume_text=resume_text
    )
    
    if not prompt_data.get("user"):
        return resume_text
        
    import time
    max_retries = 3

    for attempt in range(1, max_retries + 1):
        try:
            extra = {"temperature": cfg["llm_temperature"]}
            if cfg["llm_max_tokens"] is not None:
                extra["max_tokens"] = cfg["llm_max_tokens"]
            completion = _get_client().chat.completions.create(
                model=cfg["llm_model"],
                messages=[
                    {'role': 'system', 'content': prompt_data['system']},
                    {'role': 'user', 'content': prompt_data['user']}
                ],
                extra_body=_get_extra_body(),
                **extra,
            )
            content = completion.choices[0].message.content
            # Remove potential markdown code block markers
            content = content.replace("```markdown", "").replace("```", "").strip()
            return content
        except Exception as e:
            print(f"Markdown generation attempt {attempt}/{max_retries} failed: {e}")
            if attempt < max_retries:
                time.sleep(attempt * 2)
    return resume_text

def generate_interview_questions(
    resume_data: Dict,
    position_description: str,
    question_bank_content: str = "",
    count: int = 5,
    interview_category: str = "technical"
) -> list:
    # 面试类型描述映射
    category_descriptions = {
        "hr": "HR面试，主要考察候选人的综合素质、沟通能力、团队协作、职业规划、薪资期望等",
        "technical": "技术面试，主要考察候选人的专业技能、技术深度、问题解决能力、项目经验等",
        "manager": "主管面试，主要考察候选人的业务理解、团队管理、项目把控、跨部门协作等能力",
        "ceo": "CEO面试，主要考察候选人的战略思维、价值观匹配、行业洞察、长期发展潜力等",
        "comprehensive": "综合面试，全面考察候选人的技术能力、综合素质、发展潜力等各方面"
    }

    category_desc = category_descriptions.get(interview_category, category_descriptions["technical"])

    prompt_data = prompt_manager.get_prompt(
        "generate_interview_questions",
        resume_data=json.dumps(resume_data, ensure_ascii=False),
        position_description=position_description,
        question_bank_content=question_bank_content,
        count=count,
        interview_category=category_desc
    )

    if not prompt_data.get("user"):
        return []

    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        if isinstance(result, list):
            return result
        return result.get("questions", [])
    except Exception as e:
        print(f"Question generation failed: {e}")
        return []

def generate_interview_evaluation(
    questions: list, 
    scores: Dict[str, Any], 
    total_score: int,
    panel_details: str = "",
    transcripts: str = "" # New parameter for candidate audio transcripts
) -> Dict[str, str]:
    prompt_data = prompt_manager.get_prompt(
        "generate_interview_evaluation", 
        questions=json.dumps(questions, ensure_ascii=False), 
        scores=json.dumps(scores, ensure_ascii=False),
        total_score=total_score,
        panel_details=panel_details,
        transcripts=transcripts
    )
    
    if not prompt_data.get("user"):
        return {"evaluation": "生成评价失败", "suggestion": "waitlist"}
        
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Evaluation generation failed: {e}")
        return {"evaluation": "生成评价失败", "suggestion": "waitlist"}


def generate_interview_evaluation_from_transcript(
    transcript: str,
    interviewer_evaluation: str,
    interviewer_score: int
) -> Dict[str, str]:
    """
    根据录音转写和面试官评价生成综合评价
    """
    prompt_data = prompt_manager.get_prompt(
        "generate_interview_evaluation_from_transcript",
        transcript=transcript,
        interviewer_evaluation=interviewer_evaluation,
        interviewer_score=interviewer_score
    )
    
    if not prompt_data.get("user"):
        return {"evaluation": interviewer_evaluation, "suggestion": "waitlist"}
        
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Evaluation from transcript generation failed: {e}")
        return {"evaluation": interviewer_evaluation, "suggestion": "waitlist"}


def generate_coding_test_evaluation(
    title: str,
    description: str,
    language: str,
    code: str,
    run_result: Dict[str, Any],
) -> Dict[str, Any]:
    prompt_data = prompt_manager.get_prompt(
        "generate_coding_test_evaluation",
        title=title,
        description=description,
        language=language,
        code=code,
        run_result=json.dumps(run_result, ensure_ascii=False),
    )

    if not prompt_data.get("user"):
        return {"evaluation": "生成评价失败"}

    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {"role": "system", "content": prompt_data["system"]},
                {"role": "user", "content": prompt_data["user"]},
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Coding evaluation generation failed: {e}")
        return {"evaluation": "生成评价失败"}

def generate_jd(
    title: str,
    department: str = "",
    location: str = "",
    salary_range: str = "",
    keywords: str = ""
) -> Dict[str, str]:
    prompt_data = prompt_manager.get_prompt(
        "generate_jd",
        title=title,
        department=department or "未指定",
        location=location or "未指定",
        salary_range=salary_range or "面议",
        keywords=keywords or "无特殊要求"
    )
    
    if not prompt_data.get("user"):
        return {"description": "生成岗位描述失败", "requirements": "生成任职要求失败"}
    
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        result = json.loads(completion.choices[0].message.content)
        return {
            "description": result.get("description", ""),
            "requirements": result.get("requirements", "")
        }
    except Exception as e:
        print(f"JD generation failed: {e}")
        return {"description": "生成岗位描述失败", "requirements": "生成任职要求失败"}

def generate_jd_stream(
    title: str,
    department: str = "",
    location: str = "",
    salary_range: str = "",
    keywords: str = ""
):
    prompt_data = prompt_manager.get_prompt(
        "generate_jd",
        title=title,
        department=department or "未指定",
        location=location or "未指定",
        salary_range=salary_range or "面议",
        keywords=keywords or "无特殊要求"
    )
    
    if not prompt_data.get("user"):
        yield "data: " + json.dumps({"error": "生成失败，请检查配置"}, ensure_ascii=False) + "\n\n"
        return
    
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"], "stream": True}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        
        stream = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'system', 'content': prompt_data['system']},
                {'role': 'user', 'content': prompt_data['user']}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        
        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield "data: " + json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False) + "\n\n"
        
        yield "data: " + json.dumps({"done": True}, ensure_ascii=False) + "\n\n"
    except Exception as e:
        print(f"JD stream generation failed: {e}")
        yield "data: " + json.dumps({"error": str(e)}, ensure_ascii=False) + "\n\n"

def chat_jd_stream(
    messages: list,
    current_description: str = "",
    current_requirements: str = ""
):
    system_prompt = """你是一个专业的招聘专家，擅长撰写和优化岗位描述（JD）。

当前岗位描述内容：
【岗位职责】
""" + current_description + """

【任职要求】
""" + current_requirements + """

你的任务是帮助用户优化和完善岗位描述。请根据用户的反馈进行修改，并返回完整的更新后的内容。

返回格式必须是 JSON：
{
  "description": "更新后的岗位职责（Markdown格式）",
  "requirements": "更新后的任职要求（Markdown格式）"
}

注意：
1. 保持专业性和准确性
2. 如果用户只是提问而不需要修改，请解释相关内容，但仍然返回当前的 description 和 requirements
3. 修改时要保持整体结构完整，不要只返回部分内容"""

    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"], "stream": True}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        
        formatted_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            formatted_messages.append({"role": msg["role"], "content": msg["content"]})
        
        stream = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=formatted_messages,
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        
        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield "data: " + json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False) + "\n\n"
        
        yield "data: " + json.dumps({"done": True}, ensure_ascii=False) + "\n\n"
    except Exception as e:
        print(f"JD chat stream failed: {e}")
        yield "data: " + json.dumps({"error": str(e)}, ensure_ascii=False) + "\n\n"


def generate_text(prompt: str) -> str:
    """
    通用文本生成函数，用于生成面试评价等文本内容
    """
    try:
        cfg = _get_llm_config()
        extra = {"temperature": cfg["llm_temperature"]}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]

        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {'role': 'user', 'content': prompt}
            ],
            extra_body=_get_extra_body(),
            **extra,
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"Text generation failed: {e}")
        return ""
