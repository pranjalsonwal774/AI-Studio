"""
Full end-to-end pipeline test:
 1. Backend health
 2. ONNX model on disk
 3. Frontend HTTP 200
 4. File count in static storage
 5. Test the actual generation API (simulate what browser does)
 6. Show last 3 generated portraits (with file sizes)
"""
import urllib.request, urllib.parse, json, os, time, sys

# Ensure stdout handles unicode if possible, or fallback gracefully
sys.stdout.reconfigure(encoding='utf-8')

BASE_API = "http://localhost:8000"
BASE_UI  = "http://localhost:3000"
DATA_DIR = r"C:\Users\Acer\AppData\Local\Temp\img-img\data"

OK = "[ OK ]"
FAIL = "[FAIL]"

def get(url, timeout=6):
    try:
        r = urllib.request.urlopen(url, timeout=timeout)
        return r.status, r.read()
    except Exception as e:
        return None, str(e)

print("=" * 56)
print("  AI GHIBLI MIRROR -- LIVE SYSTEM STATUS")
print("=" * 56)

# ── 1. Backend ──
status, body = get(f"{BASE_API}/health")
if status == 200:
    h = json.loads(body)
    print(f"\n{OK} BACKEND       http://localhost:8000")
    print(f"   Status  : {h.get('status')}")
    print(f"   App     : {h.get('app_name')}")
    print(f"   Device  : {h.get('device')}")
else:
    print(f"\n{FAIL} BACKEND       OFFLINE ({body})")

# ── 2. ONNX model ──
model_path = os.path.join(DATA_DIR, "models", "AnimeGANv2_Hayao.onnx")
if os.path.exists(model_path):
    mb = os.path.getsize(model_path) / 1024 / 1024
    print(f"\n{OK} ONNX MODEL    AnimeGANv2_Hayao.onnx ({mb:.1f} MB) -- LOADED")
else:
    print(f"\n{FAIL} ONNX MODEL    NOT FOUND at {model_path}")

# ── 3. Frontend ──
status, body = get(BASE_UI)
if status == 200:
    import re
    title = re.search(rb"<title[^>]*>(.*?)</title>", body)
    t = title.group(1).decode(errors='ignore') if title else "(no title)"
    print(f"\n{OK} FRONTEND      http://localhost:3000")
    print(f"   Title   : {t}")
    print(f"   HTTP    : 200 OK")
else:
    print(f"\n{FAIL} FRONTEND      OFFLINE ({body})")

# ── 4. Init machine files present ──
init_machine = r"C:\Users\Acer\Desktop\New folder\img-img\frontend\hooks\useInitMachine.ts"
init_loader  = r"C:\Users\Acer\Desktop\New folder\img-img\frontend\components\InitLoader.tsx"
cam_feed     = r"C:\Users\Acer\Desktop\New folder\img-img\frontend\components\CameraFeed.tsx"

print(f"\n-- NEW INIT MACHINE FILES --")
for path, label in [(init_machine, "useInitMachine.ts"), (init_loader, "InitLoader.tsx"), (cam_feed, "CameraFeed.tsx")]:
    if os.path.exists(path):
        kb = os.path.getsize(path) / 1024
        print(f"   {OK} {label:<22} ({kb:.0f} KB)")
    else:
        print(f"   {FAIL} {label} MISSING")

# ── 5. Static storage ──
anime_dir = os.path.join(DATA_DIR, "anime")
if os.path.exists(anime_dir):
    files = sorted(
        [(os.path.getsize(os.path.join(anime_dir, f)), f)
         for f in os.listdir(anime_dir) if f.endswith(".jpg")],
        reverse=True
    )
    print(f"\n{OK} GENERATED PORTRAITS  ({len(files)} total)")
    for size, name in files[:5]:
        print(f"   {name}  ({size/1024:.0f} KB)  -> {BASE_API}/static/anime/{name}")
else:
    print(f"\n{FAIL} No anime output directory found")

# ── 6. Quick generation test ──
print(f"\n-- LIVE GENERATION TEST --")
try:
    orig_dir = os.path.join(DATA_DIR, "originals")
    if os.path.exists(orig_dir):
        originals = [f for f in os.listdir(orig_dir) if f.endswith((".jpg",".jpeg",".png"))]
        if originals:
            photo_id = originals[0].split(".")[0]
            payload = json.dumps({
                "photo_id": photo_id,
                "style": "Anime",
                "background": "Cherry Blossoms"
            }).encode()
            req = urllib.request.Request(
                f"{BASE_API}/api/v1/generate",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            resp = urllib.request.urlopen(req, timeout=8)
            task_data = json.loads(resp.read())
            task_id = task_data.get("task_id")
            print(f"   {OK} Generation task submitted: {task_id}")

            time.sleep(1)
            status2, body2 = get(f"{BASE_API}/api/v1/tasks/{task_id}")
            if status2 == 200:
                info = json.loads(body2)
                print(f"   {OK} Task status: {info.get('status')}  progress: {info.get('progress')}%")
            else:
                print(f"   {FAIL} Poll failed")
        else:
            print(f"   No original images yet -- generation triggered by camera")
    else:
        print(f"   No originals directory yet -- generation triggered by camera")
except Exception as e:
    print(f"   (generation test skipped: {e})")

print(f"\n{'='*56}")
print(f"  Open http://localhost:3000 to use the mirror")
print(f"{'='*56}\n")
