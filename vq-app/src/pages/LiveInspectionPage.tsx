import CameraView from "@/components/CameraView";
import StatusIndicator from "@/components/StatusIndicator";
import SummaryCard from "@/components/SummaryCard";
import TextResult from "@/components/TextResult";
import { Button } from "@/components/ui/button";
import {
  finishInspection,
  getLatestInspection,
  pauseInspection,
  resumeInspection,
  startInspection,
} from "@/services/api";
import type { InspectionResult, ScanStatus } from "@/types/inspection";
import { loadExpectedTexts, matchExpectedTexts, saveExpectedTexts } from "@/utils/expectedText";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 1500;

type InspectionLocationState = {
  expectedTexts?: string[];
  part?: { id: string; name: string; photo?: string };
  condition?: "good" | "bad";
};

const EMPTY_RESULT: InspectionResult = {
  total: 0,
  accepted: 0,
  rejected: 0,
  wrongText: [],
  boxes: [],
  ocrLines: [],
  anomaly: {
    label: 0,
    score: 0,
    count: 0,
  },
  capturedImageBase64: null,
};

export default function LiveInspectionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [result, setResult] = useState<InspectionResult>(EMPTY_RESULT);
  const [cameraStatus, setCameraStatus] = useState<"ready" | "detecting" | "not_ready">("ready");
  const [cameraActive, setCameraActive] = useState(false);
  const [expectedTexts, setExpectedTexts] = useState<string[]>(() => loadExpectedTexts());
  const [partName, setPartName] = useState<string | undefined>(
    () => (location.state as InspectionLocationState | null)?.part?.name,
  );
  const [partPhoto, setPartPhoto] = useState<string | undefined>(
    () => (location.state as InspectionLocationState | null)?.part?.photo,
  );
  const [partId, setPartId] = useState<string | undefined>(
    () => (location.state as InspectionLocationState | null)?.part?.id,
  );
  const [condition, setCondition] = useState<"good" | "bad">(
    () => (location.state as InspectionLocationState | null)?.condition ?? "good",
  );
  const [inspectionTotals, setInspectionTotals] = useState({ total: 0, accepted: 0, rejected: 0 });
  const lastCountedFrameNumber = useRef(0);
  const rejectionHandledRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const state = location.state as InspectionLocationState | null;
    if (state?.expectedTexts?.length) {
      const cleaned = state.expectedTexts.map((text) => text.trim()).filter(Boolean);
      setExpectedTexts(cleaned);
      saveExpectedTexts(cleaned);
    } else {
      setExpectedTexts(loadExpectedTexts());
    }
    if (state?.part?.name) {
      setPartName(state.part.name);
    }
    if (state?.part?.photo) {
      setPartPhoto(state.part.photo);
    }
    if (state?.part?.id) {
      setPartId(state.part.id);
    }
    if (state?.condition) {
      setCondition(state.condition);
    }
  }, [location.state]);

  // -----------------------------------------------------------------------
  // Polling: fetch the latest result from the backend every POLL_INTERVAL_MS
  // -----------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();

    const poll = async () => {
      try {
        const data = await getLatestInspection();
        const backendStatus: string = data.status;
        const latestResult: InspectionResult | null = data.result;

        if (latestResult) {
          setResult(latestResult);
          setCameraActive(!!latestResult.capturedImageBase64);

          if (latestResult.error) {
            setCameraStatus("not_ready");
          } else {
            setCameraStatus("ready");
          }

          const frameNumber = typeof latestResult.frameNumber === "number" ? latestResult.frameNumber : 0;
          const detectedTexts = latestResult.ocrLines.map((line) => line.text).filter(Boolean);
          const frameMatches = matchExpectedTexts(expectedTexts, detectedTexts, true);
          const hasMissingText = frameMatches.some((item) => item.status === "missing");
          const hasAnomaly = (latestResult.anomaly?.count ?? 0) > 0;
          const isRejected = hasAnomaly || hasMissingText;
          const isAccepted = !hasAnomaly && !hasMissingText;

          if (frameNumber > 0 && frameNumber > lastCountedFrameNumber.current && !latestResult.error) {
            if (isAccepted) {
              setInspectionTotals((prev) => ({
                total: prev.total + 1,
                accepted: prev.accepted + 1,
                rejected: prev.rejected,
              }));
            } else if (isRejected && !rejectionHandledRef.current) {
              setInspectionTotals((prev) => ({
                total: prev.total + 1,
                accepted: prev.accepted,
                rejected: prev.rejected + 1,
              }));
              rejectionHandledRef.current = true;
              setStatus("paused");
              setCameraStatus("ready");
              stopPolling();
              void pauseInspection().catch(() => {
                // Keep the current result visible and stop further processing.
              });
            }

            lastCountedFrameNumber.current = frameNumber;
          }
        }
        // Sync frontend status with backend status
        if (backendStatus === "paused") {
          setStatus("paused");
          setCameraStatus("ready");
          // Keep polling so we can show the frozen frame, but at a slower rate
        } else if (backendStatus === "finished" || backendStatus === "idle") {
          setStatus(backendStatus === "idle" ? "idle" : "finished");
          stopPolling();
        }
      } catch {
        // Silently retry on next interval (backend might be busy)
      }
    };

    // First poll immediately
    void poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [stopPolling, expectedTexts]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling, expectedTexts]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  async function handleStart() {
    if (status === "scanning") return;

    if (expectedTexts.length === 0) {
      toast.error("Define at least one expected text before starting inspection.");
      navigate("/");
      return;
    }

    if (status !== "paused" && !partId) {
      toast.error("No part selected.");
      navigate("/");
      return;
    }

    try {
      rejectionHandledRef.current = false;

      if (status !== "paused") {
        setInspectionTotals({ total: 0, accepted: 0, rejected: 0 });
        lastCountedFrameNumber.current = 0;
      }
      setStatus("scanning");
      setCameraStatus("detecting");
      setCameraActive(true);
      setResult(EMPTY_RESULT);

      if (status === "paused") {
        // Resume from paused state
        await resumeInspection();
      } else {
        // Fresh start
        await startInspection(partId!, condition);
      }

      // Start polling for results
      startPolling();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to start inspection");
      setStatus("idle");
      setCameraStatus("not_ready");
    }
  }

  async function handlePause() {
    if (status !== "scanning") return;
    try {
      await pauseInspection();
      setStatus("paused");
      setCameraStatus("ready");
      // Keep polling so we keep showing the latest result
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to pause inspection");
    }
    navigate("/")
  }

  async function handleFinish() {
    try {
      await finishInspection();
      setStatus("finished");
      setCameraStatus("not_ready");
      stopPolling();
      toast.success("Inspection finished");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to finish inspection");
    }
    navigate("/")
  }

  const scanBannerLabel =
    status === "scanning"
      ? "INSPECTION STARTED"
      : status === "paused"
        ? "INSPECTION PAUSED"
        : status === "finished"
          ? "INSPECTION FINISHED"
          : "IDLE";

  const bannerColorClass =
    status === "scanning"
      ? "status-active animated-status"
      : status === "paused"
        ? "status-paused animated-status"
        : status === "finished"
          ? "bg-[#4F8EF7]"
          : "status-idle animated-status";

  const detectedTexts = useMemo(() => result.ocrLines.map((line) => line.text).filter(Boolean), [result.ocrLines]);
  const inspectionComplete = detectedTexts.length > 0;
  const textMatches = useMemo(
    () => matchExpectedTexts(expectedTexts, detectedTexts, inspectionComplete),
    [detectedTexts, expectedTexts, inspectionComplete],
  );
  console.debug(expectedTexts)
  console.debug(detectedTexts)

  const totalCount = inspectionTotals.total;
  const acceptedCount = inspectionTotals.accepted;
  const rejectedCount = inspectionTotals.rejected;

  const missingItems = useMemo(
    () =>
      textMatches
        .filter((item) => item.status === "missing")
        .map((item) => ({
          text: item.expectedText,
          reason: item.detectedText ? `Detected as ${item.detectedText}` : "Not detected in OCR",
        })),
    [textMatches],
  );

  return (
    <div className="flex min-h-screen flex-col bg-vq-bg gap-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between p-2">
        <Button variant="outline" size="lg" onClick={() => navigate("/")} className="text-primary text-lg">
          <ChevronLeft className="size-4" />
          {partName ? partName : "Change Part"}
        </Button>

        <StatusIndicator label="Camera Status" status={cameraStatus} />
      </div>

      {/* Scan status banner */}
      <div
        className={`py-1 text-center text-sm font-semibold tracking-widest text-primary-foreground ${bannerColorClass}`}
      >
        {scanBannerLabel}
      </div>

      <div className="flex min-h-0 flex-1 gap-6 px-6 pt-5 pb-6">
        {/* Left side */}
        <div className="flex w-44 flex-col gap-6">
          {partPhoto && (
            <div>
              <div className="vq-eyebrow mb-2">Reference Image</div>
              <img
                src={partPhoto}
                alt={partName ?? "Reference part"}
                className="aspect-4/3 w-full rounded-md object-cover"
              />
            </div>
          )}
          <SummaryCard label="Total" value={totalCount} color="var(--color-vq-text)" />
          <SummaryCard label="Accepted" value={acceptedCount} color="var(--color-vq-green)" />
          <SummaryCard label="Rejected" value={rejectedCount} color="var(--color-vq-red)" />
        </div>

        <TextResult items={missingItems} completed={inspectionComplete} />

        {/* Right side */}
        <div className="ml-auto flex flex-col flex-1 min-h-0 min-w-0 ">
          <div className="vq-eyebrow mb-2">Camera View</div>

          <CameraView active={cameraActive} capturedImageBase64={result.capturedImageBase64} anomaly={result.anomaly} />
        </div>
      </div>

      <div className="fixed bottom-6 left-6 flex flex-col gap-4">
        <Button size="lg" variant="secondary" disabled={status !== "scanning"} onClick={handlePause}>
          Pause Inspection
        </Button>

        <Button size="lg" disabled={status === "idle"} onClick={handleFinish}>
          Finish Inspection
        </Button>

        <Button
          size="lg"
          variant="default"
          onClick={handleStart}
          disabled={status === "scanning"}
          className="bg-vq-green hover:bg-vq-green-dark"
        >
          {status === "paused" ? "Resume" : "Start"} Inspection
        </Button>
      </div>
    </div>
  );
}
