import pytest
from fastapi.testclient import TestClient
import os
import io
from PIL import Image

# Force mock mode and testing DB url configuration before imports
os.environ["ENV"] = "testing"
os.environ["MOCK_INFERENCE"] = "True"

from backend.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
    assert response.json()["mock_mode"] is True

def test_list_styles_and_backgrounds():
    # Styles
    res = client.get("/api/v1/styles")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert len(res.json()) > 0
    assert "id" in res.json()[0]

    # Backgrounds
    res = client.get("/api/v1/background")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert len(res.json()) > 0
    assert "id" in res.json()[0]

def test_auth_flows():
    import uuid
    random_str = uuid.uuid4().hex[:6]
    email = f"test_{random_str}@example.com"
    username = f"user_{random_str}"
    password = "secretpassword"

    # 1. Register User
    reg_res = client.post("/api/v1/auth/register", json={
        "email": email,
        "username": username,
        "password": password
    })
    assert reg_res.status_code == 201
    reg_json = reg_res.json()
    assert "access_token" in reg_json
    assert reg_json["user"]["username"] == username

    # 2. Login User
    login_res = client.post("/api/v1/auth/login", json={
        "username": username,
        "password": password
    })
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    assert token is not None

    # 3. Get Current User profile (Authenticated)
    me_res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == email

def test_manual_capture_and_generation():
    # Create a dummy image in memory
    img = Image.new('RGB', (640, 480), color = 'blue')
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    buf.seek(0)
    
    # Upload capture
    response = client.post(
        "/api/v1/capture",
        files={"file": ("test.jpg", buf, "image/jpeg")},
        data={"style": "Anime", "background": "Cherry Blossoms"}
    )
    assert response.status_code == 200
    photo_data = response.json()
    assert "id" in photo_data
    photo_id = photo_data["id"]
    assert photo_data["original_url"] is not None

    # Trigger Generation task
    gen_response = client.post(
        "/api/v1/generate",
        json={"photo_id": photo_id, "style": "Anime", "background": "Cherry Blossoms"}
    )
    assert gen_response.status_code == 200
    task_data = gen_response.json()
    assert "task_id" in task_data
    assert task_data["status"] in ["pending", "processing", "completed"]
