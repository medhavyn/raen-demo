from __future__ import annotations

import base64
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import supervision as sv
from rembg import remove, new_session
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import ML Engines (Unchanged)
from engine.anomaly_engine import AnomalyEngine
from engine.rfdetr_engine import RFDETREngine
from engine.ocr_engine import OCR_Engine, run_ocr

# Import the newly abstracted camera manager
from camera_manager import get_camera

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------
INPUT_SOURCE = "image"  # "camera" | "image"

# --- CAMERA CONFIGURATION ---
CAMERA_TYPE = "GENICAM"  # Toggle: "UVC" or "GENICAM"
CAMERA_CONFIG = {
    # UVC Settings
    "index": 0,
    "height": 2160,
    # GenICam (Hikrobot) Settings
    # Update this path to where MVS installs the .cti file (e.g. MvProducerGEV.cti or MvProducerU3V.cti)
    "cti_path": r"C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64\MvProducerU3V.cti",
    "serial_number": None # Set to a string if using multiple cameras
}

DEMO_IMAGES_DIR = Path(__file__).parent / "demo-images"
MODELS_DIR = Path(__file__).parent / "demo-models"

IMAGE_PATHS: dict[str, dict[str, str]] = {
    "crompton": {"good": str(DEMO_IMAGES_DIR / "part1-crompton-good.jpg"), "bad": str(DEMO_IMAGES_DIR / "part1-crompton-bad.jpg")},
    "siemens": {"good": str(DEMO_IMAGES_DIR / "part2-siemens-good.jpg"), "bad": str(DEMO_IMAGES_DIR / "part2-siemens-bad.jpg")},
    "ashida": {"good": str(DEMO_IMAGES_DIR / "part3-ashida-good.jpg"), "bad": str(DEMO_IMAGES_DIR / "part3-ashida-bad.jpg")},
    "govern": {"good": str(DEMO_IMAGES_DIR / "part4-govern-good.jpg"), "bad": str(DEMO_IMAGES_DIR / "part4-govern-bad.jpg")},
}

ANOMALY_MODEL_PATHS: dict[str, str] = {
    "crompton": str(MODELS_DIR / "crompton_anomaly.ckpt"),
    "siemens": str(MODELS_DIR / "siemens_anomaly.ckpt"),
    "ashida": str(MODELS_DIR / "ashida_anomaly.ckpt"),
    "govern": str(MODELS_DIR / "govern_anomaly.ckpt"),
}

ACTIVE_PART = "siemens" 
ACTIVE_CONDITION = "good" 
IMAGE_PATH: str | None = IMAGE_PATHS[ACTIVE_PART][ACTIVE_CONDITION]

ANOMALY_MODEL_PATH = ANOMALY_MODEL_PATHS[ACTIVE_PART]
RFDETR_MODEL_PATH = str(MODELS_DIR / "suen_0102ES200700N.pth")
OCR_MODEL_DIR: str | None = None
ANOMALY_THRESHOLD = 0.5
MASK_THRESHOLD = 128
MIN_AREA = 50
RFDETR_THRESHOLD = 0.7
OCR_MIN_CONFIDENCE = 0.75

API_HOST = "0.0.0.0"
API_PORT = 8001
LOOP_INTERVAL = 0.5
FOCUS_SETTLE_SECONDS = 1.5
WARMUP_FRAMES = 10

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
rembg_session = new_session()
app = FastAPI(title="VQ Edge Inspection Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

class InspectionState:
    """Thread-safe state for the continuous inspection loop."""
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status: str = "idle" 
        self._latest_result: dict[str, Any] | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event() 
        self._pause_event.set()

    @property
    def status(self) -> str:
        with self._lock: return self._status

    @status.setter
    def status(self, value: str) -> None:
        with self._lock: self._status = value

    @property
    def latest_result(self) -> dict[str, Any] | None:
        with self._lock: return self._latest_result

    @latest_result.setter
    def latest_result(self, value: dict[str, Any] | None) -> None:
        with self._lock: self._latest_result = value

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            self._stop_event.set()
            self._pause_event.set() 
            self._thread.join(timeout=5)
            self._thread = None

        self._stop_event.clear()
        self._pause_event.set()
        self.status = "scanning"
        self.latest_result = None
        self._thread = threading.Thread(target=_inspection_loop, args=(self,), daemon=True)
        self._thread.start()

    def pause(self) -> None:
        self._pause_event.clear()
        self.status = "paused"

    def resume(self) -> None:
        self._pause_event.set()
        self.status = "scanning"
        self.latest_result = None

    def finish(self) -> None:
        self._stop_event.set()
        self._pause_event.set() 
        self.status = "finished"
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    @property
    def should_stop(self) -> bool:
        return self._stop_event.is_set()

    def wait_if_paused(self) -> None:
        self._pause_event.wait()

inspection_state = InspectionState()

# ---------------------------------------------------------------------------
# Image & ML helpers (Unchanged Core logic)
# ---------------------------------------------------------------------------
def remove_background(image_rgb: np.ndarray):
    result_rgba = remove(image_rgb, session=rembg_session)
    alpha = result_rgba[..., 3:4].astype(np.float32) / 255.0
    rgb = result_rgba[..., :3].astype(np.float32)
    background = np.zeros((1, 1, 3), dtype=np.float32)
    result_rgb = (rgb * alpha + background * (1.0 - alpha)).astype(np.uint8)
    return result_rgba, result_rgb

def _normalize_bbox(box: Any, image_w: int, image_h: int) -> tuple[int, int, int, int] | None:
    try:
        box_array = np.array(box)
        if box_array.ndim == 2 and box_array.shape[1] == 2:
            x1, y1 = int(box_array[:, 0].min()), int(box_array[:, 1].min())
            x2, y2 = int(box_array[:, 0].max()), int(box_array[:, 1].max())
        elif box_array.ndim == 1 and len(box_array) == 4:
            x1, y1, x2, y2 = [int(v) for v in box_array]
        else:
            return None

        x1, y1 = max(0, min(x1, image_w)), max(0, min(y1, image_h))
        x2, y2 = max(0, min(x2, image_w)), max(0, min(y2, image_h))
        if x2 <= x1 or y2 <= y1: return None
        return x1, y1, x2, y2
    except Exception:
        return None

def _encode_image_to_base64_png(image: np.ndarray | None) -> str | None:
    if image is None or image.size == 0: return None
    ok, encoded = cv2.imencode(".png", image)
    return base64.b64encode(encoded.tobytes()).decode("ascii") if ok else None

def _annotate_ocr_lines(image_bgr: np.ndarray, ocr_lines: list[dict[str, Any]]) -> np.ndarray:
    annotated = image_bgr.copy()
    if not ocr_lines: return annotated
    img_h, img_w = annotated.shape[:2]

    for line in ocr_lines:
        box = line.get("box")
        normalized_box = _normalize_bbox(box, img_w, img_h)
        if normalized_box is None: continue
        try:
            bx1, by1, bx2, by2 = normalized_box
            cv2.rectangle(annotated, (bx1, by1), (bx2, by2), (0, 255, 0), 2)
        except Exception:
            continue
    return annotated

def _ocr_lines_to_boxes(ocr_lines: list[dict[str, Any]], image_w: int, image_h: int, part_bbox: tuple[int, int, int, int] | None = None) -> list[dict[str, Any]]:
    boxes = []
    for idx, line in enumerate(ocr_lines):
        normalized_box = _normalize_bbox(line.get("box"), image_w, image_h)
        if normalized_box is None: continue
        x1, y1, x2, y2 = normalized_box

        if part_bbox is not None:
            px1, py1, _, _ = part_bbox
            x1 += px1; y1 += py1; x2 += px1; y2 += py1

        boxes.append({
            "id": f"ocr-{idx + 1}",
            "text": line.get("text", ""),
            "status": "correct",
            "top": (y1 / image_h) * 100.0 if image_h > 0 else 0.0,
            "left": (x1 / image_w) * 100.0 if image_w > 0 else 0.0,
            "width": ((x2 - x1) / image_w) * 100.0 if image_w > 0 else 0.0,
            "height": ((y2 - y1) / image_h) * 100.0 if image_h > 0 else 0.0,
        })
    return boxes

def run_single_frame(
    frame_bgr: np.ndarray, anomaly_model_path: str, rfdetr_model_path: str, ocr_model_dir: str | None = None,
    anomaly_threshold: float = 0.5, mask_threshold: int = 128, min_area: int = 50, rfdetr_threshold: float = 0.7,
) -> dict[str, Any]:
    image_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    _, image_rgb_no_bg = remove_background(image_rgb)

    anomaly_engine = AnomalyEngine()
    anomaly_result = anomaly_engine._detect_anomaly(
        image_rgb=image_rgb_no_bg, anomaly_model_path=anomaly_model_path,
        anomaly_threshold=anomaly_threshold, mask_threshold=mask_threshold, min_area=min_area,
    )

    rfdetr_engine = RFDETREngine(model_path=rfdetr_model_path, threshold=rfdetr_threshold)
    part_result = rfdetr_engine.detect_part(frame_bgr)

    ocr_lines = []
    if part_result is not None and part_result.get("crop", np.array([])).size > 0:
        crop_rgb = cv2.cvtColor(part_result["crop"], cv2.COLOR_BGR2RGB)
        ocr_engine = OCR_Engine(model_dir=ocr_model_dir, device="gpu:0")
        ocr_result = run_ocr(crop_rgb, ocr_engine)
        ocr_lines = ocr_result["lines"]

    return _build_payload(frame_bgr, anomaly_result, part_result, ocr_lines)

def _build_payload(image_bgr: np.ndarray, anomaly_result: dict, part_result: dict | None, ocr_lines: list[dict[str, Any]]) -> dict[str, Any]:
    image_h, image_w = image_bgr.shape[:2]
    anomaly = anomaly_result or {}
    anomaly_results = anomaly.get("results") or []
    anomaly_count = len(anomaly_results)
    anomaly_score = float(anomaly.get("score", 0.0) or 0.0)
    anomaly_label = int(anomaly.get("label", 0) or 0)

    annotated = image_bgr.copy()
    part_bbox = part_result.get("bbox") if isinstance(part_result, dict) else None

    mask = anomaly.get("mask")
    if isinstance(mask, np.ndarray) and mask.size > 0 and anomaly_count > 0:
        if len(mask.shape) == 3: mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
        if mask.shape[:2] != (image_h, image_w): mask = cv2.resize(mask, (image_w, image_h), interpolation=cv2.INTER_LINEAR)
        binary_mask = mask.astype(np.float32) > 30
        if binary_mask.any():
            detections = sv.Detections(xyxy=np.array([[0, 0, image_w, image_h]], dtype=np.float32), mask=binary_mask[np.newaxis, ...])
            polygon_annotator = sv.PolygonAnnotator(color=sv.Color.RED, thickness=8, color_lookup=sv.ColorLookup.INDEX)
            annotated = polygon_annotator.annotate(scene=annotated, detections=detections)

    if ocr_lines and part_bbox is not None:
        adjusted_ocr_lines = []
        px1, py1, _, _ = part_bbox
        for line in ocr_lines:
            adj_line = line.copy()
            box = line.get("box")
            if box is not None:
                box_array = np.array(box)
                if box_array.ndim == 2 and box_array.shape[1] == 2:
                    box_array[:, 0] += px1
                    box_array[:, 1] += py1
                    adj_line["box"] = box_array.tolist()
                elif box_array.ndim == 1 and len(box_array) == 4:
                    adj_line["box"] = [box_array[0] + px1, box_array[1] + py1, box_array[2] + px1, box_array[3] + py1]
            adjusted_ocr_lines.append(adj_line)
        annotated = _annotate_ocr_lines(annotated, adjusted_ocr_lines)

    boxes = _ocr_lines_to_boxes(ocr_lines, image_w, image_h, part_bbox=part_bbox)
    captured_image_b64 = _encode_image_to_base64_png(annotated)

    total = len(ocr_lines) or anomaly_count
    rejected = min(total, anomaly_count) if total > 0 else anomaly_count
    accepted = max(0, total - rejected)

    wrong_text = [{"text": "Anomaly region detected", "reason": f"score={anomaly_score:.3f}"}] if anomaly_count > 0 else []
    frontend_ocr = [{"text": l["text"], "score": l.get("score")} for l in ocr_lines]

    return {
        "total": total, "accepted": accepted, "rejected": rejected, "wrongText": wrong_text,
        "boxes": boxes, "ocrLines": frontend_ocr,
        "anomaly": {"label": anomaly_label, "score": anomaly_score, "count": anomaly_count},
        "capturedImageBase64": captured_image_b64,
    }

def _make_empty_result(error: str | None = None) -> dict[str, Any]:
    return {
        "total": 0, "accepted": 0, "rejected": 0, "wrongText": [], "boxes": [], "ocrLines": [],
        "anomaly": {"label": 0, "score": 0.0, "count": 0},
        "capturedImageBase64": None, **({"error": error} if error else {})
    }

# ---------------------------------------------------------------------------
# Continuous inspection loop
# ---------------------------------------------------------------------------
def _inspection_loop(state: InspectionState) -> None:
    use_camera = INPUT_SOURCE == "camera"
    cam = None

    if use_camera:
        print(f"[Inspection Loop] Opening {CAMERA_TYPE} camera...")
        try:
            cam = get_camera(CAMERA_TYPE, CAMERA_CONFIG)
            cam.open()
            
            # Warm up logic
            print(f"[Inspection Loop] Warming up {CAMERA_TYPE} camera...")
            for _ in range(WARMUP_FRAMES):
                cam.read()
            if CAMERA_TYPE == "UVC":
                time.sleep(FOCUS_SETTLE_SECONDS)
                
        except RuntimeError as exc:
            print(f"[Inspection Loop] Camera init error: {exc}")
            state.latest_result = _make_empty_result(error=str(exc))
            state.status = "idle"
            return
    else:
        if not IMAGE_PATH:
            state.latest_result = _make_empty_result(error="IMAGE_PATH is not set")
            state.status = "idle"
            return

    frame_count = 0
    try:
        while not state.should_stop:
            state.wait_if_paused()
            if state.should_stop: break

            try:
                if use_camera:
                    frame_bgr = cam.read()
                    if frame_bgr is None: raise RuntimeError("Failed to capture frame")
                else:
                    frame_bgr = cv2.imread(IMAGE_PATH)
                    if frame_bgr is None: raise RuntimeError("Failed to read image from disk")
            except RuntimeError as exc:
                print(f"[Inspection Loop] {exc}")
                time.sleep(0.5)
                continue

            frame_count += 1
            print(f"\n[Inspection Loop] Processing frame #{frame_count}...")

            try:
                result = run_single_frame(
                    frame_bgr=frame_bgr, anomaly_model_path=ANOMALY_MODEL_PATH,
                    rfdetr_model_path=RFDETR_MODEL_PATH, ocr_model_dir=OCR_MODEL_DIR,
                    anomaly_threshold=ANOMALY_THRESHOLD, mask_threshold=MASK_THRESHOLD,
                    min_area=MIN_AREA, rfdetr_threshold=RFDETR_THRESHOLD,
                )
                result["frameNumber"] = frame_count
                state.latest_result = result

                if result.get("anomaly", {}).get("count", 0) > 0:
                    print(f"[Inspection Loop] ⚠ Anomaly detected on frame #{frame_count}! Pausing.")
                    state.status = "paused"
                    state._pause_event.clear()

            except Exception as exc:
                import traceback
                traceback.print_exc()
                error_result = _make_empty_result(error=f"Pipeline error: {exc}")
                error_result["capturedImageBase64"] = _encode_image_to_base64_png(frame_bgr)
                error_result["frameNumber"] = frame_count
                state.latest_result = error_result

            time.sleep(LOOP_INTERVAL)
    finally:
        if cam is not None:
            cam.close()
        print(f"[Inspection Loop] Processed {frame_count} frames total.")


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "vq-edge-python-backend"}

class InspectStartRequest(BaseModel):
    partId: str = "crompton"
    condition: str = "good"

@app.post("/inspect/start")
def inspect_start(request: InspectStartRequest) -> dict[str, Any]:
    global IMAGE_PATH, ANOMALY_MODEL_PATH
    if inspection_state.status == "scanning":
        return {"status": "scanning", "message": "Inspection already running."}

    IMAGE_PATH = IMAGE_PATHS.get(request.partId, {}).get(request.condition)
    ANOMALY_MODEL_PATH = ANOMALY_MODEL_PATHS.get(request.partId)
    inspection_state.start()
    return {"status": "scanning", "message": "Inspection started."}

@app.post("/inspect/pause")
def inspect_pause() -> dict[str, Any]:
    inspection_state.pause()
    return {"status": "paused"}

@app.post("/inspect/resume")
def inspect_resume() -> dict[str, Any]:
    inspection_state.resume()
    return {"status": "scanning", "message": "Inspection resumed."}

@app.post("/inspect/finish")
def inspect_finish() -> dict[str, Any]:
    inspection_state.finish()
    return {"status": "finished"}

@app.get("/inspect/latest")
def inspect_latest() -> dict[str, Any]:
    return {"status": inspection_state.status, "result": inspection_state.latest_result}

if __name__ == "__main__":
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=False)