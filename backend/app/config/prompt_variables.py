# 提示词变量定义
# 每个提示词可以使用的变量及其说明

PROMPT_VARIABLES = {
    "analyze_resume": [
        {"name": "position_description", "description": "岗位描述内容"},
        {"name": "resume_text", "description": "简历原始文本内容"},
        {"name": "other_positions", "description": "其他相近岗位信息（JSON格式，包含岗位ID、名称、描述等）"},
    ],
    "generate_resume_markdown": [
        {"name": "resume_text", "description": "简历原始文本内容"},
    ],
    "generate_interview_questions": [
        {"name": "position_description", "description": "岗位描述内容"},
        {"name": "resume_data", "description": "简历解析后的结构化数据（JSON格式）"},
        {"name": "question_bank_content", "description": "参考题库内容"},
        {"name": "interview_category", "description": "面试类型（HR面试/技术面试/主管面试/CEO面试/综合面试）"},
        {"name": "count", "description": "需要生成的题目数量"},
    ],
    "generate_interview_evaluation": [
        {"name": "questions", "description": "面试题目及评分标准"},
        {"name": "scores", "description": "面试官评分概览"},
        {"name": "panel_details", "description": "面试官详细评语"},
        {"name": "transcripts", "description": "候选人回答录音转写"},
        {"name": "total_score", "description": "综合总分"},
    ],
    "generate_interview_evaluation_from_transcript": [
        {"name": "transcript", "description": "面试录音转写文本"},
        {"name": "interviewer_evaluation", "description": "面试官评价内容"},
        {"name": "interviewer_score", "description": "面试官评分（满分10分）"},
    ],
    "generate_coding_test_evaluation": [
        {"name": "title", "description": "笔试题目标题"},
        {"name": "description", "description": "笔试题目描述"},
        {"name": "language", "description": "编程语言"},
        {"name": "code", "description": "候选人提交的代码"},
        {"name": "run_result", "description": "测试用例运行结果"},
    ],
    "generate_jd": [
        {"name": "title", "description": "岗位名称"},
        {"name": "department", "description": "所属部门"},
        {"name": "location", "description": "工作地点"},
        {"name": "salary_range", "description": "薪资范围"},
        {"name": "keywords", "description": "关键词/特殊要求"},
    ],
}

# 所有可用变量的汇总（用于展示）
ALL_VARIABLES = {
    "position_description": "岗位描述内容",
    "resume_text": "简历原始文本内容",
    "other_positions": "其他相近岗位信息（JSON格式，包含岗位ID、名称、描述等）",
    "resume_data": "简历解析后的结构化数据（JSON格式）",
    "question_bank_content": "参考题库内容",
    "interview_category": "面试类型（HR面试/技术面试/主管面试/CEO面试/综合面试）",
    "count": "需要生成的题目数量",
    "questions": "面试题目及评分标准",
    "scores": "面试官评分概览",
    "panel_details": "面试官详细评语",
    "transcripts": "候选人回答录音转写",
    "total_score": "综合总分",
    "transcript": "面试录音转写文本",
    "interviewer_evaluation": "面试官评价内容",
    "interviewer_score": "面试官评分（满分10分）",
    "title": "标题/岗位名称",
    "description": "描述内容",
    "language": "编程语言",
    "code": "代码内容",
    "run_result": "运行结果",
    "department": "所属部门",
    "location": "工作地点",
    "salary_range": "薪资范围",
    "keywords": "关键词/特殊要求",
}