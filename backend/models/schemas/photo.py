from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class PhotoGenerateRequest(BaseModel):
    photo_id: str
    style: str
    background: str

class PhotoUpscaleRequest(BaseModel):
    photo_id: str
    upscale_factor: Optional[int] = 2

class PhotoResponse(BaseModel):
    id: str
    user_id: Optional[str] = None
    original_url: str
    anime_url: Optional[str] = None
    upscaled_url: Optional[str] = None
    style: str
    background: str
    upscale_factor: int
    printed: bool
    print_count: int
    processing_time_sec: float
    created_at: datetime

    class Config:
        from_attributes = True

class TaskResponse(BaseModel):
    task_id: str
    photo_id: str
    status: str
    progress: int
    anime_url: Optional[str] = None
    upscaled_url: Optional[str] = None
    error: Optional[str] = None
