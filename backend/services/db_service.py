from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Any, Optional
from backend.models.database.user import User
from backend.models.database.photo import Photo
from backend.models.database.analytics import Analytics
from backend.core.security import get_password_hash
from backend.models.schemas.auth import UserCreate

# ==========================================
# REPOSITORY PATTERN LAYER
# ==========================================

class UserRepository:
    """Encapsulates raw SQL queries and DB operations for the User model."""
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: str) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    def get_by_username(self, username: str) -> Optional[User]:
        return self.db.query(User).filter(User.username == username).first()

    def create(self, user_in: UserCreate) -> User:
        hashed_pw = get_password_hash(user_in.password)
        db_user = User(
            email=user_in.email,
            username=user_in.username,
            hashed_password=hashed_pw,
            is_admin=getattr(user_in, "is_admin", False)
        )
        self.db.add(db_user)
        self.db.commit()
        self.db.refresh(db_user)
        return db_user

    def count(self) -> int:
        return self.db.query(User).count()


class PhotoRepository:
    """Encapsulates database operations for the Photo record model."""
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, photo_id: str) -> Optional[Photo]:
        return self.db.query(Photo).filter(Photo.id == photo_id).first()

    def get_by_user_id(self, user_id: str, limit: int = 50) -> List[Photo]:
        return self.db.query(Photo).filter(Photo.user_id == user_id).order_by(Photo.created_at.desc()).limit(limit).all()

    def get_public_gallery(self, limit: int = 50) -> List[Photo]:
        return self.db.query(Photo).filter(
            Photo.is_public == True,
            Photo.anime_url != None
        ).order_by(Photo.created_at.desc()).limit(limit).all()

    def save(self, photo: Photo) -> Photo:
        self.db.add(photo)
        self.db.commit()
        self.db.refresh(photo)
        return photo

    def count(self) -> int:
        return self.db.query(Photo).count()

    def get_print_sum(self) -> int:
        return self.db.query(func.sum(Photo.print_count)).scalar() or 0

    def get_style_distribution(self) -> List[Any]:
        return self.db.query(Photo.style, func.count(Photo.id)).group_by(Photo.style).all()

    def get_background_distribution(self) -> List[Any]:
        return self.db.query(Photo.background, func.count(Photo.id)).group_by(Photo.background).all()

    def get_activity_timeline(self) -> List[Any]:
        return self.db.query(
            func.date(Photo.created_at).label("day"),
            func.count(Photo.id).label("count")
        ).group_by("day").order_by("day").all()


class AnalyticsRepository:
    """Encapsulates diagnostics logs and metrics operations."""
    def __init__(self, db: Session):
        self.db = db

    def create(self, event_type: str, latency_ms: float, item_id: Optional[str] = None, details: Optional[str] = None) -> Analytics:
        analytics = Analytics(
            event_type=event_type,
            latency_ms=latency_ms,
            item_id=item_id,
            details=details
        )
        self.db.add(analytics)
        self.db.commit()
        self.db.refresh(analytics)
        return analytics

    def get_average_latency(self, event_type: str = "generation") -> float:
        return self.db.query(func.avg(Analytics.latency_ms)).filter(Analytics.event_type == event_type).scalar() or 0.0


# ==========================================
# BUSINESS LOGIC SERVICE LAYER
# ==========================================

class AuthService:
    """Business operations service wrapper for user session management."""
    def __init__(self, user_repo: UserRepository):
        self.user_repo = user_repo

    def get_user_by_id(self, user_id: str) -> Optional[User]:
        return self.user_repo.get_by_id(user_id)

    def get_user_by_email(self, email: str) -> Optional[User]:
        return self.user_repo.get_by_email(email)

    def get_user_by_username(self, username: str) -> Optional[User]:
        return self.user_repo.get_by_username(username)

    def register_user(self, user_in: UserCreate) -> User:
        return self.user_repo.create(user_in)


class PhotoService:
    """Business operations service wrapper for photo capture, prints, and galleries."""
    def __init__(self, photo_repo: PhotoRepository):
        self.photo_repo = photo_repo

    def get_photo_by_id(self, photo_id: str) -> Optional[Photo]:
        return self.photo_repo.get_by_id(photo_id)

    def get_user_photos(self, user_id: str, limit: int = 50) -> List[Photo]:
        return self.photo_repo.get_by_user_id(user_id, limit)

    def get_public_gallery(self, limit: int = 50) -> List[Photo]:
        return self.photo_repo.get_public_gallery(limit)

    def register_photo(self, photo: Photo) -> Photo:
        return self.photo_repo.save(photo)

    def update_photo_print(self, photo_id: str) -> Optional[Photo]:
        photo = self.photo_repo.get_by_id(photo_id)
        if photo:
            photo.printed = True
            photo.print_count += 1
            return self.photo_repo.save(photo)
        return None


class AnalyticsService:
    """Business operations service wrapper for administration metrics compilation."""
    def __init__(self, analytics_repo: AnalyticsRepository, photo_repo: PhotoRepository, user_repo: UserRepository):
        self.analytics_repo = analytics_repo
        self.photo_repo = photo_repo
        self.user_repo = user_repo

    def log_event(self, event_type: str, latency_ms: float, item_id: Optional[str] = None, details: Optional[str] = None) -> Analytics:
        return self.analytics_repo.create(event_type, latency_ms, item_id, details)

    def get_dashboard_summary(self) -> Dict[str, Any]:
        total_photos = self.photo_repo.count()
        total_users = self.user_repo.count()
        total_prints = self.photo_repo.get_print_sum()
        avg_latency = self.analytics_repo.get_average_latency("generation")
        
        styles_query = self.photo_repo.get_style_distribution()
        styles_distribution = {style: count for style, count in styles_query}
        
        bg_query = self.photo_repo.get_background_distribution()
        bg_distribution = {bg: count for bg, count in bg_query}
        
        activity_query = self.photo_repo.get_activity_timeline()
        activity = [{"date": str(row.day), "count": row.count} for row in activity_query]

        return {
            "total_photos": total_photos,
            "total_users": total_users,
            "total_prints": int(total_prints),
            "avg_latency_ms": round(float(avg_latency), 2),
            "styles_distribution": styles_distribution,
            "backgrounds_distribution": bg_distribution,
            "activity_over_time": activity
        }


# ==========================================
# DEPENDENCY INJECTION ENGINE PROVIDERS
# ==========================================

from fastapi import Depends
from backend.core.database import get_db

def get_user_repository(db: Session = Depends(get_db)) -> UserRepository:
    return UserRepository(db)

def get_photo_repository(db: Session = Depends(get_db)) -> PhotoRepository:
    return PhotoRepository(db)

def get_analytics_repository(db: Session = Depends(get_db)) -> AnalyticsRepository:
    return AnalyticsRepository(db)

def get_auth_service(user_repo: UserRepository = Depends(get_user_repository)) -> AuthService:
    return AuthService(user_repo)

def get_photo_service(photo_repo: PhotoRepository = Depends(get_photo_repository)) -> PhotoService:
    return PhotoService(photo_repo)

def get_analytics_service(
    analytics_repo: AnalyticsRepository = Depends(get_analytics_repository),
    photo_repo: PhotoRepository = Depends(get_photo_repository),
    user_repo: UserRepository = Depends(get_user_repository)
) -> AnalyticsService:
    return AnalyticsService(analytics_repo, photo_repo, user_repo)


# --- Backwards compatibility DB Service instance ---
# To support existing test validations and modules, we maintain the legacy API mapping
class LegacyDBServiceBridge:
    def get_user(self, db: Session, user_id: str) -> Optional[User]:
        return UserRepository(db).get_by_id(user_id)
        
    def get_user_by_email(self, db: Session, email: str) -> Optional[User]:
        return UserRepository(db).get_by_email(email)
        
    def get_user_by_username(self, db: Session, username: str) -> Optional[User]:
        return UserRepository(db).get_by_username(username)
        
    def create_user(self, db: Session, user_schema) -> User:
        return UserRepository(db).create(user_schema)
        
    def get_photo(self, db: Session, photo_id: str) -> Optional[Photo]:
        return PhotoRepository(db).get_by_id(photo_id)
        
    def get_user_photos(self, db: Session, user_id: str, limit: int = 50) -> List[Photo]:
        return PhotoRepository(db).get_by_user_id(user_id, limit)
        
    def get_public_gallery(self, db: Session, limit: int = 50) -> List[Photo]:
        return PhotoRepository(db).get_public_gallery(limit)
        
    def update_photo_print(self, db: Session, photo_id: str) -> Optional[Photo]:
        return PhotoService(PhotoRepository(db)).update_photo_print(photo_id)
        
    def create_analytics_event(self, db: Session, event_type: str, latency_ms: float, item_id: Optional[str] = None, details: Optional[str] = None) -> Analytics:
        return AnalyticsRepository(db).create(event_type, latency_ms, item_id, details)
        
    def get_dashboard_analytics(self, db: Session) -> Dict[str, Any]:
        return AnalyticsService(AnalyticsRepository(db), PhotoRepository(db), UserRepository(db)).get_dashboard_summary()

db_service = LegacyDBServiceBridge()
