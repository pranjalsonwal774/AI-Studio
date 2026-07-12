from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Dict
from backend.core.database import get_db
from backend.models.schemas.photo import PhotoGenerateRequest, TaskResponse
from backend.services.queue_manager import queue_manager
from backend.services.db_service import PhotoService, get_photo_service
from backend.utils.logger import logger

router = APIRouter()

# Style configurations metadata for UI card representations
STYLES_LIST = [
    {"id": "Anime", "name": "Classic Anime", "desc": "Clean digital modern anime style"},
    {"id": "Studio Ghibli inspired", "name": "Studio Ghibli", "desc": "Cozy, warm hand-drawn retro aesthetic"},
    {"id": "Makoto Shinkai inspired", "name": "Makoto Shinkai", "desc": "Spectacular skies, lens flares, and light rays"},
    {"id": "Cyberpunk", "name": "Cyberpunk Neon", "desc": "Glowing neon accents, dark futuristic vibes"},
    {"id": "Watercolor", "name": "Soft Watercolor", "desc": "Delicate ink washes and pastel paper textures"},
    {"id": "Manga", "name": "Manga Ink", "desc": "Classic black and white screen-toned manga layout"},
    {"id": "Comic", "name": "Retro Comic", "desc": "Vintage halftone dot print and bold outlines"},
    {"id": "Oil Painting", "name": "Classical Oil", "desc": "Textured impasto brushstrokes and fine art lighting"}
]

BACKGROUNDS_LIST = [
    {"id": "Cherry Blossoms", "name": "Cherry Blossoms", "desc": "Soft falling pink petals under a warm spring sky"},
    {"id": "Tokyo", "name": "Tokyo Skyline", "desc": "Stunning dark-blue evening view of downtown skyscrapers"},
    {"id": "Cyber City", "name": "Neon Cyber City", "desc": "Vibrant glowing grid streets and high-tech towers"},
    {"id": "Temple", "name": "Traditional Temple", "desc": "Beautiful ancient golden pagoda at sunset"},
    {"id": "Beach", "name": "Tropical Beach", "desc": "Crystal clear azure waves and warm sandy shores"},
    {"id": "Castle", "name": "Mystic Castle", "desc": "Epic medieval stone tower under mystical starlight"}
]

@router.post("/generate", response_model=TaskResponse)
def generate_portrait(req: PhotoGenerateRequest, photo_service: PhotoService = Depends(get_photo_service)):
    """
    Submits a photo to the background queue for Anime style painting synthesis.
    """
    photo = photo_service.get_photo_by_id(req.photo_id)
    if not photo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"Photo record with ID {req.photo_id} not found."
        )
        
    task_id = queue_manager.submit_task(
        photo_id=req.photo_id,
        style=req.style,
        background=req.background
    )
    
    return {
        "task_id": task_id,
        "photo_id": req.photo_id,
        "status": "pending",
        "progress": 0
    }

@router.get("/generate/status/{task_id}", response_model=TaskResponse)
def get_generation_status(task_id: str):
    """
    Polls the processing status, progress percentages, and results of an AI task.
    """
    task = queue_manager.get_task_status(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with ID {task_id} not found."
        )
    return task

@router.get("/styles")
def list_styles() -> List[Dict[str, str]]:
    """
    Lists all supported aesthetic styles.
    """
    return STYLES_LIST

@router.get("/background")
def list_backgrounds() -> List[Dict[str, str]]:
    """
    Lists all replacement background presets.
    """
    return BACKGROUNDS_LIST
