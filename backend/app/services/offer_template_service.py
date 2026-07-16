from sqlalchemy.orm import Session
from sqlalchemy import desc, and_, or_
from app.models.models import OfferTemplate, Position
from app.schemas.offer_template import OfferTemplateCreate, OfferTemplateUpdate
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from uuid import UUID

def create_template(db: Session, template_data: OfferTemplateCreate, user_id: UUID) -> OfferTemplate:
    if template_data.is_default:
        db.query(OfferTemplate).filter(
            OfferTemplate.position_id == template_data.position_id,
            OfferTemplate.is_default == True
        ).update({"is_default": False})
    
    template = OfferTemplate(
        name=template_data.name,
        position_id=template_data.position_id,
        salary_monthly=float(template_data.salary_monthly) if template_data.salary_monthly else None,
        salary_annual=float(template_data.salary_annual) if template_data.salary_annual else None,
        salary_structure=template_data.salary_structure,
        department=template_data.department,
        report_to=template_data.report_to,
        work_location=template_data.work_location,
        work_hours=template_data.work_hours,
        probation_months=template_data.probation_months or 3,
        benefits=template_data.benefits,
        bonus=template_data.bonus,
        special_terms=template_data.special_terms,
        notes=template_data.notes,
        valid_days=template_data.valid_days or 7,
        is_default=template_data.is_default or False,
        created_by=user_id
    )
    
    db.add(template)
    db.commit()
    db.refresh(template)
    
    return template

def get_templates(
    db: Session,
    position_id: Optional[UUID] = None,
    include_inactive: bool = False
) -> List[Dict[str, Any]]:
    query = db.query(OfferTemplate)
    
    if not include_inactive:
        query = query.filter(OfferTemplate.is_active == True)
    
    if position_id:
        query = query.filter(
            or_(
                OfferTemplate.position_id == position_id,
                OfferTemplate.position_id.is_(None)
            )
        )
    
    templates = query.order_by(desc(OfferTemplate.is_default), desc(OfferTemplate.created_at)).all()
    
    items = []
    for t in templates:
        item = {
            "id": str(t.id),
            "name": t.name,
            "position_id": str(t.position_id) if t.position_id else None,
            "salary_monthly": t.salary_monthly,
            "salary_annual": t.salary_annual,
            "salary_structure": t.salary_structure,
            "department": t.department,
            "report_to": t.report_to,
            "work_location": t.work_location,
            "work_hours": t.work_hours,
            "probation_months": t.probation_months,
            "benefits": t.benefits,
            "bonus": t.bonus,
            "special_terms": t.special_terms,
            "notes": t.notes,
            "valid_days": t.valid_days,
            "is_default": t.is_default,
            "is_active": t.is_active,
            "created_at": t.created_at,
            "updated_at": t.updated_at,
            "created_by": str(t.created_by) if t.created_by else None,
            "position_info": {
                "id": str(t.position.id),
                "title": t.position.title,
                "department": t.position.department,
                "location": t.position.location
            } if t.position else None
        }
        items.append(item)
    
    return items

def get_template(db: Session, template_id: UUID) -> Optional[Dict[str, Any]]:
    template = db.query(OfferTemplate).filter(OfferTemplate.id == template_id).first()
    if not template:
        return None
    
    return {
        "id": str(template.id),
        "name": template.name,
        "position_id": str(template.position_id) if template.position_id else None,
        "salary_monthly": template.salary_monthly,
        "salary_annual": template.salary_annual,
        "salary_structure": template.salary_structure,
        "department": template.department,
        "report_to": template.report_to,
        "work_location": template.work_location,
        "work_hours": template.work_hours,
        "probation_months": template.probation_months,
        "benefits": template.benefits,
        "bonus": template.bonus,
        "special_terms": template.special_terms,
        "notes": template.notes,
        "valid_days": template.valid_days,
        "is_default": template.is_default,
        "is_active": template.is_active,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "created_by": str(template.created_by) if template.created_by else None,
        "position_info": {
            "id": str(template.position.id),
            "title": template.position.title,
            "department": template.position.department,
            "location": template.position.location
        } if template.position else None
    }

def get_default_template_for_position(db: Session, position_id: UUID) -> Optional[Dict[str, Any]]:
    template = db.query(OfferTemplate).filter(
        OfferTemplate.position_id == position_id,
        OfferTemplate.is_default == True,
        OfferTemplate.is_active == True
    ).first()
    
    if template:
        return get_template(db, template.id)
    
    template = db.query(OfferTemplate).filter(
        OfferTemplate.position_id.is_(None),
        OfferTemplate.is_default == True,
        OfferTemplate.is_active == True
    ).first()
    
    if template:
        return get_template(db, template.id)
    
    return None

def update_template(db: Session, template_id: UUID, template_data: OfferTemplateUpdate) -> Optional[OfferTemplate]:
    template = db.query(OfferTemplate).filter(OfferTemplate.id == template_id).first()
    if not template:
        return None
    
    if template_data.is_default:
        db.query(OfferTemplate).filter(
            OfferTemplate.position_id == template.position_id,
            OfferTemplate.id != template_id,
            OfferTemplate.is_default == True
        ).update({"is_default": False})
    
    update_fields = [
        'name', 'position_id', 'salary_monthly', 'salary_annual', 'salary_structure',
        'department', 'report_to', 'work_location', 'work_hours', 'probation_months',
        'benefits', 'bonus', 'special_terms', 'notes', 'valid_days', 'is_default', 'is_active'
    ]
    
    for field in update_fields:
        value = getattr(template_data, field, None)
        if value is not None:
            if field in ['salary_monthly', 'salary_annual'] and value is not None:
                value = float(value)
            setattr(template, field, value)
    
    db.commit()
    db.refresh(template)
    
    return template

def delete_template(db: Session, template_id: UUID) -> bool:
    template = db.query(OfferTemplate).filter(OfferTemplate.id == template_id).first()
    if not template:
        return False
    
    db.delete(template)
    db.commit()
    return True
