import time
import os
import cv2
import numpy as np
from PIL import Image
from sqlalchemy.orm import Session
from backend.core.config import settings
from backend.models.database.photo import Photo
from backend.services.storage import storage_service
from backend.pipelines.bg_removal import BackgroundRemover
from backend.pipelines.anime_generator import AnimePortraitGenerator
from backend.pipelines.face_restorer import FaceRestorer
from backend.pipelines.upscaler import ImageUpscaler
from backend.pipelines.mock_pipeline import MockAIPipeline
from backend.utils.image_utils import align_face_cv2
from backend.utils.logger import logger

class AIPipelineManager:
    _instance = None

    def __new__(cls, *args, **kwargs):
        """Singleton pattern for loading models only once."""
        if not cls._instance:
            cls._instance = super(AIPipelineManager, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    def __init__(self):
        # Prevent re-initialization if already loaded
        if hasattr(self, 'initialized'):
            return
            
        self.mock_mode = settings.MOCK_INFERENCE
        
        # Always create the AnimeGANv2-based pipeline (serves as primary in mock mode,
        # fallback in production mode)
        self.mock_pipeline = MockAIPipeline()
        
        if self.mock_mode:
            logger.info("AIPipelineManager initialized in MOCK MODE (AnimeGANv2 ONNX).")
        else:
            logger.info("AIPipelineManager initializing in PRODUCTION CUDA MODE...")
            # Load real models
            self.bg_remover = BackgroundRemover()
            self.anime_generator = AnimePortraitGenerator()
            self.face_restorer = FaceRestorer()
            self.upscaler = ImageUpscaler()
            logger.info("AIPipelineManager production models loaded.")
            
        self.initialized = True

    def generate_portrait(self, photo_id: str, db: Session) -> Photo:
        """
        Runs the full AI pipeline on the captured photo with ID photo_id.
        Saves results, updates DB fields, and returns the photo object.
        """
        photo = db.query(Photo).filter(Photo.id == photo_id).first()
        if not photo:
            raise ValueError(f"Photo with ID {photo_id} not found in database.")
            
        # Parse local path of the original image
        # S3 proxy URLs are parsed to find the local file cache path
        filename = os.path.basename(photo.original_url)
        original_local_path = storage_service.get_file_path("original", filename)
        
        # Verify file exists
        if not os.path.exists(original_local_path):
            raise FileNotFoundError(f"Original image file not found at: {original_local_path}")
            
        start_time = time.time()
        
        # Scenario A: Mock Mode
        if self.mock_mode:
            res = self.mock_pipeline.process(
                original_path=original_local_path,
                style=photo.style,
                background=photo.background,
                upscale_factor=photo.upscale_factor
            )
            
            photo.anime_url = res["anime_url"]
            photo.upscaled_url = res["upscaled_url"]
            photo.processing_time_sec = res["processing_time"]
            db.commit()
            db.refresh(photo)
            return photo
            
        # Scenario B: Production CUDA Pipeline
        try:
            logger.info(f"[Production AI Pipeline] Running task for photo {photo_id}...")
            
            # 1. Read Image
            img_bgr = cv2.imread(original_local_path)
            h, w = img_bgr.shape[:2]
            
            # 2. Face Alignment
            # Locate face and align/normalize to 512x512
            logger.info("Step 1: Running face detection and alignment...")
            # We can use our robust face alignment utility
            gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
            face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(100, 100))
            
            if len(faces) == 0:
                raise ValueError("No face detected in the image for alignment.")
                
            largest_face = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)[0]
            face_aligned = align_face_cv2(img_bgr, list(largest_face))
            
            # 3. Background Removal (U2Net ONNX)
            logger.info("Step 2: Removing background using U2Net...")
            mask, foreground = self.bg_remover.remove_background(img_bgr)
            
            # 4. InstantID + Animagine XL Anime Synthesis
            logger.info("Step 3: Generating Anime illustration with SDXL/InstantID...")
            # Generate anime portrait from the normalized crop
            anime_pil = self.anime_generator.generate_anime(face_aligned, photo.style)
            
            # 5. Face Restoration (GFPGAN)
            logger.info("Step 4: Enhancing details with GFPGAN Face Restorer...")
            restored_pil = self.face_restorer.restore_face(anime_pil)
            
            # 6. Apply Background Replacement
            logger.info("Step 5: Compositing background replacement...")
            restored_bgr = cv2.cvtColor(np.array(restored_pil), cv2.COLOR_RGB2BGR)
            restored_bgr = cv2.resize(restored_bgr, (w, h), interpolation=cv2.INTER_AREA)
            
            # Recreate background matching selection
            # (Similar to mock, generate backdrop color gradient and features)
            # Fetch style colors and build composite
            from backend.pipelines.mock_pipeline import MockAIPipeline
            dummy = MockAIPipeline()
            bg_preset = dummy.bg_presets.get(photo.background, {"bg_color": (30, 30, 30), "detail": "skyline"})
            bg_color = bg_preset["bg_color"]
            
            background_img = np.zeros((h, w, 3), dtype=np.uint8)
            for y_coord in range(h):
                factor = y_coord / h
                c = [int(bg_color[i] * (1 - factor) + (50 if i == 0 else 20) * factor) for i in range(3)]
                background_img[y_coord, :] = c
                
            # Composite using alpha mask
            mask_3d = np.repeat(mask[:, :, np.newaxis], 3, axis=2) / 255.0
            final_composite = (restored_bgr * mask_3d + background_img * (1 - mask_3d)).astype(np.uint8)
            
            final_composite_pil = Image.fromarray(cv2.cvtColor(final_composite, cv2.COLOR_BGR2RGB))
            
            # Save generated anime image
            anime_filename = f"anime_{photo.id[:8]}.jpg"
            _, anime_encoded = cv2.imencode(".jpg", final_composite)
            anime_url = storage_service.upload_file(anime_encoded.tobytes(), "anime", anime_filename)
            
            # 7. AI Upscaling (RealESRGAN)
            logger.info(f"Step 6: Upscaling result {photo.upscale_factor}x using RealESRGAN...")
            upscaled_pil = self.upscaler.upscale(final_composite_pil, scale_factor=photo.upscale_factor)
            
            # Save upscaled image
            upscaled_filename = f"upscaled_{photo.id[:8]}.jpg"
            upscaled_bgr = cv2.cvtColor(np.array(upscaled_pil), cv2.COLOR_RGB2BGR)
            _, upscaled_encoded = cv2.imencode(".jpg", upscaled_bgr)
            upscaled_url = storage_service.upload_file(upscaled_encoded.tobytes(), "upscaled", upscaled_filename)
            
            # Save mask for reference (optional)
            mask_filename = f"mask_{photo.id[:8]}.jpg"
            _, mask_encoded = cv2.imencode(".jpg", mask)
            mask_url = storage_service.upload_file(mask_encoded.tobytes(), "temp", mask_filename)
            
            duration = time.time() - start_time
            logger.info(f"[Production AI Pipeline] Task completed in {duration:.3f} seconds.")
            
            # Update DB photo entry
            photo.anime_url = anime_url
            photo.upscaled_url = upscaled_url
            photo.mask_url = mask_url
            photo.processing_time_sec = duration
            db.commit()
            db.refresh(photo)
            return photo
            
        except Exception as e:
            db.rollback()
            logger.error(f"Inference error in production pipeline: {e}. Executing mock pipeline as fail-safe.")
            # Fail-safe fallback to Mock Mode
            res = self.mock_pipeline.process(
                original_path=original_local_path,
                style=photo.style,
                background=photo.background,
                upscale_factor=photo.upscale_factor
            )
            photo.anime_url = res["anime_url"]
            photo.upscaled_url = res["upscaled_url"]
            photo.processing_time_sec = res["processing_time"]
            db.commit()
            db.refresh(photo)
            return photo

# Initialize globally (instantiated on startup via import)
pipeline_manager = AIPipelineManager()
