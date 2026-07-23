import type { AnomalyView } from "@/types/inspection";

interface CameraViewProps {
  active: boolean;
  capturedImageBase64?: string | null;
  anomaly?: AnomalyView;
}

export default function CameraView({ active, capturedImageBase64, anomaly }: CameraViewProps) {
  const hasImage = !!capturedImageBase64;

  return (
    <div
      className="relative min-h-[420px] w-full flex-1 overflow-hidden rounded-md border border-vq-border"
      style={{
        background: hasImage
          ? "#0e131a"
          : "radial-gradient(circle at 30% 20%, #23303f 0%, #151c26 55%, #0e131a 100%)",
      }}
    >
      {/* Captured crop image with annotations baked in */}
      {hasImage && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0e131a]">
          <img
            src={`data:image/png;base64,${capturedImageBase64}`}
            alt="Detected part crop"
            className="block h-full w-full max-w-full max-h-full shrink-0 object-contain object-center"
          />
        </div>
      )}

      {/* Anomaly status badge */}
      {anomaly && hasImage && (
        <div
          className={`${anomaly.count > 0 ? "animated-part-rejected": "bg-vq-green"} absolute top-3 left-3 z-10 rounded-md px-2 py-1 text-lg font-semibold text-primary-foreground backdrop-blur-sm`}
        >
          {anomaly.count > 0 ? "Rejected" : "Accepted"}
        </div>
      )}

      {/* Grid placeholder when no image */}
      {!hasImage && (
        <svg
          width="100%"
          height="100%"
          className={`absolute inset-0 opacity-25 ${active ? "animated-scanning-grid" : ""}`}
        >
          <defs>
            <pattern id="vq-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="#3a4a5c" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#vq-grid)" />
        </svg>
      )}

      {!active && !hasImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-sm font-semibold tracking-[0.04em] text-[#8291a3]">
          <div>Camera not started</div>
          <div className="mt-2">Press Start Inspection</div>
        </div>
      )}
    </div>
  );
}
