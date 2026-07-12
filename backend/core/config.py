import os
import tempfile
from typing import List, Optional
from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _can_write_directory(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        fd, probe_path = tempfile.mkstemp(dir=path)
        os.close(fd)
        os.remove(probe_path)
        return True
    except Exception:
        return False


def _resolve_local_storage_dir() -> str:
    temp_data_dir = os.path.abspath(os.path.join(tempfile.gettempdir(), "img-img", "data"))
    for subdir in ("original", "anime", "upscaled", "temp", "db"):
        os.makedirs(os.path.join(temp_data_dir, subdir), exist_ok=True)
    return temp_data_dir


def _cuda_available() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:
        return False

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # General
    APP_NAME: str = "AI Anime Portrait Studio"
    ENV: str = "development"  # development, production, testing
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"
    
    # Security
    SECRET_KEY: str = "super_secret_neon_key_change_me_in_production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Database (PostgreSQL)
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: str = "5432"
    POSTGRES_DB: str = "anime_studio"
    
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    # Cache & Queue (Redis)
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    
    # Object Storage (MinIO or Local File System fallback)
    USE_S3: bool = False
    S3_ENDPOINT: str = "localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_SECURE: bool = False
    S3_BUCKET_NAME: str = "anime-studio-bucket"
    
    LOCAL_STORAGE_DIR: str = _resolve_local_storage_dir()
    
    # AI Pipeline Configuration
    MOCK_INFERENCE: bool = False
    DEVICE: str = "cpu"
    MODEL_CACHE_DIR: str = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models_cache"))
    
    # AI Model Identifiers/Paths
    SDXL_BASE_MODEL: str = "SG161222/RealVisXL_V4.0" # or cagliostrolab/animagine-xl-3.1
    ANIMAGINE_MODEL: str = "cagliostrolab/animagine-xl-3.1"
    INSTANTID_MODEL: str = "InstantX/InstantID"
    CONTROLNET_CANNY_MODEL: str = "diffusers/controlnet-canny-sdxl-1.0"
    GFPGAN_MODEL_PATH: str = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth"
    REALESRGAN_MODEL_PATH: str = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth"
    U2NET_MODEL_PATH: str = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"

    # Photo booth capture metrics and thresholds
    AUTO_CAPTURE_STREAK_REQUIRED: int = 15  # frames matching criteria (1.5 seconds at 10fps)
    BLUR_THRESHOLD: float = 80.0            # Variance of Laplacian. Lower means more blurry.
    LIGHTING_MIN_BRIGHTNESS: int = 70       # Mean luminance (0-255)
    LIGHTING_MAX_BRIGHTNESS: int = 240
    FACE_CENTER_MAX_OFFSET: float = 0.25    # Maximum relative offset from center (0 to 0.5)
    SMILE_THRESHOLD: float = 0.55
    EYE_OPEN_THRESHOLD: float = 0.2

    # CORS Origins
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_flag(cls, value):
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "y", "on"}:
                return True
            if normalized in {"0", "false", "no", "n", "off", "release", "production", "prod"}:
                return False
            return False
        return value

    @model_validator(mode="after")
    def configure_runtime_mode(self):
        testing_mode = os.environ.get("ENV", "").strip().lower() == "testing"
        explicit_mock = "MOCK_INFERENCE" in os.environ
        explicit_device = "DEVICE" in os.environ

        if not explicit_mock:
            self.MOCK_INFERENCE = testing_mode
            if not self.MOCK_INFERENCE:
                self.MOCK_INFERENCE = not _cuda_available()

        if not explicit_device:
            self.DEVICE = "cuda" if (not self.MOCK_INFERENCE and _cuda_available()) else "cpu"

        return self

settings = Settings()
