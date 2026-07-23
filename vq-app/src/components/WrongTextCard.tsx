import { XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { WrongTextItem } from "@/types/inspection";

interface WrongTextCardProps {
  items: WrongTextItem[];
  completed?: boolean;
}

export default function WrongTextCard({ items, completed = true }: WrongTextCardProps) {
  return (
    <Card className="min-h-[110px] rounded-xl border border-[#f3b4b4] bg-[#fffafa] p-3.5">
      <div className="mb-3.5 flex items-center gap-2">
        <span className="text-sm font-extrabold text-vq-red">WRONG / MISSING TEXT</span>
      </div>

      {items.length === 0 ? (
        completed ? (
          <div className="rounded-xl border border-dashed border-[#f1a2a2] bg-[#fff4f4] p-3.5 text-[13px] font-semibold text-vq-red">
            No issues detected
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#f1a2a2] bg-[#fffafa] p-3.5 text-[13px] font-semibold text-vq-text-muted">
            Waiting for inspection to complete
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item, idx) => (
            <div
              key={`${item.text}-${idx}`}
              className="flex items-start justify-between gap-3 rounded-2xl border border-[#f2b5b5] bg-[#fff4f4] px-3.5 py-3"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <XCircle className="mt-0.5 h-[15px] w-[15px] shrink-0 text-vq-red" />
                <div className="min-w-0">
                  <div className="text-[15px] font-bold break-words text-vq-text">{item.text}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
