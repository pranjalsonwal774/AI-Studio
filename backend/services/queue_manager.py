import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal
from backend.services.redis_cache import cache_service
from backend.pipelines.pipeline_manager import pipeline_manager
from backend.utils.logger import logger
from backend.models.database.analytics import Analytics

class GenerationQueueManager:
    def __init__(self):
        # In-memory task tracker fallback
        self._local_tasks: Dict[str, Dict[str, Any]] = {}
        # 4 worker threads for local execution
        self.executor = ThreadPoolExecutor(max_workers=4)
        logger.info("Generation Queue Manager initialized.")

    def submit_task(self, photo_id: str, style: str, background: str) -> str:
        """
        Submits a portrait generation task to the background queue.
        Returns a unique task_id.
        """
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        
        task_info = {
            "task_id": task_id,
            "photo_id": photo_id,
            "style": style,
            "background": background,
            "status": "pending",
            "progress": 0,
            "error": None
        }
        
        # Save task state to Redis/Memory
        self._update_task_state(task_id, task_info)
        
        # Dispatch to execution
        self.executor.submit(self._execute_task, task_id, photo_id)
        
        logger.info(f"Submitted task {task_id} for photo {photo_id}")
        return task_id

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves current task details and status.
        """
        state = cache_service.get(f"task:{task_id}")
        if state:
            try:
                return json.loads(state)
            except Exception:
                pass
        return self._local_tasks.get(task_id)

    def _update_task_state(self, task_id: str, info: Dict[str, Any]):
        # Keep local copy
        self._local_tasks[task_id] = info
        
        # Keep Redis copy
        import json
        cache_service.set(f"task:{task_id}", json.dumps(info), expire_seconds=3600)

    def _execute_task(self, task_id: str, photo_id: str):
        logger.info(f"Starting execution of task {task_id}")
        
        # Update status to processing
        task_info = self.get_task_status(task_id) or {
            "task_id": task_id,
            "photo_id": photo_id,
            "status": "pending"
        }
        task_info["status"] = "processing"
        task_info["progress"] = 10
        self._update_task_state(task_id, task_info)
        
        db: Session = SessionLocal()
        start_time = time.time()
        
        try:
            # 1. Update style/background variables on photo row if they changed
            from backend.models.database.photo import Photo
            photo = db.query(Photo).filter(Photo.id == photo_id).first()
            if photo:
                photo.style = task_info.get("style", photo.style)
                photo.background = task_info.get("background", photo.background)
                db.commit()
                
            task_info["progress"] = 30
            self._update_task_state(task_id, task_info)
            
            # 2. Run the AI pipeline
            logger.info(f"Running AI pipeline for photo {photo_id}")
            updated_photo = pipeline_manager.generate_portrait(photo_id, db)
            
            task_info["progress"] = 90
            self._update_task_state(task_id, task_info)
            
            duration_ms = (time.time() - start_time) * 1000
            
            # 3. Log Analytics
            analytics = Analytics(
                event_type="generation",
                latency_ms=duration_ms,
                item_id=photo_id,
                details=f"style={updated_photo.style}, background={updated_photo.background}"
            )
            db.add(analytics)
            db.commit()
            
            # 4. Mark completed
            task_info["status"] = "completed"
            task_info["progress"] = 100
            task_info["anime_url"] = updated_photo.anime_url
            task_info["upscaled_url"] = updated_photo.upscaled_url
            task_info["processing_time_sec"] = updated_photo.processing_time_sec
            self._update_task_state(task_id, task_info)
            
            logger.info(f"Successfully finished task {task_id}")
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error executing task {task_id}: {e}")
            import traceback
            traceback.print_exc()
            
            task_info["status"] = "failed"
            task_info["progress"] = 100
            task_info["error"] = str(e)
            self._update_task_state(task_id, task_info)
        finally:
            db.close()

import time
# Initialize globally
queue_manager = GenerationQueueManager()
