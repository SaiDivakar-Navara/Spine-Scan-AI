from fastapi import FastAPI, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
import uuid
from ultralytics import YOLO
import cv2

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins (for development)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# folders
UPLOAD_FOLDER = "uploads"
RESULT_FOLDER = "results"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)

model = YOLO("best.pt")

app.mount("/results", StaticFiles(directory="results"), name="results")

@app.post("/detect")
async def detect_image(file: UploadFile = File(...)):

    filename = str(uuid.uuid4()) + file.filename
    upload_path = os.path.join(UPLOAD_FOLDER, filename)

    with open(upload_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    results = model(upload_path)

    result = results[0]

    # Save result image
    result_image = result.plot()
    result_filename = "result_" + filename
    result_path = os.path.join(RESULT_FOLDER, result_filename)
    cv2.imwrite(result_path, result_image)

    # ------------------------
    # Extract detection data
    # ------------------------

    class_names = model.names

    counts = {
        "Normal": 0,
        "Bulging": 0,
        "Herniation": 0
    }

    confidences = []

    for box in result.boxes:

        class_id = int(box.cls[0])
        confidence = float(box.conf[0])

        class_name = class_names[class_id]

        if class_name in counts:
            counts[class_name] += 1

        confidences.append(confidence)

    avg_confidence = round(sum(confidences)/len(confidences), 3) if confidences else 0

    return {
        "result_image_url": f"http://127.0.0.1:8000/results/{result_filename}",
        "counts": counts,
        "confidence": avg_confidence
    }