from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from main import (
    run_single_frame, ANOMALY_MODEL_PATH, RFDETR_MODEL_PATH, OCR_MODEL_DIR,
    ANOMALY_THRESHOLD, MASK_THRESHOLD, MIN_AREA, RFDETR_THRESHOLD,
    CAMERA_TYPE, CAMERA_CONFIG, WARMUP_FRAMES, FOCUS_SETTLE_SECONDS
)

from camera_manager import get_camera

def capture_image_from_camera() -> np.ndarray:
    """Capture using the unified Camera Manager settings configured in main.py"""
    cam = get_camera(CAMERA_TYPE, CAMERA_CONFIG)
    
    try:
        cam.open()
        print(f"[Camera] Opened {CAMERA_TYPE} Camera.")

        for _ in range(max(0, WARMUP_FRAMES)):
            cam.read()

        if CAMERA_TYPE == "UVC":
            time.sleep(FOCUS_SETTLE_SECONDS)

        frame_bgr = cam.read()
        if frame_bgr is None:
            raise RuntimeError(f"Failed to capture frame from {CAMERA_TYPE} camera.")

        h, w = frame_bgr.shape[:2]
        print(f"[Camera] Captured frame at {w}x{h}")
        return frame_bgr
    finally:
        cam.close()

def save_frame(frame_bgr: np.ndarray, output_path: str | Path | None = None) -> str:
    if output_path is None:
        output_path = Path(tempfile.gettempdir()) / "captured_frame.png"
    output_path = str(Path(output_path).resolve())
    if not cv2.imwrite(output_path, frame_bgr):
        raise RuntimeError(f"Failed to save captured image to {output_path}")
    print(f"[Camera] Saved frame to {output_path}")
    return output_path

def capture_and_run(output_image_path: str | Path | None = None) -> dict:
    frame_bgr = capture_image_from_camera()

    if output_image_path is not None:
        save_frame(frame_bgr, output_image_path)

    return run_single_frame(
        frame_bgr=frame_bgr,
        anomaly_model_path=ANOMALY_MODEL_PATH,
        rfdetr_model_path=RFDETR_MODEL_PATH,
        ocr_model_dir=OCR_MODEL_DIR,
        anomaly_threshold=ANOMALY_THRESHOLD,
        mask_threshold=MASK_THRESHOLD,
        min_area=MIN_AREA,
        rfdetr_threshold=RFDETR_THRESHOLD,
    )

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture an image and run pipeline")
    parser.add_argument("--output-image-path", type=str, default=None, help="Optional save path")
    parser.add_argument("--auto-run", action="store_true", help="Capture immediately")
    return parser.parse_args()

def main() -> None:
    args = parse_args()
    result = capture_and_run(output_image_path=args.output_image_path)
    print("Pipeline result:")
    print(result)

if __name__ == "__main__":
    main()