from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from backend.core.database import get_db
from backend.models.schemas.photo import PhotoResponse
from backend.services.db_service import PhotoService, get_photo_service

router = APIRouter()

@router.get("/gallery", response_model=List[PhotoResponse])
def get_public_gallery(
    limit: int = 50,
    photo_service: PhotoService = Depends(get_photo_service)
):
    """
    Exposes the public portfolio gallery displaying all shared creations.
    """
    return photo_service.get_public_gallery(limit=limit)
