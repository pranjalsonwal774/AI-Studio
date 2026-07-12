# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Set the working directory
WORKDIR /app

# Install system dependencies required for OpenCV, InsightFace, and PyTorch compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements.txt first to leverage Docker layer caching
COPY requirements.txt .

# Install dependencies (install CPU-only or CUDA-enabled PyTorch depending on target hardware)
# Here we default to installing standard requirements. GPU support can be optimized via docker-compose.
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Create cache directory for Hugging Face and InsightFace models
RUN mkdir -p /app/models_cache && chmod 777 /app/models_cache
ENV HF_HOME=/app/models_cache
ENV INSIGHTFACE_HOME=/app/models_cache

# Copy the rest of the application code
COPY . .

# Expose port
EXPOSE 8000

# Start FastAPI application
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
