from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import time
from backend.models.schemas.photo import PhotoResponse
from backend.services.db_service import PhotoService, get_photo_service, AnalyticsService, get_analytics_service
from backend.utils.logger import logger

router = APIRouter()

@router.post("/print/{photo_id}", response_model=PhotoResponse)
def print_portrait(
    photo_id: str, 
    photo_service: PhotoService = Depends(get_photo_service),
    analytics_service: AnalyticsService = Depends(get_analytics_service)
):
    """
    Submits a photo printing request. Increments the print count on the database.
    In a physical booth, this would communicate with CUPS or a local Windows print spooler.
    """
    photo = photo_service.get_photo_by_id(photo_id)
    if not photo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Photo record not found."
        )
    if not photo.upscaled_url and not photo.anime_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot print an ungenerated image."
        )
        
    start_time = time.time()
    logger.info(f"[Printer Spooler] Queueing print job for Photo ID: {photo_id}")
    
    try:
        # Simulate print spooler communication delay (e.g., 500ms)
        time.sleep(0.5)
        
        # Update database print stats
        updated_photo = photo_service.update_photo_print(photo_id)
        if not updated_photo:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Photo record not found on update."
            )
        
        duration_ms = (time.time() - start_time) * 1000
        
        # Log analytics print event
        analytics_service.log_event(
            event_type="print",
            latency_ms=duration_ms,
            item_id=photo_id,
            details=f"style={photo.style}, print_count={updated_photo.print_count}"
        )
        
        logger.info(f"[Printer Spooler] Print job completed successfully for Photo ID: {photo_id}")
        return updated_photo
        
    except Exception as e:
        logger.error(f"Printer spooler execution failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Printer communications failure: {str(e)}"
        )
