import json
import time
from typing import Any, Optional
import redis
from backend.core.config import settings
from backend.utils.logger import logger

class RedisCacheService:
    def __init__(self):
        self.host = settings.REDIS_HOST
        self.port = settings.REDIS_PORT
        self.db = settings.REDIS_DB
        self.client = None
        self._mock_cache = {}
        self._mock_expirations = {}

        try:
            logger.info(f"Connecting to Redis at: {self.host}:{self.port}")
            self.client = redis.Redis(
                host=self.host, port=self.port, db=self.db, socket_timeout=2.0
            )
            self.client.ping()
            logger.info("Successfully connected to Redis.")
        except (redis.ConnectionError, Exception) as e:
            logger.warning(
                f"Redis connection failed: {e}. "
                "Falling back to Local In-Memory Cache."
            )
            self.client = None

    def _is_expired(self, key: str) -> bool:
        if key not in self._mock_expirations:
            return False
        if time.time() > self._mock_expirations[key]:
            # Clean up
            self._mock_cache.pop(key, None)
            self._mock_expirations.pop(key, None)
            return True
        return False

    def get(self, key: str) -> Optional[str]:
        if self.client:
            try:
                val = self.client.get(key)
                return val.decode("utf-8") if val else None
            except Exception as e:
                logger.error(f"Redis get failed for {key}: {e}")
                
        # Mock Fallback
        if self._is_expired(key):
            return None
        return self._mock_cache.get(key)

    def set(self, key: str, value: str, expire_seconds: Optional[int] = None) -> bool:
        if self.client:
            try:
                if expire_seconds:
                    self.client.setex(key, expire_seconds, value)
                else:
                    self.client.set(key, value)
                return True
            except Exception as e:
                logger.error(f"Redis set failed for {key}: {e}")

        # Mock Fallback
        self._mock_cache[key] = value
        if expire_seconds:
            self._mock_expirations[key] = time.time() + expire_seconds
        else:
            self._mock_expirations.pop(key, None)
        return True

    def delete(self, key: str) -> bool:
        if self.client:
            try:
                self.client.delete(key)
                return True
            except Exception as e:
                logger.error(f"Redis delete failed for {key}: {e}")

        # Mock Fallback
        self._mock_cache.pop(key, None)
        self._mock_expirations.pop(key, None)
        return True

    def increment_rate_limit(self, key: str, window_seconds: int = 60) -> int:
        """
        Increments request counter for rate limiting. Returns current count.
        """
        if self.client:
            try:
                # Atomically increment key and set expire on first call
                pipe = self.client.pipeline()
                pipe.incr(key)
                pipe.expire(key, window_seconds)
                results = pipe.execute()
                return results[0]
            except Exception as e:
                logger.error(f"Redis rate limit failed for {key}: {e}")
                
        # Mock Fallback
        counter_key = f"rate:{key}"
        if self._is_expired(counter_key):
            self._mock_cache[counter_key] = "0"
            
        current = int(self._mock_cache.get(counter_key, "0")) + 1
        self._mock_cache[counter_key] = str(current)
        if counter_key not in self._mock_expirations:
            self._mock_expirations[counter_key] = time.time() + window_seconds
        return current

cache_service = RedisCacheService()
