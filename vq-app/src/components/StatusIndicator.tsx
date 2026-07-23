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
    <div className="min-w-35 rounded-md border px-3 py-2 shadow-2xl">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="font-semibold">{labelText}</span>
      </div>
    </div>
  );
}
