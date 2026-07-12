import os
import urllib.request
import cv2
import numpy as np
from PIL import Image
from backend.core.config import settings
from backend.utils.logger import logger

class FaceRestorer:
    def __init__(self):
        self.enabled = False
        self.model_path = settings.GFPGAN_MODEL_PATH
        self.local_model_path = os.path.join(settings.MODEL_CACHE_DIR, "GFPGANv1.3.pth")
        
        if settings.MOCK_INFERENCE:
            logger.info("FaceRestorer initialized in Mock Mode (no model loaded).")
            return
            
        try:
            # Check if GFPGAN package is installed
            import gfpgan
            
            # Ensure model cache exists
            os.makedirs(settings.MODEL_CACHE_DIR, exist_ok=True)
            
            if not os.path.exists(self.local_model_path):
                logger.info(f"Downloading GFPGAN model from {self.model_path} to {self.local_model_path}...")
                urllib.request.urlretrieve(self.model_path, self.local_model_path)
                logger.info("GFPGAN model downloaded.")
                
            from gfpgan import GFPGANer
            self.restorer = GFPGANer(
                model_path=self.local_model_path,
                upscale=1, # perform restoration without changing output dimensions
                arch='clean',
                channel_multiplier=2,
                device=settings.DEVICE
            )
            self.enabled = True
            logger.info("GFPGAN Face Restorer loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load GFPGAN: {e}. Face restoration will be bypassed.")
            self.restorer = None

    def restore_face(self, img_pil: Image.Image) -> Image.Image:
        """
        Runs GFPGAN on PIL Image. Returns restored PIL Image.
        """
        if not self.enabled or self.restorer is None:
            # Passthrough
            return img_pil
            
        try:
            # Convert PIL to BGR OpenCV format
            bgr_img = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
            
            # Run GFPGAN
            # cropped_faces: faces detected and cropped
            # restored_faces: faces restored
            # restored_img: final output image with restored face blended back
            _, _, restored_img = self.restorer.enhance(
                bgr_img,
                has_aligned=False,
                only_center_face=False,
                paste_back=True
            )
            
            # Convert BGR back to PIL RGB
            restored_rgb = cv2.cvtColor(restored_img, cv2.COLOR_BGR2RGB)
            return Image.fromarray(restored_rgb)
        except Exception as e:
            logger.error(f"GFPGAN face enhancement failed: {e}. Bypassing face restoration.")
            return img_pil
