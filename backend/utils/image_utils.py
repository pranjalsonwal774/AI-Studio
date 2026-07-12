import cv2
import numpy as np
import base64
import math
from typing import Tuple, Dict, Any, Optional, List
from backend.core.config import settings
from backend.utils.logger import logger

class _EmptyCascade:
    def detectMultiScale(self, *args, **kwargs):
        return ()


def _load_cascade(filename: str):
    cascade_factory = getattr(cv2, "CascadeClassifier", None)
    cascade_data = getattr(cv2, "data", None)
    if cascade_factory is None or cascade_data is None:
        logger.warning("OpenCV Haar cascades unavailable; using empty face detection fallback.")
        return _EmptyCascade()

    cascade_path = cascade_data.haarcascades + filename
    cascade = cascade_factory(cascade_path)
    if hasattr(cascade, "empty") and cascade.empty():
        logger.warning(f"Failed to load OpenCV cascade: {cascade_path}")
        return _EmptyCascade()
    return cascade


face_cascade = _load_cascade("haarcascade_frontalface_default.xml")
eye_cascade = _load_cascade("haarcascade_eye.xml")
smile_cascade = _load_cascade("haarcascade_smile.xml")

def base64_to_cv2(b64_str: str) -> np.ndarray:
    """
    Converts a base64 encoded image string (with or without data URI prefix) to a CV2 BGR image.
    """
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    
    img_bytes = base64.b64decode(b64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode base64 image")
    return img

def cv2_to_base64(img: np.ndarray, format: str = ".jpg") -> str:
    """
    Converts a CV2 image to a base64 string.
    """
    success, encoded_img = cv2.imencode(format, img)
    if not success:
        raise ValueError("Could not encode image to base64")
    
    b64_bytes = base64.b64encode(encoded_img)
    return f"data:image/jpeg;base64,{b64_bytes.decode('utf-8')}"

def analyze_face_quality(img: np.ndarray) -> Dict[str, Any]:
    """
    Runs real-time quality analytics on a BGR image.
    Returns:
        {
            "face_detected": bool,
            "box": [x, y, w, h] or None,
            "blur_score": float,
            "is_sharp": bool,
            "brightness": float,
            "lighting_ok": bool,
            "centered": bool,
            "eyes_open": bool,
            "smile_detected": bool,
            "passed_all": bool,
            "error": str or None
        }
    """
    h_frame, w_frame = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 1. Detect Face using Haar Cascade
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(100, 100))
    
    if len(faces) == 0:
        return {
            "face_detected": False,
            "box": None,
            "blur_score": 0.0,
            "is_sharp": False,
            "brightness": 0.0,
            "lighting_ok": False,
            "centered": False,
            "eyes_open": False,
            "smile_detected": False,
            "passed_all": False,
            "error": "No face detected"
        }
        
    # Take the largest face
    (x, y, w, h) = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[0]
    face_roi = gray[y:y+h, x:x+w]
    face_color_roi = img[y:y+h, x:x+w]
    
    # 2. Blur Check (Laplacian Variance)
    blur_score = cv2.Laplacian(face_roi, cv2.CV_64F).var()
    is_sharp = blur_score >= settings.BLUR_THRESHOLD
    
    # 3. Lighting Check (Mean Luminance)
    brightness = float(np.mean(face_roi))
    lighting_ok = settings.LIGHTING_MIN_BRIGHTNESS <= brightness <= settings.LIGHTING_MAX_BRIGHTNESS
    
    # 4. Centering Check
    face_center_x = x + w / 2
    face_center_y = y + h / 2
    frame_center_x = w_frame / 2
    frame_center_y = h_frame / 2
    
    offset_x = abs(face_center_x - frame_center_x) / w_frame
    offset_y = abs(face_center_y - frame_center_y) / h_frame
    centered = (offset_x <= settings.FACE_CENTER_MAX_OFFSET) and (offset_y <= settings.FACE_CENTER_MAX_OFFSET)
    
    # 5. Eye Detection Check (Heuristic & Cascade)
    # Detect eyes within the upper half of the face bounding box
    eye_roi_gray = face_roi[0:int(h * 0.55), :]
    eyes = eye_cascade.detectMultiScale(eye_roi_gray, scaleFactor=1.05, minNeighbors=3, minSize=(15, 15))
    # Standard check: should find at least 2 eyes (or 1 if turned, but we want frontal)
    eyes_open = len(eyes) >= 2
    
    # 6. Smile Detection Check (Cascade)
    # Detect smile within the lower half of the face
    mouth_roi_gray = face_roi[int(h * 0.5):, :]
    smiles = smile_cascade.detectMultiScale(mouth_roi_gray, scaleFactor=1.1, minNeighbors=10, minSize=(20, 20))
    smile_detected = len(smiles) >= 1
    
    # Compile results
    passed_all = is_sharp and lighting_ok and centered and eyes_open and smile_detected
    
    # Construct descriptive error message for guidance
    error_msg = None
    if not passed_all:
        errors = []
        if not is_sharp:
            errors.append("Keep steady, camera blurry")
        if not lighting_ok:
            errors.append("Adjust lighting")
        if not centered:
            errors.append("Center your face")
        if not eyes_open:
            errors.append("Keep eyes open and look at camera")
        if not smile_detected:
            errors.append("Smile!")
        error_msg = ", ".join(errors)
        
    return {
        "face_detected": True,
        "box": [int(x), int(y), int(w), int(h)],
        "blur_score": float(blur_score),
        "is_sharp": bool(is_sharp),
        "brightness": float(brightness),
        "lighting_ok": bool(lighting_ok),
        "centered": bool(centered),
        "eyes_open": bool(eyes_open),
        "smile_detected": bool(smile_detected),
        "passed_all": bool(passed_all),
        "error": error_msg
    }

def align_face_cv2(img: np.ndarray, box: List[int]) -> np.ndarray:
    """
    OpenCV fallback face alignment using eye locations if detected, otherwise simple center cropping.
    Normalizes the image to 512x512.
    """
    x, y, w, h = box
    face_roi = img[y:y+h, x:x+w]
    
    # Attempt to locate eyes for rotation correction
    gray_face = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
    eye_roi_gray = gray_face[0:int(h * 0.55), :]
    eyes = eye_cascade.detectMultiScale(eye_roi_gray, scaleFactor=1.05, minNeighbors=3, minSize=(15, 15))
    
    if len(eyes) >= 2:
        # Sort left to right
        eyes = sorted(eyes, key=lambda e: e[0])
        # Find eye centers relative to original image
        eye1_x = x + eyes[0][0] + eyes[0][2]/2
        eye1_y = y + eyes[0][1] + eyes[0][3]/2
        eye2_x = x + eyes[1][0] + eyes[1][2]/2
        eye2_y = y + eyes[1][1] + eyes[1][3]/2
        
        # Calculate angle of rotation
        dy = eye2_y - eye1_y
        dx = eye2_x - eye1_x
        angle = math.degrees(math.atan2(dy, dx))
        
        # Get rotation matrix centered at the midpoint
        midpoint = (int((eye1_x + eye2_x)/2), int((eye1_y + eye2_y)/2))
        rot_mat = cv2.getRotationMatrix2D(midpoint, angle, scale=1.0)
        
        # Rotate whole frame
        rotated = cv2.warpAffine(img, rot_mat, (img.shape[1], img.shape[0]), flags=cv2.INTER_CUBIC)
        
        # Crop rotated face
        x_rot, y_rot = max(0, int(midpoint[0] - w/1.8)), max(0, int(midpoint[1] - h/1.8))
        w_rot, h_rot = int(w * 1.1), int(h * 1.1)
        
        cropped = rotated[y_rot:y_rot+h_rot, x_rot:x_rot+w_rot]
        if cropped.size > 0:
            return cv2.resize(cropped, (512, 512), interpolation=cv2.INTER_AREA)
            
    # Simple resize fallback if alignment fails
    resized = cv2.resize(face_roi, (512, 512), interpolation=cv2.INTER_AREA)
    return resized
