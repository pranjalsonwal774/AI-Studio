import os
import shutil
from typing import BinaryIO, Union
from backend.core.config import settings
from backend.utils.logger import logger

class StorageService:
    def __init__(self):
        self.use_s3 = settings.USE_S3
        self.s3_client = None
        
        # Always ensure local storage paths exist for temp/fallback cache
        self.local_dir = settings.LOCAL_STORAGE_DIR
        self.subdirs = ["original", "anime", "upscaled", "temp"]
        for subdir in self.subdirs:
            os.makedirs(os.path.join(self.local_dir, subdir), exist_ok=True)
            
        if self.use_s3:
            try:
                import boto3
                from botocore.config import Config
                
                # Check for secure connection config
                self.s3_client = boto3.client(
                    's3',
                    endpoint_url=f"{'https' if settings.S3_SECURE else 'http'}://{settings.S3_ENDPOINT}",
                    aws_access_key_id=settings.S3_ACCESS_KEY,
                    aws_secret_access_key=settings.S3_SECRET_KEY,
                    config=Config(signature_version='s3v4')
                )
                
                # Check if bucket exists, create if not
                try:
                    self.s3_client.head_bucket(Bucket=settings.S3_BUCKET_NAME)
                    logger.info(f"S3/MinIO bucket '{settings.S3_BUCKET_NAME}' found.")
                except Exception:
                    logger.info(f"S3/MinIO bucket '{settings.S3_BUCKET_NAME}' not found. Creating it...")
                    self.s3_client.create_bucket(Bucket=settings.S3_BUCKET_NAME)
                    
            except Exception as e:
                logger.error(f"Failed to initialize S3 Storage: {e}. Falling back to local storage.")
                self.use_s3 = False

    def upload_file(self, file_data: Union[bytes, BinaryIO], folder: str, filename: str) -> str:
        """
        Uploads a file to either S3 or Local storage.
        Returns the public URL/path of the uploaded resource.
        """
        local_path = os.path.join(self.local_dir, folder, filename)
        
        # Always write to local storage first (acting as cache or primary depending on use_s3)
        try:
            if isinstance(file_data, bytes):
                with open(local_path, "wb") as f:
                    f.write(file_data)
            else:
                with open(local_path, "wb") as f:
                    shutil.copyfileobj(file_data, f)
            logger.info(f"Saved file locally at: {local_path}")
        except Exception as e:
            logger.error(f"Failed to write file to local disk: {e}")
            raise e

        # If S3 is active, upload it
        if self.use_s3 and self.s3_client:
            s3_key = f"{folder}/{filename}"
            try:
                if isinstance(file_data, bytes):
                    self.s3_client.put_object(
                        Bucket=settings.S3_BUCKET_NAME,
                        Key=s3_key,
                        Body=file_data
                    )
                else:
                    file_data.seek(0)
                    self.s3_client.put_object(
                        Bucket=settings.S3_BUCKET_NAME,
                        Key=s3_key,
                        Body=file_data.read()
                    )
                logger.info(f"Uploaded file to S3 at key: {s3_key}")
                # Generate S3 URL
                return f"/api/v1/download/s3/{s3_key}" # custom proxy endpoint to avoid direct MinIO exposure
            except Exception as e:
                logger.error(f"S3 upload failed for {s3_key}: {e}. Defaulting to local path.")
                
        # Return URL mapping to backend static files endpoint
        return f"/static/{folder}/{filename}"

    def get_file_path(self, folder: str, filename: str) -> str:
        """
        Returns local absolute file path for models or manipulation.
        """
        return os.path.join(self.local_dir, folder, filename)

storage_service = StorageService()
