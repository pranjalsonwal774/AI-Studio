import os
import urllib.request
import cv2
import numpy as np
from PIL import Image
from backend.core.config import settings
from backend.utils.logger import logger

class ImageUpscaler:
    def __init__(self):
        self.enabled = False
        self.model_path = settings.REALESRGAN_MODEL_PATH
        self.local_model_path = os.path.join(settings.MODEL_CACHE_DIR, "RealESRGAN_x2plus.pth")
        
        if settings.MOCK_INFERENCE:
            logger.info("ImageUpscaler initialized in Mock Mode (no model loaded).")
            return
            
        try:
            # Check for realesrgan package
            from realesrgan import RealESRGANer
            from basicsr.archs.rrdbnet_arch import RRDBNet
            
            os.makedirs(settings.MODEL_CACHE_DIR, exist_ok=True)
            if not os.path.exists(self.local_model_path):
                logger.info(f"Downloading RealESRGAN model from {self.model_path} to {self.local_model_path}...")
                urllib.request.urlretrieve(self.model_path, self.local_model_path)
                logger.info("RealESRGAN downloaded successfully.")
                
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
            self.upscaler = RealESRGANer(
                scale=2,
                model_path=self.local_model_path,
                model=model,
                tile=400, # tile sizes to avoid OOM on GPUs
                tile_pad=10,
                pre_pad=0,
                half=settings.DEVICE == "cuda", # use half precision in CUDA
                device=settings.DEVICE
            )
            self.enabled = True
            logger.info("RealESRGAN Upscaler loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load RealESRGAN: {e}. Upscaling will run in CPU fallback (OpenCV Bicubic).")
            self.upscaler = None

    def upscale(self, img_pil: Image.Image, scale_factor: int = 2) -> Image.Image:
        """
        Upscales a PIL Image by scale_factor.
        """
        if not self.enabled or self.upscaler is None:
            # OpenCV Fallback (Bicubic Resize)
            return self._fallback_upscale(img_pil, scale_factor)
            
        try:
            # Convert PIL to BGR
            bgr_img = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
            
            # Enhancer outputs BGR image and its mode
            output, _ = self.upscaler.enhance(bgr_img, outscale=scale_factor)
            
            # Convert back to PIL
            output_rgb = cv2.cvtColor(output, cv2.COLOR_BGR2RGB)
            return Image.fromarray(output_rgb)
        except Exception as e:
            logger.error(f"RealESRGAN upscale failed: {e}. Falling back to OpenCV interpolation.")
            return self._fallback_upscale(img_pil, scale_factor)

    def _fallback_upscale(self, img_pil: Image.Image, scale_factor: int) -> Image.Image:
        """
        Bicubic resizing fallback on CPU.
        """
        w, h = img_pil.size
        # Resize using cv2 INTER_CUBIC
        cv2_img = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
        resized = cv2.resize(cv2_img, (w * scale_factor, h * scale_factor), interpolation=cv2.INTER_CUBIC)
        
        # Apply slight sharpening filter to simulate AI edge reconstruction
        sharpen_kernel = np.array([[-0.2,-0.2,-0.2], [-0.2,2.6,-0.2], [-0.2,-0.2,-0.2]])
        resized = cv2.filter2D(resized, -1, sharpen_kernel)
        
        return Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB))
