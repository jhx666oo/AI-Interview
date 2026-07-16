from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Tuple
import os

from app.config.database import get_db
from app.core.security import check_roles
from app.models.models import SystemConfig, UserRole
from app.schemas.settings import (
    SystemModelConfigResponse, SystemModelConfigUpdate,
    MailConfigResponse, MailConfigUpdate,
    SystemConfigResponse, SystemConfigUpdate,
    PromptConfigsResponse, PromptConfigItem, PromptConfigUpdate
)


router = APIRouter(
    prefix="/settings",
    tags=["settings"],
)


def _mask_key(api_key: Optional[str]) -> Tuple[bool, Optional[str]]:
    if not api_key:
        return False, None
    return True, api_key[-4:]


def _get_or_create_config(db: Session) -> SystemConfig:
    config = db.query(SystemConfig).first()
    if config:
        return config
    config = SystemConfig(
        llm_provider=os.getenv("LLM_PROVIDER", "dashscope"),
        llm_base_url=os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1",
        llm_model=os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or "qwen3.5-plus",
        llm_api_key=os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY"),
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.get("/system", response_model=SystemModelConfigResponse)
def get_system_settings(
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    config = _get_or_create_config(db)
    api_key_set, api_key_last4 = _mask_key(config.llm_api_key)
    return SystemModelConfigResponse(
        llm_base_url=config.llm_base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1",
        llm_model=config.llm_model or "qwen3.5-plus",
        llm_api_key_set=api_key_set,
        llm_api_key_last4=api_key_last4,
    )


@router.put("/system", response_model=SystemModelConfigResponse)
def update_system_settings(
    payload: SystemModelConfigUpdate,
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    config = _get_or_create_config(db)
    data = payload.dict(exclude_unset=True)

    if "llm_base_url" in data:
        config.llm_base_url = (data["llm_base_url"] or "").strip() or None

    if "llm_model" in data:
        model = (data["llm_model"] or "").strip()
        if model:
            config.llm_model = model

    if "llm_api_key" in data:
        api_key = (data["llm_api_key"] or "").strip()
        if api_key:
            config.llm_api_key = api_key

    if not config.llm_base_url:
        raise HTTPException(status_code=400, detail="请配置 Base URL")

    if not config.llm_model:
        raise HTTPException(status_code=400, detail="请配置 Model")

    if not config.llm_api_key:
        raise HTTPException(status_code=400, detail="请配置 API Key")

    db.commit()
    db.refresh(config)

    api_key_set, api_key_last4 = _mask_key(config.llm_api_key)
    return SystemModelConfigResponse(
        llm_base_url=config.llm_base_url,
        llm_model=config.llm_model or "qwen3.5-plus",
        llm_api_key_set=api_key_set,
        llm_api_key_last4=api_key_last4,
    )


@router.get("/mail", response_model=MailConfigResponse)
def get_mail_settings(
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    """获取邮件配置"""
    config = _get_or_create_config(db)
    smtp_password_set = bool(config.smtp_password)
    return MailConfigResponse(
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port or 465,
        smtp_username=config.smtp_username,
        smtp_password_set=smtp_password_set,
        mail_from=config.mail_from,
        mail_from_name=config.mail_from_name or "招聘系统",
        mail_enabled=config.mail_enabled or False,
        frontend_url=config.frontend_url,
    )


@router.put("/mail", response_model=MailConfigResponse)
def update_mail_settings(
    payload: MailConfigUpdate,
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    """更新邮件配置"""
    config = _get_or_create_config(db)
    data = payload.dict(exclude_unset=True)

    if "smtp_host" in data:
        config.smtp_host = (data["smtp_host"] or "").strip() or None

    if "smtp_port" in data:
        config.smtp_port = data["smtp_port"]

    if "smtp_username" in data:
        config.smtp_username = (data["smtp_username"] or "").strip() or None

    if "smtp_password" in data:
        password = (data["smtp_password"] or "").strip()
        if password:
            config.smtp_password = password

    if "mail_from" in data:
        config.mail_from = (data["mail_from"] or "").strip() or None

    if "mail_from_name" in data:
        config.mail_from_name = (data["mail_from_name"] or "").strip() or "招聘系统"

    if "mail_enabled" in data:
        config.mail_enabled = data["mail_enabled"]

    if "frontend_url" in data:
        config.frontend_url = (data["frontend_url"] or "").strip() or None

    db.commit()
    db.refresh(config)

    smtp_password_set = bool(config.smtp_password)
    return MailConfigResponse(
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port or 465,
        smtp_username=config.smtp_username,
        smtp_password_set=smtp_password_set,
        mail_from=config.mail_from,
        mail_from_name=config.mail_from_name or "招聘系统",
        mail_enabled=config.mail_enabled or False,
        frontend_url=config.frontend_url,
    )


@router.post("/mail/test")
def test_mail_settings(
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    """测试邮件配置"""
    from app.services.mail_service import get_mail_service

    mail_service = get_mail_service(db)

    if not mail_service.config.is_valid():
        raise HTTPException(status_code=400, detail="邮件配置不完整或未启用")

    # 发送测试邮件给当前用户
    # 这里简化处理，实际应该发送给当前用户的邮箱
    return {"message": "邮件配置有效"}


@router.get("/prompts", response_model=PromptConfigsResponse)
def get_prompt_configs(
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    """获取所有提示词配置"""
    from app.utils.prompt_manager import prompt_manager

    prompts = prompt_manager.get_all_prompts()
    prompt_items = {}
    for key, config in prompts.items():
        prompt_items[key] = PromptConfigItem(
            system=config.get('system', ''),
            user=config.get('user', '')
        )
    return PromptConfigsResponse(prompts=prompt_items)


@router.put("/prompts/{key}")
def update_prompt_config(
    key: str,
    payload: PromptConfigUpdate,
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    """更新指定提示词配置"""
    from app.utils.prompt_manager import prompt_manager
    from sqlalchemy.orm.attributes import flag_modified

    config = _get_or_create_config(db)

    # 确保配置已初始化
    if not config.prompt_configs:
        config.prompt_configs = prompt_manager._prompts.get('prompts', {})

    # 获取现有配置
    existing_config = config.prompt_configs.get(key, {})
    if not isinstance(existing_config, dict):
        existing_config = {}
    data = payload.dict(exclude_unset=True)

    # 更新配置
    if 'system' in data:
        existing_config['system'] = data['system']
    if 'user' in data:
        existing_config['user'] = data['user']

    config.prompt_configs[key] = existing_config
    # 标记 JSON 列已修改，确保 SQLAlchemy 能检测到变化
    flag_modified(config, "prompt_configs")
    db.commit()
    db.refresh(config)

    # 清除缓存，强制重新加载
    prompt_manager.reload_from_db()

    return {"message": "提示词配置已更新", "key": key}


@router.post("/prompts/reload")
def reload_prompt_configs(
    db: Session = Depends(get_db),
    _current_user=Depends(check_roles([UserRole.ADMIN])),
):
    """强制重新加载提示词配置（清除缓存）"""
    from app.utils.prompt_manager import prompt_manager

    prompt_manager.reload_from_db()
    return {"message": "提示词配置已重新加载"}


@router.get("/prompts/variables")
def get_prompt_variables():
    """获取所有提示词可用变量"""
    from app.config.prompt_variables import PROMPT_VARIABLES, ALL_VARIABLES

    return {
        "variables_by_prompt": PROMPT_VARIABLES,
        "all_variables": ALL_VARIABLES,
    }
