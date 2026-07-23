interface SummaryCardProps {
  label: string;
  value: number;
  color: string;
}

export default function SummaryCard({ label, value, color }: SummaryCardProps) {
  return (
    <div>
      <div className="vq-eyebrow">{label}</div>
      <div className="mt-1 text-6xl leading-none font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
