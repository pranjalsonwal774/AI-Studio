from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import OperationalError
from backend.core.config import settings
from backend.utils.logger import logger
import os

Base = declarative_base()
engine = None
SessionLocal = None

try:
    # Try PostgreSQL first
    db_url = settings.DATABASE_URL
    logger.info(f"Connecting to database at: {settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}")
    engine = create_engine(db_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
    # Check if connection can be established
    with engine.connect() as conn:
        pass
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    logger.info("Successfully connected to PostgreSQL database.")
except (OperationalError, Exception) as e:
    # Fallback to local SQLite file database for easier development testing
    sqlite_db_dir = os.path.join(settings.LOCAL_STORAGE_DIR, "db")
    os.makedirs(sqlite_db_dir, exist_ok=True)
    sqlite_db_path = os.path.join(sqlite_db_dir, "anime_studio.db")
    fallback_url = f"sqlite:///{sqlite_db_path}"
    logger.warning(
        f"PostgreSQL connection failed: {e}. "
        f"Falling back to local SQLite database at: {sqlite_db_path}"
    )
    engine = create_engine(fallback_url, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
