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

    result_image = results[0].plot()

    result_filename = "result_" + filename

    result_path = os.path.join(RESULT_FOLDER, result_filename)

    cv2.imwrite(result_path, result_image)

    return {
        "result_image_url": f"http://127.0.0.1:8000/results/{result_filename}"
    }