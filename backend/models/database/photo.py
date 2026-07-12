from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, func
from sqlalchemy.orm import relationship
from backend.core.database import Base
import uuid

class Photo(Base):
    __tablename__ = "photos"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    
    # Image file references (Paths or URLs)
    original_url = Column(String, nullable=False)
    anime_url = Column(String, nullable=True)
    upscaled_url = Column(String, nullable=True)
    mask_url = Column(String, nullable=True)  # Alpha mask if kept
    
    # Settings used
    style = Column(String, nullable=False)      # e.g., Studio Ghibli, Cyberpunk
    background = Column(String, nullable=False) # e.g., Cherry Blossoms, Tokyo
    upscale_factor = Column(Integer, default=2) # 2 or 4
    
    # Capture parameters (Quality signals)
    blur_score = Column(Float, nullable=True)
    brightness_score = Column(Float, nullable=True)
    smile_score = Column(Float, nullable=True)
    
    # Status and metrics
    is_public = Column(Boolean, default=True)  # Shows in public gallery
    printed = Column(Boolean, default=False)
    print_count = Column(Integer, default=0)
    processing_time_sec = Column(Float, default=0.0)
    
    created_at = Column(DateTime, default=func.now())
    
    user = relationship("User", back_populates="photos")
