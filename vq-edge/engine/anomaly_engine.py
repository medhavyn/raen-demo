import os 
import cv2
import asyncio 
import gc 
import torch
import numpy as np
from torch.utils.data import Dataset, DataLoader
from typing import Dict

from anomalib.models import EfficientAd
from anomalib.engine import Engine 

import pathlib
pathlib.PosixPath = pathlib.WindowsPath

from device_manager import DeviceManager


class SingleImageDataset(Dataset):
    """
    A custom memory-only dataset to bypass disk I/O completely.
    Yields exactly the dictionary format expected by Anomalib/Lightning.
    """
    def __init__(self, image_rgb: np.ndarray):
        self.image_rgb = image_rgb

    def __len__(self):
        return 1

    def __getitem__(self, idx):
        # Anomalib's prediction pipeline expects a dictionary with an "image" key
        return {"image": self.image_rgb, "image_path": "in_memory_image.png"}


class AnomalyEngine:
    _instance = None 
    device_manager: DeviceManager
    models: Dict[str, Dict]

    def __new__(cls):
        if cls._instance is None:
            instance = super().__new__(cls)
            instance.device_manager = DeviceManager()
            instance.models = {}
            cls._instance = instance
        return cls._instance
    
    def _is_anomaly_model_ready(self, ckpt_path: str) -> bool:
        return ckpt_path in self.models
    
    def _load_anomaly_model(self, ckpt_path: str):
        print(f"Loading Anomaly model from {ckpt_path}")
        
        # Load directly from checkpoint. This perfectly restores the weights
        # AND the pre_processor without triggering Lightning duplicate warnings.
        model = EfficientAd.load_from_checkpoint(ckpt_path)
        model.eval()

        # Create engine with logging disabled to save inference overhead
        engine = Engine(logger=False, enable_checkpointing=False)

        self.models[ckpt_path] = {
            "engine": engine,
            "model": model,
            "ckpt_path": ckpt_path,
        }
        print("Anomaly model loaded successfully.")

    def cleanup(self, model_path: str) -> bool:
        try:
            bundle = self.models.pop(model_path, None)
            if bundle and "model" in bundle:
                try:
                    model = bundle["model"]
                    if hasattr(model, "cpu"):
                        model.cpu()
                    del model
                except Exception as e:
                    print(f"Failed to move model to CPU: {e}")
                del bundle
            gc.collect()
            if self.device_manager.is_gpu():
                torch.cuda.empty_cache()
            print(f"Anomaly model {model_path} unloaded successfully")
            return True
        except Exception as e:
            print(f"Failed to unload anomaly model {model_path}: {e}")
            return False

    async def preload_anomaly_model(self, ckpt_path: str) -> bool:
        try:
            if not self._is_anomaly_model_ready(ckpt_path):
                await asyncio.to_thread(self._load_anomaly_model, ckpt_path)
            return True
        except Exception as e:
            print(f"Failed to preload anomaly model {ckpt_path}: {e}")
            return False

    def _detect_anomaly(
            self,
            image_rgb: np.ndarray,
            anomaly_model_path: str,
            anomaly_threshold: float,
            mask_threshold: int,
            min_area: int,
    ) -> Dict:
        """Perform anomaly detection on the full image entirely in memory."""
        if image_rgb is None:
            print("input image is not provided.")
            return {}
        
        if not self._is_anomaly_model_ready(anomaly_model_path):
            self._load_anomaly_model(anomaly_model_path)

        anomaly_bundle = self.models.get(anomaly_model_path)
        if anomaly_bundle is None:
            raise RuntimeError(f"Anomaly model {anomaly_model_path} is not loaded.")
        
        engine = anomaly_bundle["engine"]
        model = anomaly_bundle["model"]

        try: 
            # Bypass tempfiles! Use the custom memory dataset
            dataset = SingleImageDataset(image_rgb)
            dataloader = DataLoader(dataset, batch_size=1, shuffle=False)

            with torch.no_grad():
                # We omit ckpt_path here because the model is already fully loaded
                predictions = engine.predict(
                    model=model,
                    dataloaders=dataloader,
                )

            if not predictions or len(predictions) == 0:
                return {}
            
            # Extract the first batch's dictionary
            prediction = predictions[0]

            # Parse Anomalib v1.0.0 output dictionary structure
            if isinstance(prediction, dict):
                score = float(prediction.get("pred_scores", [0.0])[0])
                label = int(prediction.get("pred_labels", [0])[0])
                anomaly_map = prediction.get("anomaly_maps", [None])[0]
            else:
                score = float(getattr(prediction, "pred_score", 0.0))
                label = int(getattr(prediction, "pred_label", 0))
                anomaly_map = getattr(prediction, "anomaly_map", None)

            if anomaly_map is None:
                print("Warning: Anomaly map missing from prediction output.")
                return {}

            # Convert map to numpy array and resize back to original dimensions
            if isinstance(anomaly_map, torch.Tensor):
                anomaly_map = anomaly_map.squeeze().cpu().numpy()
                
            anomaly_map = cv2.normalize(anomaly_map, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
            anomaly_map = cv2.resize(
                anomaly_map, (image_rgb.shape[1], image_rgb.shape[0]),
                interpolation=cv2.INTER_LINEAR,
            )

            # If the anomaly score is under the threshold, return empty results
            if score < anomaly_threshold:
                return {
                    "label": label,
                    "score": score,
                    "mask": anomaly_map,
                    "results": [],
                }

            # Generate binary mask to extract anomaly bounding boxes
            _, binary_mask = cv2.threshold(anomaly_map, mask_threshold, 255, cv2.THRESH_BINARY)

            kernel = np.ones((5, 5), np.uint8)
            binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel)
            binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel)

            num_labels, labels_im, stats, _ = cv2.connectedComponentsWithStats(
                binary_mask, connectivity=8
            )

            anomaly_results = []
            anomaly_id = 1

            for l_idx in range(1, num_labels):
                area = stats[l_idx, cv2.CC_STAT_AREA]
                if area < min_area:
                    continue

                x = stats[l_idx, cv2.CC_STAT_LEFT]
                y = stats[l_idx, cv2.CC_STAT_TOP]
                w = stats[l_idx, cv2.CC_STAT_WIDTH]
                h = stats[l_idx, cv2.CC_STAT_HEIGHT]

                anomaly_results.append({
                    "id": anomaly_id,
                    "name": "anomaly",
                    "confidence": round(score, 4),
                    "bbox": [x, y, x + w, y + h],
                    "area": float(area),
                    "mask": labels_im == l_idx,
                })
                anomaly_id += 1

            print(f"Anomaly detected with score {score} and label {label}")

            return {
                "label": label,
                "score": score,
                "mask": binary_mask,
                "results": anomaly_results,
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Error while detecting anomaly: {e}")
            return {}