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
