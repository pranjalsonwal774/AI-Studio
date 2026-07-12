import pytest
import os
import cv2
import numpy as np

os.environ["ENV"] = "testing"
os.environ["MOCK_INFERENCE"] = "True"
os.environ["DEBUG"] = "false"

from backend.pipelines.mock_pipeline import MockAIPipeline
from backend.core.config import settings

def test_mock_pipeline_execution():
    # 1. Create a dummy test image to run the pipeline against
    test_dir = os.path.join(settings.LOCAL_STORAGE_DIR, "temp")
    os.makedirs(test_dir, exist_ok=True)
    dummy_image_path = os.path.join(test_dir, "test_face.jpg")
    
    # Create black image with center square to act as face bounding region
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.rectangle(img, (200, 100), (440, 380), (255, 255, 255), -1)
    cv2.imwrite(dummy_image_path, img)

    # 2. Run mock pipeline
    pipeline = MockAIPipeline()
    results = pipeline.process(
        original_path=dummy_image_path,
        style="Anime",
        background="Cherry Blossoms",
        upscale_factor=2
    )

    # 3. Assert results
    assert "anime_url" in results
    assert "upscaled_url" in results
    assert "processing_time" in results
    
    assert results["anime_url"].startswith("/static/anime/")
    assert results["upscaled_url"].startswith("/static/upscaled/")
    
    # Clean up test image
    if os.path.exists(dummy_image_path):
        os.remove(dummy_image_path)
