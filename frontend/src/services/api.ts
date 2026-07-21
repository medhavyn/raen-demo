import axios from "axios";

// Frontend calls Python FastAPI directly.
const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

export const apiClient = axios.create({ baseURL });

export async function startInspection() {
  const res = await apiClient.post("/inspect/start");
  return res.data;
}

export async function pauseInspection() {
  const res = await apiClient.post("/inspect/pause");
  return res.data;
}

export async function resumeInspection() {
  const res = await apiClient.post("/inspect/resume");
  return res.data;
}

export async function finishInspection() {
  const res = await apiClient.post("/inspect/finish");
  return res.data;
}

export async function getLatestInspection() {
  const res = await apiClient.get("/inspect/latest");
  return res.data;
}
