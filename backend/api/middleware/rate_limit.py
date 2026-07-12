from fastapi import Request, HTTPException, status
from backend.services.redis_cache import cache_service
from backend.utils.logger import logger

class RateLimiter:
    def __init__(self, requests_per_minute: int = 60):
        self.limit = requests_per_minute

    async def __call__(self, request: Request):
        # Allow requests in development or test environment bypass if needed
        # Identify client IP
        client_ip = request.client.host if request.client else "unknown"
        
        # Build cache key
        rate_key = f"rate_limit:{client_ip}"
        
        try:
            current_count = cache_service.increment_rate_limit(rate_key, window_seconds=60)
            if current_count > self.limit:
                logger.warning(f"Rate limit exceeded for IP: {client_ip} ({current_count}/{self.limit})")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please wait a minute before submitting more frames."
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Rate limiting failure: {e}")
            # Dynamic fallback: fail-open in case rate-limiter breaks to prevent complete site down
            pass
