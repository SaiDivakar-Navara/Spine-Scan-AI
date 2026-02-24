import os
import uuid
import shutil
from pathlib import Path
from collections import defaultdict

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO

# ── Directories ──────────────────────────────────────────────────────────────
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ── Load model once at startup ────────────────────────────────────────────────
model = YOLO("best.pt")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="MRI Analysis API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve output images as static files at /outputs/<filename>
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")


# ── Risk logic ────────────────────────────────────────────────────────────────
def determine_risk(class_counts: dict) -> str:
    if class_counts.get("Herniation", 0) > 0:
        return "High Risk"
    elif class_counts.get("Bulging", 0) > 0:
        return "Low Risk"
    return "Normal"


# ── Endpoint ──────────────────────────────────────────────────────────────────
@app.post("/analyze-mri")
async def analyze_mri(file: UploadFile = File(...)):
    # Validate file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    # Save uploaded image
    ext = Path(file.filename).suffix or ".jpg"
    unique_id = uuid.uuid4().hex
    input_path = UPLOAD_DIR / f"{unique_id}{ext}"
    with input_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    # Run YOLO inference
    results = model(str(input_path))
    result = results[0]  # single image

    # Generate annotated image with bounding boxes
    annotated_bgr = result.plot()  # returns BGR numpy array
    output_filename = f"{unique_id}_output.jpg"
    output_path = OUTPUT_DIR / output_filename
    cv2.imwrite(str(output_path), annotated_bgr)

    # Extract detections
    detections = []
    class_counts = defaultdict(int)
    confidences = []

    if result.boxes is not None:
        for box in result.boxes:
            cls_id = int(box.cls.item())
            cls_name = model.names[cls_id]
            conf = round(float(box.conf.item()), 4)
            xyxy = box.xyxy[0].tolist()

            detections.append({
                "class": cls_name,
                "confidence": conf,
                "bbox": {
                    "x1": round(xyxy[0], 2),
                    "y1": round(xyxy[1], 2),
                    "x2": round(xyxy[2], 2),
                    "y2": round(xyxy[3], 2),
                },
            })
            class_counts[cls_name] += 1
            confidences.append(conf)

    overall_confidence = round(sum(confidences) / len(confidences), 4) if confidences else 0.0
    risk_level = determine_risk(class_counts)

    return {
        "output_image_url": f"/outputs/{output_filename}",
        "class_counts": dict(class_counts),
        "detections": detections,
        "overall_confidence": overall_confidence,
        "risk_level": risk_level,
    }

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "MRI Analysis API is running"}


# ── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

########