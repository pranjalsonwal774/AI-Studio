import json
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
from backend.core.config import settings
from backend.core.database import get_db
from backend.models.database.photo import Photo
from backend.services.storage import storage_service
from backend.utils.image_utils import base64_to_cv2, analyze_face_quality
from backend.utils.logger import logger

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New WebSocket client connected. Active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Active: {len(self.active_connections)}")

manager = ConnectionManager()

@router.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket, db: Session = Depends(get_db)):
    await manager.connect(websocket)
    
    # State tracking for auto-capture streak
    streak = 0
    required_streak = settings.AUTO_CAPTURE_STREAK_REQUIRED
    
    try:
        while True:
            # Expect JSON from client
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            b64_img = payload.get("image")
            style = payload.get("style", "Anime")
            background = payload.get("background", "Cherry Blossoms")
            user_id = payload.get("user_id") # optional, depending on if logged in
            
            if not b64_img:
                await websocket.send_json({"error": "No image data provided"})
                continue
                
            try:
                # 1. Convert base64 to CV2 image
                img = base64_to_cv2(b64_img)
            except Exception as e:
                await websocket.send_json({"error": f"Invalid image format: {str(e)}"})
                continue
                
            # 2. Analyze quality
            analysis = analyze_face_quality(img)
            
            # 3. Update capture streak
            if analysis["passed_all"]:
                streak += 1
            else:
                # Reset streak if quality check fails
                streak = 0
                
            analysis["streak"] = streak
            analysis["streak_percent"] = min(100.0, (streak / required_streak) * 100.0)
            
            # 4. Trigger auto-capture if streak is satisfied
            if streak >= required_streak:
                logger.info(f"Auto-capture triggered! Streak reached {streak}")
                
                # Save original image to disk/storage
                filename = f"capture_{uuid.uuid4().hex[:12]}.jpg"
                import cv2
                _, img_encoded = cv2.imencode(".jpg", img)
                img_bytes = img_encoded.tobytes()
                
                original_url = storage_service.upload_file(img_bytes, "original", filename)
                
                # Insert photo record into DB
                photo = Photo(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    original_url=original_url,
                    style=style,
                    background=background,
                    blur_score=analysis["blur_score"],
                    brightness_score=analysis["brightness"],
                    smile_score=1.0 if analysis["smile_detected"] else 0.0,
                    is_public=True
                )
                db.add(photo)
                db.commit()
                db.refresh(photo)
                
                # Send success capture event
                capture_payload = {
                    "event": "auto-capture",
                    "photo_id": photo.id,
                    "original_url": original_url,
                    "style": style,
                    "background": background,
                    "analysis": {
                        "blur_score": analysis["blur_score"],
                        "brightness": analysis["brightness"]
                    }
                }
                await websocket.send_json(capture_payload)
                
                # Reset streak for subsequent captures
                streak = 0
            else:
                # Send standard frame evaluation back to UI
                analysis["event"] = "frame-eval"
                await websocket.send_json(analysis)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket execution error: {e}")
        manager.disconnect(websocket)
