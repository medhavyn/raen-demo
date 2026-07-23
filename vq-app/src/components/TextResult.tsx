import { XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { WrongTextItem } from "@/types/inspection";

interface TextResultProps {
  items: WrongTextItem[];
  completed?: boolean;
}

export default function TextResult({ items, completed = true }: TextResultProps) {
  return (
    <div className="px-3.5">
      <div className={`vq-eyebrow mb-2`}>Text Labels</div>

      {items.length === 0 ? (
        completed ? (
          <div className="rounded-md text-vq-green font-semibold text-xl">All labels found.</div>
        ) : (
          <div className="text-vq-text-muted">Awaiting inspection results</div>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item, idx) => (
            <div
              key={`${item.text}-${idx}`}
              className="animated-part-rejected flex items-start justify-between gap-3 rounded-md p-3"
            >
              {item.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
