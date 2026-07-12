from fastapi import APIRouter
from backend.api.endpoints import (
    auth,
    capture,
    generate,
    upscale,
    download,
    history,
    gallery,
    print,
    admin
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(capture.router, tags=["Capture"])
api_router.include_router(generate.router, tags=["Generation"])
api_router.include_router(upscale.router, tags=["Upscaling"])
api_router.include_router(download.router, tags=["Download & Sharing"])
api_router.include_router(history.router, tags=["History"])
api_router.include_router(gallery.router, tags=["Gallery"])
api_router.include_router(print.router, tags=["Printing"])
api_router.include_router(admin.router, tags=["Admin Dashboard"])
