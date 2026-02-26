# ================================================================
#  SPINAL CORD DAMAGE DETECTION — FastAPI Backend
#
#  Endpoints:
#    GET  /health        → server health check
#    POST /predict/full  → upload MRI image →
#                          JSON report + base64 annotated image
# ================================================================

from fastapi                 import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic                import BaseModel
from ultralytics             import YOLO
from datetime                import datetime
from typing                  import List
import uvicorn
import cv2
import numpy  as np
import base64, os, time


# ================================================================
#  CONFIG
# ================================================================
MODEL_PATH  = "best.pt"                            # place best.pt in same folder as main.py
CLASS_NAMES = ["Normal", "Bulging", "Herniation"]  # must match your Roboflow dataset order
DISC_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]
CONF_THRESH = 0.25

CLASS_CONFIG = {
    0: {"name": "Normal",     "color": (0,  200,   0), "severity": "low",      "emoji": "✅"},
    1: {"name": "Bulging",    "color": (0,  200, 255), "severity": "moderate", "emoji": "⚠️"},
    2: {"name": "Herniation", "color": (0,   0,  255), "severity": "severe",   "emoji": "🔴"},
}


# ================================================================
#  RESPONSE SCHEMAS
# ================================================================
class DiscResult(BaseModel):
    disc_level : str    # "L4-L5"
    condition  : str    # "Bulging"
    confidence : float  # 0.90
    severity   : str    # "low" | "moderate" | "severe" | "unknown"

class Report(BaseModel):
    image_name      : str
    timestamp       : str
    discs           : List[DiscResult]
    summary         : dict
    overall_status  : str
    processing_time : float

class FullResponse(BaseModel):
    report          : Report
    annotated_image : str   # "data:image/jpeg;base64,...."


# ================================================================
#  APP SETUP
# ================================================================
app = FastAPI(
    title       = "Spinal Cord Damage Detection API",
    description = "Upload a lumbar spine MRI → JSON report + base64 annotated image",
    version     = "1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],  # replace * with your frontend URL in production
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Load model ONCE at startup — stays in memory for all requests ─
model = None

@app.on_event("startup")
def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        print(f"⚠️  best.pt not found at '{MODEL_PATH}'")
        print("    Copy your trained weights file here and restart.")
        return
    model = YOLO(MODEL_PATH)
    print(f"✅ Model loaded → {MODEL_PATH}")


# ================================================================
#  HELPER FUNCTIONS
# ================================================================

def decode_image(file_bytes: bytes) -> np.ndarray:
    """
    Convert raw uploaded file bytes → OpenCV BGR numpy array.
    Same as reading an image from disk but done from memory.
    """
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def run_inference(img: np.ndarray) -> list:
    """
    Run YOLOv8 on the image.
    Reads box coordinates from model output — no drawing here.
    Sorts detections top → bottom to assign L1-L2 ... L5-S1.
    """
    if model is None:
        raise HTTPException(
            status_code = 503,
            detail      = "Model not loaded. Copy best.pt here and restart."
        )

    # ── Model runs here — detection happens once ──────────────────
    results = model.predict(
        source  = img,
        conf    = CONF_THRESH,
        imgsz   = 640,
        verbose = False,
    )
    result = results[0]

    # ── Read coordinates from model output ────────────────────────
    detections = []
    if result.boxes and len(result.boxes) > 0:
        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append({
                "cls_id" : int(box.cls[0]),
                "conf"   : round(float(box.conf[0]), 4),
                "x1": x1, "y1": y1,
                "x2": x2, "y2": y2,
                "cy"     : (y1 + y2) // 2,  # Y center for top→bottom sorting
            })

    # ── Sort top → bottom, assign disc levels ────────────────────
    detections = sorted(detections, key=lambda d: d["cy"])
    for i, det in enumerate(detections):
        det["disc_level"] = DISC_LEVELS[i] if i < len(DISC_LEVELS) else f"Disc-{i+1}"

    return detections


def draw_boxes(img: np.ndarray, detections: list) -> np.ndarray:
    """
    Draw colored bounding boxes using coordinates from model output.
    This is the SAME drawing code from your Colab notebook.

    Produces:
      - Color coded boxes   Green=Normal | Yellow=Bulging | Red=Herniation
      - Disc level labels   L4-L5 | Bulging 0.90
      - Colour legend       bottom left corner
      - Title bar           top of image

    Returns vis — the final annotated numpy array.
    This is the same image you see saved in your Colab output folder.
    """
    vis  = img.copy()
    h, w = vis.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX

    # ── Bounding boxes + labels ───────────────────────────────────
    for det in detections:
        cfg   = CLASS_CONFIG.get(det["cls_id"], {"name": "Unknown", "color": (180, 180, 180)})
        color = cfg["color"]
        label = f"{det['disc_level']}  |  {cfg['name']}  {det['conf']:.2f}"
        x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]

        # Box
        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)

        # Label background
        (tw, th), _ = cv2.getTextSize(label, font, 0.55, 2)
        lbl_y1 = max(y1 - th - 10, 0)
        cv2.rectangle(vis, (x1, lbl_y1), (x1 + tw + 8, lbl_y1 + th + 8), color, -1)

        # Label text
        cv2.putText(vis, label, (x1 + 4, lbl_y1 + th + 2),
                    font, 0.55, (255, 255, 255), 2, cv2.LINE_AA)

    # ── Colour legend (bottom left) ───────────────────────────────
    n      = len(CLASS_CONFIG)
    box_h  = n * 24 + 30
    x0, y0 = 10, h - box_h - 10
    cv2.rectangle(vis, (x0-5, y0-22), (x0+220, y0+box_h-8), (20, 20, 20), -1)
    cv2.putText(vis, "LEGEND", (x0, y0-5), font, 0.5, (255, 255, 255), 1)
    for i, (cls_id, cfg) in enumerate(CLASS_CONFIG.items()):
        y = y0 + 18 + i * 24
        cv2.rectangle(vis, (x0, y-13), (x0+16, y+3), cfg["color"], -1)
        cv2.putText(vis, cfg["name"], (x0+22, y), font, 0.48, (220, 220, 220), 1)

    # ── Title bar (top) ───────────────────────────────────────────
    cv2.rectangle(vis, (0, 0), (w, 30), (20, 20, 20), -1)
    cv2.putText(vis, "LUMBAR SPINE DAMAGE DETECTION", (10, 21),
                font, 0.65, (255, 255, 255), 2, cv2.LINE_AA)

    return vis  # ← final annotated numpy array


def numpy_to_base64(vis: np.ndarray) -> str:
    """
    Convert the final annotated numpy array → base64 string.

    Flow:
      vis  (numpy array — your drawn image)
        ↓  cv2.imencode(".jpg")
      buffer  (JPEG bytes in memory — same as imwrite but no disk write)
        ↓  base64.b64encode()
      b64_string  (text representation of those bytes)
        ↓  prefix added
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."

    The pixel content is identical to the image saved by cv2.imwrite().
    Frontend uses it directly:  <img src="data:image/jpeg;base64,..." />
    """
    _, buffer  = cv2.imencode(".jpg", vis)
    b64_bytes  = base64.b64encode(buffer.tobytes())
    b64_string = b64_bytes.decode("utf-8")
    return f"data:image/jpeg;base64,{b64_string}"


def build_report(detections: list, filename: str, elapsed: float) -> dict:
    """
    Build the structured disc-level diagnosis report.
    Disc levels not detected by model are reported as 'Not Detected'.
    """
    detected_map = {d["disc_level"]: d for d in detections}
    summary      = {"Normal": 0, "Bulging": 0, "Herniation": 0, "Not_Detected": 0}
    disc_rows    = []

    for level in DISC_LEVELS:
        if level in detected_map:
            det  = detected_map[level]
            cfg  = CLASS_CONFIG.get(det["cls_id"], {"name": "Unknown", "severity": "unknown"})
            cond = cfg["name"]
            sev  = cfg["severity"]
            conf = det["conf"]
            summary[cond] = summary.get(cond, 0) + 1
        else:
            cond = "Not Detected"
            sev  = "unknown"
            conf = 0.0
            summary["Not_Detected"] += 1

        disc_rows.append({
            "disc_level" : level,
            "condition"  : cond,
            "confidence" : conf,
            "severity"   : sev,
        })

    # Overall status based on worst finding
    if summary.get("Herniation", 0) > 0:
        overall = "Critical"
    elif summary.get("Bulging", 0) > 0:
        overall = "Attention Required"
    else:
        overall = "Normal"

    return {
        "image_name"      : filename,
        "timestamp"       : datetime.utcnow().isoformat(),
        "discs"           : disc_rows,
        "summary"         : summary,
        "overall_status"  : overall,
        "processing_time" : round(elapsed, 3),
    }


# ================================================================
#  ENDPOINTS
# ================================================================

@app.get("/health", tags=["General"])
def health():
    """Check if server and model are running."""
    return {
        "status"      : "ok",
        "model_loaded": model is not None,
        "timestamp"   : datetime.utcnow().isoformat(),
    }


@app.post("/predict/full", response_model=FullResponse, tags=["Detection"])
async def predict_full(file: UploadFile = File(...)):
    """
    Upload one lumbar spine MRI image.

    Returns one JSON response with two parts:

    ── PART 1: report ──────────────────────────────────────────
    {
      "image_name"     : "mri_scan.jpg",
      "timestamp"      : "2024-01-15T10:30:00",
      "discs": [
        {"disc_level": "L1-L2", "condition": "Herniation",   "confidence": 0.82, "severity": "severe"},
        {"disc_level": "L2-L3", "condition": "Normal",       "confidence": 0.68, "severity": "low"},
        {"disc_level": "L3-L4", "condition": "Bulging",      "confidence": 0.84, "severity": "moderate"},
        {"disc_level": "L4-L5", "condition": "Normal",       "confidence": 0.57, "severity": "low"},
        {"disc_level": "L5-S1", "condition": "Not Detected", "confidence": 0.0,  "severity": "unknown"}
      ],
      "summary"        : {"Normal": 2, "Bulging": 1, "Herniation": 1, "Not Detected": 1},
      "overall_status" : "Critical",
      "processing_time": 0.342
    }

    ── PART 2: annotated_image ──────────────────────────────────
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."

    The base64 string is your MRI image with:
      - Color coded bounding boxes (Green / Yellow / Red)
      - Disc level on each box     (L4-L5 | Bulging 0.90)
      - Colour legend bottom left
      - Title bar at top

    Use directly in frontend:
      <img src={response.annotated_image} />
    """

    # ── Validate file type ────────────────────────────────────────
    if file.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
        raise HTTPException(
            status_code = 400,
            detail      = "Please upload a JPEG or PNG image."
        )

    start = time.time()

    # ── Step 1: uploaded bytes → numpy array ─────────────────────
    file_bytes = await file.read()
    img        = decode_image(file_bytes)
    if img is None:
        raise HTTPException(
            status_code = 400,
            detail      = "Could not read the image. Upload a valid JPEG or PNG."
        )

    # ── Step 2: run YOLOv8 — detection happens here ──────────────
    detections = run_inference(img)

    # ── Step 3: draw boxes on image using model coordinates ───────
    #           same drawing code as your Colab notebook
    vis = draw_boxes(img, detections)

    # ── Step 4: vis (numpy array) → base64 string ────────────────
    #           vis → cv2.imencode() → bytes → base64.b64encode()
    annotated_b64 = numpy_to_base64(vis)

    # ── Step 5: build text report ────────────────────────────────
    report = build_report(detections, file.filename, time.time() - start)

    # ── Step 6: return both in one JSON response ──────────────────
    return {
        "report"         : report,
        "annotated_image": annotated_b64,
    }


# ================================================================
#  RUN SERVER
# ================================================================
if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)