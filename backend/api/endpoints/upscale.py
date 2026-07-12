from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import time
from backend.core.database import get_db
from backend.models.schemas.photo import PhotoUpscaleRequest, PhotoResponse
from backend.services.db_service import db_service
from backend.pipelines.pipeline_manager import pipeline_manager
from backend.utils.logger import logger
from backend.models.database.analytics import Analytics

router = APIRouter()

@router.post("/upscale", response_model=PhotoResponse)
def upscale_portrait(req: PhotoUpscaleRequest, db: Session = Depends(get_db)):
    """
    Manually trigger upscaling on a generated photo record.
    """
    photo = db_service.get_photo(db, req.photo_id)
    if not photo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Photo record not found."
        )
    if not photo.anime_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anime painting must be generated before upscaling can run."
        )
        
    start_time = time.time()
    logger.info(f"Manually triggering upscale for photo {req.photo_id} at factor {req.upscale_factor}x")
    
    try:
        # Load upscaled pipeline through manager
        if pipeline_manager.mock_mode:
            # Fallback
            from backend.pipelines.mock_pipeline import MockAIPipeline
            dummy = MockAIPipeline()
            # Read local anime filepath
            filename = f"anime_{photo.id[:8]}.jpg"
            anime_local_path = pipeline_manager.storage_service.get_file_path("anime", filename)
            
            # Simulated upscale
            import cv2
            img = cv2.imread(anime_local_path)
            if img is not None:
                h, w = img.shape[:2]
                upscaled_img = cv2.resize(img, (w*req.upscale_factor, h*req.upscale_factor), interpolation=cv2.INTER_CUBIC)
                upscaled_filename = f"upscaled_{photo.id[:8]}.jpg"
                _, upscaled_encoded = cv2.imencode(".jpg", upscaled_img)
                upscaled_url = pipeline_manager.storage_service.upload_file(upscaled_encoded.tobytes(), "upscaled", upscaled_filename)
                photo.upscaled_url = upscaled_url
                photo.upscale_factor = req.upscale_factor
                db.commit()
        else:
            # Run real RealESRGAN
            from PIL import Image
            filename = f"anime_{photo.id[:8]}.jpg"
            anime_local_path = pipeline_manager.storage_service.get_file_path("anime", filename)
            
            if os.path.exists(anime_local_path):
                img_pil = Image.open(anime_local_path)
                upscaled_pil = pipeline_manager.upscaler.upscale(img_pil, scale_factor=req.upscale_factor)
                
                upscaled_filename = f"upscaled_{photo.id[:8]}.jpg"
                import numpy as np
                upscaled_bgr = cv2.cvtColor(np.array(upscaled_pil), cv2.COLOR_RGB2BGR)
                _, upscaled_encoded = cv2.imencode(".jpg", upscaled_bgr)
                upscaled_url = pipeline_manager.storage_service.upload_file(upscaled_encoded.tobytes(), "upscaled", upscaled_filename)
                
                photo.upscaled_url = upscaled_url
                photo.upscale_factor = req.upscale_factor
                db.commit()
                
        duration_ms = (time.time() - start_time) * 1000
        
        # Log analytics
        analytics = Analytics(
            event_type="upscale",
            latency_ms=duration_ms,
            item_id=photo.id,
            details=f"factor={req.upscale_factor}x"
        )
        db.add(analytics)
        db.commit()
        db.refresh(photo)
        
        logger.info(f"Upscaling finished for photo {req.photo_id}")
        return photo
        
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to upscale image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upscaling execution failed: {str(e)}"
        )
