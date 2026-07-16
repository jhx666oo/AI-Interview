from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from app.config.database import get_db
from app.models.models import User, UserRole
from app.schemas.user import Token, UserResponse, UserLogin, TokenData, UserCreate, UserUpdateMe, ChangePasswordRequest
from app.core.security import verify_password, create_access_token, SECRET_KEY, ALGORITHM, check_roles, get_password_hash, get_current_user_dep
from datetime import timedelta
from typing import List
import re

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

# Reuse the dependency from security.py to avoid duplication and mismatch
get_current_user = get_current_user_dep

def validate_password_strength(password: str) -> None:
    """
    验证密码强度
    - 至少8个字符
    - 必须包含字母
    - 必须包含数字
    """
    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码长度至少8位"
        )
    if not re.search(r'[A-Za-z]', password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码必须包含字母"
        )
    if not re.search(r'\d', password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码必须包含数字"
        )

@router.post("/token", response_model=Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    print(f"Login attempt: {form_data.username}")
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user:
        print(f"User not found: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not verify_password(form_data.password, user.hashed_password):
        print(f"Invalid password for user: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被禁用，请联系管理员",
        )
    access_token_expires = timedelta(minutes=60 * 24 * 30) # 30 days
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被禁用，请联系管理员",
        )
    access_token_expires = timedelta(minutes=60 * 24 * 30)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.put("/me", response_model=UserResponse)
def update_users_me(
    payload: UserUpdateMe,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.dict(exclude_unset=True)
    if "full_name" in data:
        current_user.full_name = data["full_name"]
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user

@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="当前密码错误")
    # 验证新密码强度
    validate_password_strength(payload.new_password)
    current_user.hashed_password = get_password_hash(payload.new_password)
    db.add(current_user)
    db.commit()
    return {"success": True}

# Admin routes for user management
@router.get("/users", response_model=List[UserResponse])
def get_users(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(check_roles([UserRole.ADMIN]))
):
    return db.query(User).offset(skip).limit(limit).all()

@router.post("/users", response_model=UserResponse)
def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(check_roles([UserRole.ADMIN]))
):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 验证密码强度
    validate_password_strength(user.password)

    hashed_password = get_password_hash(user.password)
    new_user = User(
        email=user.email,
        hashed_password=hashed_password,
        full_name=user.full_name,
        role=user.role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@router.get("/interviewers", response_model=List[UserResponse])
def get_interviewers(db: Session = Depends(get_db)):
    # Helper to get all interviewers (HR and Interviewer roles can be assigned)
    # Accessible by authenticated users to assign to interviews
    return db.query(User).filter(User.role.in_([UserRole.HR, UserRole.INTERVIEWER, UserRole.ADMIN])).all()

@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    user_update: UserUpdateMe,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(check_roles([UserRole.ADMIN]))
):
    """更新用户信息"""
    from uuid import UUID
    try:
        uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的用户ID")

    db_user = db.query(User).filter(User.id == uuid).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    data = user_update.dict(exclude_unset=True)
    if "full_name" in data:
        db_user.full_name = data["full_name"]
    if "password" in data and data["password"]:
        from app.core.security import get_password_hash
        validate_password_strength(data["password"])
        db_user.hashed_password = get_password_hash(data["password"])
    if "role" in data:
        db_user.role = data["role"]
    if "feishu_token" in data:
        db_user.feishu_token = data["feishu_token"]

    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.put("/users/{user_id}/role")
def update_user_role(
    user_id: str,
    role: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(check_roles([UserRole.ADMIN]))
):
    """更新用户角色"""
    from uuid import UUID
    try:
        uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的用户ID")

    try:
        new_role = UserRole(role)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的角色")

    db_user = db.query(User).filter(User.id == uuid).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 防止管理员修改自己的角色
    if db_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")

    db_user.role = new_role
    db.add(db_user)
    db.commit()
    return {"success": True, "message": "角色更新成功"}

@router.put("/users/{user_id}/status")
def toggle_user_status(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(check_roles([UserRole.ADMIN]))
):
    """切换用户状态（启用/禁用）"""
    from uuid import UUID
    try:
        uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的用户ID")

    db_user = db.query(User).filter(User.id == uuid).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 防止禁用自己
    if db_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能禁用自己的账户")

    db_user.is_active = not db_user.is_active
    db.add(db_user)
    db.commit()
    return {"success": True, "is_active": db_user.is_active}

@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserResponse = Depends(check_roles([UserRole.ADMIN]))
):
    """删除用户"""
    from uuid import UUID
    try:
        uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的用户ID")

    db_user = db.query(User).filter(User.id == uuid).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 防止删除自己
    if db_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")

    db.delete(db_user)
    db.commit()
    return {"success": True, "message": "用户已删除"}
