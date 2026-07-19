from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from backend.core.config import settings
from backend.core.database import engine, Base
from backend.api.router import api_router
from backend.api.websockets import router as ws_router
from backend.api.middleware.rate_limit import RateLimiter
from backend.utils.logger import logger

# Initialize database schemas
logger.info("Initializing database schemas...")
try:
    # This automatically registers tables in PostgreSQL or SQLite fallback
    Base.metadata.create_all(bind=engine)
    logger.info("Database schemas created successfully.")
except Exception as e:
    logger.error(f"Failed to create database schemas: {e}")

# Ensure Ghibli ONNX model is available in static directory for client-side WebGL download
try:
    static_models_dir = os.path.join(settings.LOCAL_STORAGE_DIR, "models")
    os.makedirs(static_models_dir, exist_ok=True)
    static_model_path = os.path.join(static_models_dir, "AnimeGANv2_Hayao.onnx")
    cache_model_path = os.path.join(settings.MODEL_CACHE_DIR, "AnimeGANv2_Hayao.onnx")
    
    if os.path.exists(cache_model_path):
        import shutil
        if not os.path.exists(static_model_path) or os.path.getsize(static_model_path) != os.path.getsize(cache_model_path):
            shutil.copy2(cache_model_path, static_model_path)
            logger.info(f"Copied Ghibli model to static directory: {static_model_path}")
    else:
        if not os.path.exists(static_model_path):
            from backend.pipelines.mock_pipeline import ANIMEGAN_PRIMARY_URL, _download_model
            logger.info("Ghibli model not found in cache. Downloading directly to static folder...")
            _download_model(ANIMEGAN_PRIMARY_URL, static_model_path)
except Exception as model_err:
    logger.error(f"Failed to prepare static model: {model_err}")

# Rate limiter instance (applied globally to APIs, bypassed for WebSockets and downloads)
limiter = RateLimiter(requests_per_minute=120)

app = FastAPI(
    title=settings.APP_NAME,
    description="Production-grade AI Anime Portrait Studio backend with real-time face analytics and style conversion.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS configurations
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Mount local data storage directory as static paths so frontend can query images directly
os.makedirs(settings.LOCAL_STORAGE_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=settings.LOCAL_STORAGE_DIR), name="static")
logger.info(f"Mounted static storage directory: {settings.LOCAL_STORAGE_DIR} at /static")

# Include endpoint routes (with global rate limit)
app.include_router(api_router, prefix=settings.API_V1_STR, dependencies=[Depends(limiter)])

# Include WebSockets route (rate limit bypassed)
app.include_router(ws_router)

@app.get("/health", tags=["System"])
def health_check():
    """
    Health check API.
    """
    return {
        "status": "healthy",
        "app_name": settings.APP_NAME,
        "mock_mode": settings.MOCK_INFERENCE,
        "device": settings.DEVICE
    }

if __name__ == "__main__":
    import uvicorn
    # Start server
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
