import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.routes import auth, positions, question_banks, resumes, interviews, dashboard, coding_tests, settings, offers, offer_templates, public_review, workflows, requisitions, channels, talent_pool, background_checks, onboarding, probation
from app.routes.offers import router as offers_router, public_router as offers_public_router
from app.config.database import engine, SessionLocal
from app.models.models import Base, User, UserRole
from app.models.hr_models import *  # ensure new tables registered
from app.core.security import get_password_hash
from app.services.workflow_service import create_builtin_workflows

# Create tables
Base.metadata.create_all(bind=engine)

# Seed initial user if not exists
def seed_db():
    db = SessionLocal()
    try:
        admin_email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@example.com")
        admin_password = os.getenv("INITIAL_ADMIN_PASSWORD")
        admin_name = os.getenv("INITIAL_ADMIN_NAME", "System Admin")
        app_env = os.getenv("APP_ENV", "development")

        if not admin_password and app_env == "development":
            admin_password = "admin123"

        user = db.query(User).filter(User.email == admin_email).first()
        if not user:
            if not admin_password:
                print("Skipping initial admin user. Set INITIAL_ADMIN_PASSWORD to seed one.")
                return
            print("Seeding initial admin user...")
            admin_user = User(
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                full_name=admin_name,
                role=UserRole.ADMIN
            )
            db.add(admin_user)
            db.commit()
            print(f"Admin user created: {admin_email}")
        else:
            if app_env == "development" and admin_password:
                user.hashed_password = get_password_hash(admin_password)
                user.full_name = user.full_name or admin_name
                user.role = UserRole.ADMIN
                db.commit()
    except Exception as e:
        print(f"Error seeding DB: {e}")
    finally:
        db.close()

seed_db()

app = FastAPI(
    title="AI Interview Assistant",
    description="API for AI Interview Assistant System",
    version="1.0.0"
)

# Ensure uploads directory exists
os.makedirs("uploads", exist_ok=True)

# Mount static files
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

origins = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(positions.router, prefix="/api")
app.include_router(question_banks.router, prefix="/api")
app.include_router(resumes.router, prefix="/api")
app.include_router(interviews.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(coding_tests.router, prefix="/api")
app.include_router(coding_tests.public_router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(offers.router, prefix="/api")
app.include_router(offers_public_router, prefix="/api")
app.include_router(offer_templates.router, prefix="/api")
app.include_router(public_review.router, prefix="/api")
app.include_router(workflows.router, prefix="/api")
app.include_router(requisitions.router, prefix="/api")
app.include_router(channels.router, prefix="/api")
app.include_router(talent_pool.router, prefix="/api")
app.include_router(background_checks.router, prefix="/api")
app.include_router(onboarding.router, prefix="/api")
app.include_router(probation.router, prefix="/api")


def init_builtin_workflows_on_startup():
    db = SessionLocal()
    try:
        create_builtin_workflows(db)
    except Exception as e:
        print(f"Error initializing builtin workflows: {e}")
    finally:
        db.close()

init_builtin_workflows_on_startup()


@app.get("/")
def read_root():
    return {"message": "Welcome to AI Interview Assistant API"}
