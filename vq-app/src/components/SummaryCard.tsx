interface SummaryCardProps {
  label: string;
  value: number;
  color: string;
}

export default function SummaryCard({ label, value, color }: SummaryCardProps) {
  return (
    <div className="w-[148px] min-w-[136px] max-w-[160px] rounded-xl border border-vq-border bg-vq-panel px-3 py-2.5">
      <div className="vq-eyebrow">{label}</div>
      <div className="mt-1 text-2xl leading-none font-extrabold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
