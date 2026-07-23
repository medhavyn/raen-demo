interface StatusIndicatorProps {
  label: string;
  status: "ready" | "waiting" | "detecting" | "not_ready";
}

export default function StatusIndicator({ label, status }: StatusIndicatorProps) {
  const ready = status === "ready";
  const notReady = status === "not_ready";
  const detecting = status === "detecting";

  const dotColor = ready ? "bg-[#22c55e]" : notReady ? "bg-[#ef4444]" : "bg-[#f59e0b]";
  const labelText = ready ? "Ready" : notReady ? "Not Ready" : detecting ? "Detecting" : "Waiting";

  return (
    <div className="min-w-[140px] rounded-lg border border-[#d9d9d9] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
        {label}
      </div>

      <div className="mt-[5px] flex items-center gap-1.5">
        <div className={`h-[9px] w-[9px] rounded-full ${dotColor}`} />
        <span className="text-[13px] font-semibold">{labelText}</span>
      </div>
    </div>
  );
}
