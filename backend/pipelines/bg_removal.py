import os
import urllib.request
import numpy as np
import cv2
from typing import Tuple
from backend.core.config import settings
from backend.utils.logger import logger

class BackgroundRemover:
    def __init__(self):
        self.model_path = settings.U2NET_MODEL_PATH
        self.local_model_path = os.path.join(settings.MODEL_CACHE_DIR, "u2net.onnx")
        self.session = None
        
        # In mock mode, don't download/initialize ONNX
        if settings.MOCK_INFERENCE:
            logger.info("BackgroundRemover initialized in Mock Mode (no ONNX load).")
            return
            
        # Ensure cache directory exists
        os.makedirs(settings.MODEL_CACHE_DIR, exist_ok=True)
        
        try:
            if not os.path.exists(self.local_model_path):
                logger.info(f"Downloading U2Net ONNX model from {self.model_path} to {self.local_model_path}...")
                urllib.request.urlretrieve(self.model_path, self.local_model_path)
                logger.info("U2Net ONNX downloaded successfully.")
                
            import onnxruntime as ort
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if settings.DEVICE == "cuda" else ['CPUExecutionProvider']
            logger.info(f"Loading U2Net ONNX session with providers: {providers}")
            self.session = ort.InferenceSession(self.local_model_path, providers=providers)
            logger.info("U2Net ONNX loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load U2Net background remover: {e}. Falling back to OpenCV grabCut.")
            self.session = None

    def remove_background(self, img: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Removes the background from a BGR image.
        Returns:
            Tuple[mask, foreground_img]
            mask: Gray alpha-mask (0-255)
            foreground_img: BGR image with black background (or transparent/masked)
        """
        if self.session is None:
            # OpenCV Fallback
            return self._fallback_remove(img)
            
        try:
            h, w = img.shape[:2]
            
            # Preprocess image to U2Net format (320x320, normalized, NCHW)
            resized = cv2.resize(img, (320, 320), interpolation=cv2.INTER_AREA)
            resized = resized.astype(np.float32) / 255.0
            
            # Normalize with standard ImageNet stats
            mean = np.array([0.485, 0.456, 0.406])
            std = np.array([0.229, 0.224, 0.225])
            resized = (resized - mean) / std
            
            # HWC to CHW, add batch dim
            input_data = np.transpose(resized, (2, 0, 1))
            input_data = np.expand_dims(input_data, axis=0).astype(np.float32)
            
            # Run inference
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: input_data})
            
            # Extract first output, squeeze batch, scale, and resize back to original size
            mask_data = outputs[0][0, 0, :, :]
            
            # Normalize to 0-255
            mask_data = (mask_data - mask_data.min()) / (mask_data.max() - mask_data.min() + 1e-8)
            mask = (mask_data * 255).astype(np.uint8)
            mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_LINEAR)
            
            # Soften mask edges
            mask = cv2.GaussianBlur(mask, (5, 5), 0)
            
            # Apply mask to create foreground image
            foreground = cv2.bitwise_and(img, img, mask=mask)
            return mask, foreground
            
        except Exception as e:
            logger.error(f"U2Net inference failed: {e}. Falling back to OpenCV grabCut.")
            return self._fallback_remove(img)

    def _fallback_remove(self, img: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        h, w = img.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        
        # Guess background removal using simple grabCut around face area
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        faces = face_cascade.detectMultiScale(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), 1.1, 5)
        
        if len(faces) > 0:
            fx, fy, fw, fh = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)[0]
            # Create a box containing the head and upper torso
            rect = (max(0, fx - int(fw*0.4)), max(0, fy - int(fh*0.4)), min(w - 1, int(fw*1.8)), min(h - 1, int(fh*3)))
            
            bgdModel = np.zeros((1, 65), np.float64)
            fgdModel = np.zeros((1, 65), np.float64)
            
            temp_mask = np.zeros(img.shape[:2], np.uint8)
            try:
                cv2.grabCut(img, temp_mask, rect, bgdModel, fgdModel, 3, cv2.GC_INIT_WITH_RECT)
                mask = np.where((temp_mask == 2) | (temp_mask == 0), 0, 255).astype('uint8')
            except Exception:
                # Basic oval mask fallback if grabcut fails
                cv2.ellipse(mask, (fx + fw//2, fy + fh//2), (fw, fh*2), 0, 0, 360, 255, -1)
        else:
            # Ellipse in center
            cv2.ellipse(mask, (w//2, h//2), (w//3, h//2), 0, 0, 360, 255, -1)
            
        mask = cv2.GaussianBlur(mask, (15, 15), 0)
        foreground = cv2.bitwise_and(img, img, mask=mask)
        return mask, foreground
