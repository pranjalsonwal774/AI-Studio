from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from backend.core.database import get_db
from backend.models.schemas.photo import PhotoResponse
from backend.api.endpoints.auth import get_current_user
from backend.models.database.user import User
from backend.services.db_service import PhotoService, get_photo_service

router = APIRouter()

@router.get("/history", response_model=List[PhotoResponse])
def get_user_history(
    limit: int = 50,
    photo_service: PhotoService = Depends(get_photo_service),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves the execution history of the logged-in user session.
    """
    return photo_service.get_user_photos(user_id=current_user.id, limit=limit)
