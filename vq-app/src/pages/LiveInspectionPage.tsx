import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { ChevronLeft, PauseCircle, PlayCircle, CheckCircle2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import StatusIndicator from "@/components/StatusIndicator";
import SummaryCard from "@/components/SummaryCard";
import WrongTextCard from "@/components/WrongTextCard";
import CameraView from "@/components/CameraView";
import {
  startInspection,
  pauseInspection,
  resumeInspection,
  finishInspection,
  getLatestInspection,
} from "@/services/api";
import type { InspectionResult, ScanStatus } from "@/types/inspection";
import { loadExpectedTexts, matchExpectedTexts, saveExpectedTexts } from "@/utils/expectedText";

const POLL_INTERVAL_MS = 1500;

type InspectionLocationState = {
  expectedTexts?: string[];
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
  const [cameraStatus, setCameraStatus] = useState<"ready" | "waiting" | "detecting" | "not_ready">("waiting");
  const [cameraActive, setCameraActive] = useState(false);
  const [expectedTexts, setExpectedTexts] = useState<string[]>(() => loadExpectedTexts());
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
              setCameraStatus("waiting");
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
          setCameraStatus("waiting");
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

    try {
      rejectionHandledRef.current = false;

      if (status !== "paused") {
        setInspectionTotals({ total: 0, accepted: 0, rejected: 0 });
        lastCountedFrameNumber.current = 0;
      }
      setStatus("scanning");
      setCameraStatus("detecting");
      setResult(EMPTY_RESULT);

      if (status === "paused") {
        // Resume from paused state
        await resumeInspection();
      } else {
        // Fresh start
        await startInspection();
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
      setCameraStatus("waiting");
      // Keep polling so we keep showing the latest result
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to pause inspection");
    }
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
  }

  const scanBannerLabel =
    status === "scanning"
      ? "SCAN STARTED"
      : status === "paused"
        ? "SCAN PAUSED"
        : status === "finished"
          ? "SCAN FINISHED"
          : "SCAN IDLE";

  const bannerColorClass =
    status === "scanning"
      ? "bg-vq-green"
      : status === "paused"
        ? "bg-[#d48806]"
        : status === "finished"
          ? "bg-[#4F8EF7]"
          : "bg-[#94a3b8]";

  const detectedTexts = useMemo(() => result.ocrLines.map((line) => line.text).filter(Boolean), [result.ocrLines]);
  const inspectionComplete = detectedTexts.length > 0;
  const textMatches = useMemo(
    () => matchExpectedTexts(expectedTexts, detectedTexts, inspectionComplete),
    [detectedTexts, expectedTexts, inspectionComplete],
  );

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
    <div className="min-h-full bg-vq-bg">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-vq-border bg-vq-panel px-6 py-3">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="p-0 text-sm text-vq-text"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        <StatusIndicator label="Camera Status" status={cameraStatus} />
      </div>

      {/* Scan status banner */}
      <div
        className={`-mt-1.5 py-2 text-center text-sm font-extrabold tracking-[0.08em] text-white ${bannerColorClass}`}
      >
        {scanBannerLabel}
      </div>

      <div className="px-6 pt-5 pb-6">
        <div className="grid grid-cols-[420px_minmax(0,1fr)] items-start gap-6">
          {/* Left side */}
          <div
            className={`grid min-h-[460px] w-[420px] gap-4 ${
              missingItems.length > 0 ? "grid-cols-[170px_1fr]" : "grid-cols-[170px]"
            }`}
          >
            <div className="flex flex-col gap-3">
              <SummaryCard label="Total" value={totalCount} color="var(--vq-text)" />
              <SummaryCard label="Accepted" value={acceptedCount} color="var(--vq-green)" />
              <SummaryCard label="Rejected" value={rejectedCount} color="var(--vq-red)" />
            </div>

            {missingItems.length > 0 ? (
              <WrongTextCard items={missingItems} completed={inspectionComplete} />
            ) : null}
          </div>

          {/* Right side */}
          <div className="ml-auto flex h-full w-[850px] flex-col">
            <div className="vq-eyebrow mb-2.5">Live Camera View</div>

            <CameraView
              active={cameraActive}
              capturedImageBase64={result.capturedImageBase64}
              anomaly={result.anomaly}
            />

            <div className="mt-[18px] flex w-full justify-center">
              <div className="flex gap-4">
                <Button
                  variant="outline"
                  disabled={status !== "scanning"}
                  onClick={handlePause}
                  className="h-10 w-[140px] text-sm"
                >
                  <PauseCircle className="h-4 w-4" />
                  Pause
                </Button>

                <Button
                  disabled={status === "idle"}
                  onClick={handleFinish}
                  className="h-10 w-[140px] text-sm"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Finish
                </Button>

                <Button
                  onClick={handleStart}
                  disabled={status === "scanning"}
                  className="h-10 w-[140px] border-none bg-vq-green text-sm text-white hover:bg-vq-green-dark"
                >
                  <PlayCircle className="h-4 w-4" />
                  {status === "paused" ? "Resume" : "Start"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
