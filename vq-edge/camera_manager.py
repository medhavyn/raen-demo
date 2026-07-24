import cv2
import time
import threading
import numpy as np
from typing import Optional

# Shared Harvester instance — CTI loading is expensive, one instance serves all.
_harvester = None
_harvester_lock = threading.Lock()

def _get_harvester(cti_path: str):
    global _harvester
    with _harvester_lock:
        if _harvester is None:
            from harvesters.core import Harvester
            h = Harvester()
            h.add_file(cti_path)
            h.update()
            if len(h.device_info_list) == 0:
                raise RuntimeError(f"No GenICam devices found. Is the camera connected and CTI path ({cti_path}) correct?")
            _harvester = h
        return _harvester

class UVCCamera:
    """Standard USB/UVC Camera using OpenCV."""
    def __init__(self, index: int = 0, width: int = 3840, height: int = 2160):
        self.index = index
        self.width = width
        self.height = height
        self.cap = None

    def open(self):
        self.cap = cv2.VideoCapture(self.index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            raise RuntimeError(f"Unable to open UVC camera index {self.index}")
        
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)

    def read(self) -> Optional[np.ndarray]:
        if not self.cap:
            return None
        # Flush buffer to avoid stale frames
        for _ in range(3):
            self.cap.grab()
        ok, frame = self.cap.read()
        return frame if ok else None

    def close(self):
        if self.cap:
            self.cap.release()
            self.cap = None

class GenICamCamera:
    """GenICam-compliant camera (e.g. Hikrobot) via harvesters + GenTL producer."""
    BAYER_CONVERSIONS = {
        "BayerRG8": cv2.COLOR_BayerBG2BGR,
        "BayerBG8": cv2.COLOR_BayerRG2BGR,
        "BayerGR8": cv2.COLOR_BayerGB2BGR,
        "BayerGB8": cv2.COLOR_BayerGR2BGR,
    }

    def __init__(self, cti_path: str, serial_number: str = None):
        self.cti_path = cti_path
        self.serial_number = serial_number
        self.ia = None

    def open(self):
        harvester = _get_harvester(self.cti_path)
        with _harvester_lock:
            try:
                if self.serial_number:
                    self.ia = harvester.create({"serial_number": str(self.serial_number)})
                else:
                    self.ia = harvester.create(0) # Open first available camera
            except Exception:
                harvester.update()
                self.ia = harvester.create(0) if not self.serial_number else harvester.create({"serial_number": str(self.serial_number)})
        
        self.ia.start()

    def read(self) -> Optional[np.ndarray]:
        if not self.ia:
            return None
        
        try:
            with self.ia.fetch(timeout=3.0) as buffer:
                component = buffer.payload.components[0]
                width, height = component.width, component.height
                pixel_format = component.data_format
                data = component.data.copy()

            if pixel_format == "Mono8":
                return cv2.cvtColor(data.reshape(height, width), cv2.COLOR_GRAY2BGR)
            if pixel_format in ("RGB8", "RGB8Packed"):
                return cv2.cvtColor(data.reshape(height, width, 3), cv2.COLOR_RGB2BGR)
            if pixel_format in ("BGR8", "BGR8Packed"):
                return data.reshape(height, width, 3)
            
            bayer_code = self.BAYER_CONVERSIONS.get(pixel_format)
            if bayer_code is not None:
                return cv2.cvtColor(data.reshape(height, width), bayer_code)
            
            raise RuntimeError(f"Unsupported pixel format: '{pixel_format}'")
        except Exception as e:
            print(f"[GenICam] Fetch error: {e}")
            return None

    def close(self):
        if self.ia:
            self.ia.stop()
            self.ia.destroy()
            self.ia = None

def get_camera(cam_type: str, config: dict):
    """Factory to return the correct camera instance."""
    if cam_type.upper() == "GENICAM":
        return GenICamCamera(cti_path=config.get("cti_path"), serial_number=config.get("serial_number"))
    elif cam_type.upper() == "UVC":
        return UVCCamera(index=config.get("index", 0), width=config.get("width", 3840), height=config.get("height", 2160))
    else:
        raise ValueError(f"Unknown camera type: {cam_type}")