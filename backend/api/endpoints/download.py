from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
import io
import qrcode
import os
from backend.core.database import get_db
from backend.services.db_service import db_service
from backend.services.storage import storage_service
from backend.utils.logger import logger

router = APIRouter()

@router.get("/download/qr/{photo_id}")
def get_download_qr_code(
    photo_id: str,
    base_url: str = Query("http://localhost:3000"),
    db: Session = Depends(get_db)
):
    """
    Generates a dynamic QR Code image pointing to the mobile view page of the photo.
    This lets users easily scan and download the photo onto their phones.
    """
    photo = db_service.get_photo(db, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
        
    # URL that the QR code will point to
    # E.g., http://localhost:3000/download/view/uuid
    target_url = f"{base_url}/gallery?view={photo_id}"
    
    try:
        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(target_url)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")
        
        # Save to memory buffer
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        
        return StreamingResponse(buf, media_type="image/png")
    except Exception as e:
        logger.error(f"Failed to generate QR code for {photo_id}: {e}")
        raise HTTPException(status_code=500, detail="QR Code generation failed")

@router.get("/download/file/{photo_type}/{photo_id}")
def download_image_file(
    photo_type: str, # 'original', 'anime', 'upscaled'
    photo_id: str,
    db: Session = Depends(get_db)
):
    """
    Streams the requested image file as an attachment.
    """
    photo = db_service.get_photo(db, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
        
    url_map = {
        "original": photo.original_url,
        "anime": photo.anime_url,
        "upscaled": photo.upscaled_url
    }
    
    file_url = url_map.get(photo_type)
    if not file_url:
        raise HTTPException(status_code=400, detail="Requested image variant is not available yet")
        
    filename = os.path.basename(file_url)
    folder = photo_type
    if photo_type == "upscaled":
        folder = "upscaled"
    elif photo_type == "anime":
        folder = "anime"
    else:
        folder = "original"
        
    local_path = storage_service.get_file_path(folder, filename)
    if not os.path.exists(local_path):
        raise HTTPException(status_code=404, detail="File not found in local cache storage")
        
    return FileResponse(
        path=local_path,
        media_type="image/jpeg",
        filename=f"ai_studio_{photo_type}_{photo_id[:8]}.jpg"
    )

@router.get("/download/s3/{folder}/{filename}")
def proxy_s3_file(folder: str, filename: str):
    """
    Proxies file serving from S3/MinIO bucket to avoid CORS/credential issues.
    """
    local_path = storage_service.get_file_path(folder, filename)
    if not os.path.exists(local_path):
        raise HTTPException(status_code=404, detail="Resource not found in storage")
    return FileResponse(local_path, media_type="image/jpeg")
