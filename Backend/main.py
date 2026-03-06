from fastapi                 import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic                import BaseModel
from ultralytics             import YOLO
from datetime                import datetime
from typing                  import List, Optional
import uvicorn
import cv2
import numpy  as np
import base64, os, time

# ================================================================
#  CONFIG
# ================================================================
MODEL_PATH  = "best.pt"
CLASS_NAMES = ["Normal", "Bulging", "Herniation"]
DISC_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]
CONF_THRESH = 0.25

CLASS_CONFIG = {
    0: {"name": "Normal",     "color": (0,  200,   0), "severity": "low",      "emoji": "✅"},
    1: {"name": "Bulging",    "color": (0,  200, 255), "severity": "moderate", "emoji": "⚠️"},
    2: {"name": "Herniation", "color": (0,   0,  255), "severity": "severe",   "emoji": "🔴"},
}

# ── Hardcoded model evaluation metrics (from training/validation) ─
MODEL_METRICS = {
    "mAP"       : 0.92,
    "precision" : 0.95,
    "recall"    : 0.89,
    "f1_score"  : 0.92,
}


# ================================================================
#  RESPONSE SCHEMAS
# ================================================================
class DiscResult(BaseModel):
    disc_level : str
    condition  : str
    confidence : float
    severity   : str


class Metrics(BaseModel):
    mAP        : float
    precision  : float
    recall     : float
    f1_score   : float


class Report(BaseModel):
    image_name          : str
    timestamp           : str
    discs               : List[DiscResult]
    summary             : dict
    overall_status      : str
    overall_confidence  : Optional[float]   
    metrics             : Metrics           
    processing_time     : float


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
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

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
    """Convert raw uploaded file bytes → OpenCV BGR numpy array."""
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def run_inference(img: np.ndarray) -> list:
    """
    Run YOLOv8 on the image.
    Sorts detections top → bottom to assign disc levels L1-L2 … L5-S1.
    """
    if model is None:
        raise HTTPException(
            status_code = 503,
            detail      = "Model not loaded. Place best.pt in the working directory and restart."
        )

    results = model.predict(
        source  = img,
        conf    = CONF_THRESH,
        imgsz   = 640,
        verbose = False,
    )
    result = results[0]

    detections = []
    if result.boxes and len(result.boxes) > 0:
        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append({
                "cls_id" : int(box.cls[0]),
                "conf"   : round(float(box.conf[0]), 4),
                "x1": x1, "y1": y1,
                "x2": x2, "y2": y2,
                "cy"     : (y1 + y2) // 2,
            })

    # Sort top → bottom, assign disc levels
    detections = sorted(detections, key=lambda d: d["cy"])
    for i, det in enumerate(detections):
        det["disc_level"] = DISC_LEVELS[i] if i < len(DISC_LEVELS) else f"Disc-{i+1}"

    return detections


def draw_boxes(img: np.ndarray, detections: list) -> np.ndarray:
    """Annotate image with bounding boxes, labels, and a legend."""
    vis      = img.copy()
    h, w     = vis.shape[:2]
    font     = cv2.FONT_HERSHEY_SIMPLEX

    for det in detections:
        cfg   = CLASS_CONFIG.get(det["cls_id"], {"name": "Unknown", "color": (180, 180, 180)})
        color = cfg["color"]
        label = f"{det['disc_level']}  |  {cfg['name']}  {det['conf']:.2f}"
        x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]

        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)

        (tw, th), _ = cv2.getTextSize(label, font, 0.55, 2)
        lbl_y1 = max(y1 - th - 10, 0)
        cv2.rectangle(vis, (x1, lbl_y1), (x1 + tw + 8, lbl_y1 + th + 8), color, -1)
        cv2.putText(vis, label, (x1 + 4, lbl_y1 + th + 2),
                    font, 0.55, (255, 255, 255), 2, cv2.LINE_AA)

    # Colour legend (bottom left)
    n      = len(CLASS_CONFIG)
    box_h  = n * 24 + 30
    x0, y0 = 10, h - box_h - 10
    cv2.rectangle(vis, (x0-5, y0-22), (x0+220, y0+box_h-8), (20, 20, 20), -1)
    cv2.putText(vis, "LEGEND", (x0, y0-5), font, 0.5, (255, 255, 255), 1)
    for i, (cls_id, cfg) in enumerate(CLASS_CONFIG.items()):
        y = y0 + 18 + i * 24
        cv2.rectangle(vis, (x0, y-13), (x0+16, y+3), cfg["color"], -1)
        cv2.putText(vis, cfg["name"], (x0+22, y), font, 0.48, (220, 220, 220), 1)

    # Title bar (top)
    cv2.rectangle(vis, (0, 0), (w, 30), (20, 20, 20), -1)
    cv2.putText(vis, "LUMBAR SPINE DAMAGE DETECTION", (10, 21),
                font, 0.65, (255, 255, 255), 2, cv2.LINE_AA)

    return vis


def numpy_to_base64(vis: np.ndarray) -> str:
    """Encode annotated numpy image → base64 JPEG data URI."""
    _, buffer  = cv2.imencode(".jpg", vis)
    b64_string = base64.b64encode(buffer.tobytes()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64_string}"


def compute_overall_confidence(disc_rows: list) -> Optional[float]:
    """
    Average confidence of detected discs only.
    Excludes any disc where:
      - condition is 'Not Detected'   (model did not find it)
      - confidence is 0.0             (safety net for any zero-conf entries)
    Returns None if no valid detections exist.
    """
    detected = [
        d["confidence"]
        for d in disc_rows
        if d["condition"] != "Not Detected" and d["confidence"] > 0.0
    ]
    if not detected:
        return None
    return round(sum(detected) / len(detected), 4)


def build_report(detections: list, filename: str, elapsed: float) -> dict:
    """
    Build the structured disc-level diagnosis report.
    Undetected disc levels are reported as 'Not Detected'.
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
        "image_name"         : filename,
        "timestamp"          : datetime.utcnow().isoformat(),
        "discs"              : disc_rows,
        "summary"            : summary,
        "overall_status"     : overall,
        "overall_confidence" : compute_overall_confidence(disc_rows),
        "metrics"            : MODEL_METRICS,
        "processing_time"    : round(elapsed, 3),
    }


# ================================================================
#  ENDPOINTS
# ================================================================

@app.get("/health", tags=["General"])
def health():
    """Check if server and model are running."""
    return {
        "status"       : "ok",
        "model_loaded" : model is not None,
        "timestamp"    : datetime.utcnow().isoformat(),
    }


@app.post("/detect", response_model=FullResponse, tags=["Detection"])
async def detect(file: UploadFile = File(...)):
    """
    Upload a lumbar spine MRI image (JPEG/PNG).
    Returns a structured disc-level report + base64-encoded annotated image.
    """
    if file.content_type not in ["image/jpeg", "image/jpg", "image/png"]:
        raise HTTPException(
            status_code = 400,
            detail      = "Please upload a JPEG or PNG image."
        )

    start = time.time()

    # Step 1: bytes → numpy array
    file_bytes = await file.read()
    img        = decode_image(file_bytes)
    if img is None:
        raise HTTPException(
            status_code = 400,
            detail      = "Could not read the image. Upload a valid JPEG or PNG."
        )

    # Step 2: run YOLOv8 inference
    detections = run_inference(img)

    # Step 3: draw bounding boxes
    vis = draw_boxes(img, detections)

    # Step 4: numpy → base64
    annotated_b64 = numpy_to_base64(vis)

    # Step 5: build report
    report = build_report(detections, file.filename, time.time() - start)

    # Step 6: return combined response
    return {
        "report"          : report,
        "annotated_image" : annotated_b64,
    }


# ================================================================
#  RUN SERVER
# ================================================================
if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)