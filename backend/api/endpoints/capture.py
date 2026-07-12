from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
import uuid
from backend.models.database.photo import Photo
from backend.models.schemas.photo import PhotoResponse
from backend.services.storage import storage_service
from backend.services.db_service import PhotoService, get_photo_service
from backend.utils.logger import logger
from typing import Optional

router = APIRouter()

@router.post("/capture", response_model=PhotoResponse)
async def capture_photo(
    file: UploadFile = File(...),
    style: str = Form("Anime"),
    background: str = Form("Cherry Blossoms"),
    user_id: Optional[str] = Form(None),
    photo_service: PhotoService = Depends(get_photo_service)
):
    """
    Manually upload a captured camera frame.
    Saves the image to original-images storage and registers a Photo DB entry.
    """
    if not file.filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
        raise HTTPException(status_code=400, detail="Unsupported image format. Upload JPEG, PNG or WebP.")
        
    try:
        contents = await file.read()
        filename = f"manual_{uuid.uuid4().hex[:12]}.jpg"
        
        # Upload using storage service
        original_url = storage_service.upload_file(contents, "original", filename)
        
        # Create Photo row
        photo = Photo(
            id=str(uuid.uuid4()),
            user_id=user_id,
            original_url=original_url,
            style=style,
            background=background,
            is_public=True
        )
        photo = photo_service.register_photo(photo)
        
        logger.info(f"Manually uploaded capture saved. Photo ID: {photo.id}")
        return photo
    except Exception as e:
        logger.error(f"Failed to capture and upload photo: {e}")
        raise HTTPException(status_code=500, detail="Internal file capture processing failed.")
