from sqlalchemy import Column, Integer, String, Float, DateTime, func
from backend.core.database import Base
import uuid

class Analytics(Base):
    __tablename__ = "analytics"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    event_type = Column(String, index=True, nullable=False) # 'capture', 'generation', 'upscale', 'print', 'api_request'
    
    # Quantitative measurements
    latency_ms = Column(Float, default=0.0)
    gpu_memory_used_mb = Column(Float, default=0.0)
    
    # Metadata attributes
    item_id = Column(String, nullable=True) # ID of Photo or User if applicable
    details = Column(String, nullable=True) # JSON or descriptive string
    
    timestamp = Column(DateTime, default=func.now())
