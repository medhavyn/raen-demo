import { useMemo, useState } from "react";
import { LayoutGrid, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import partsData from "@/data/partsFeatures.json";

export default function FeatureDefinitionPage() {
  const navigate = useNavigate();
  const [features, setFeatures] = useState<string[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>();

  const selectedPart = useMemo(
    () => partsData.parts.find((part) => part.id === selectedPartId),
    [selectedPartId],
  );

  function handlePartChange(partId: string) {
    const selectedPart = partsData.parts.find((part) => part.id === partId);

    if (!selectedPart) {
      return;
    }

    setSelectedPartId(partId);
    setFeatures([...selectedPart.features]);
  }

  function addFeature() {
    setFeatures((prev) => [...prev, ""]);
  }

  function updateFeature(index: number, value: string) {
    setFeatures((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function deleteFeature(index: number) {
    setFeatures((prev) => prev.filter((_, i) => i !== index));
  }

  function handleStartInspection() {
    const cleaned = features.map((value) => value.trim()).filter(Boolean);

    if (cleaned.length === 0) {
      toast.error("Add at least one feature before starting inspection.");
      return;
    }

    navigate("/inspection", { state: { expectedTexts: cleaned } });
  }

  return (
    <div
      className="min-h-full p-6"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(21,104,224,0.12) 0%, transparent 38%), radial-gradient(circle at top right, rgba(26,158,74,0.10) 0%, transparent 32%), linear-gradient(180deg, #f8fbff 0%, #f4f7fb 100%)",
      }}
    >
      <div className="flex items-center gap-3 border-b border-vq-border px-6 py-[18px]">
        <img src="/etavat-logo.svg" alt="etavat" className="h-8 w-auto" />
        <div className="text-xl font-semibold">Etavat VisionQ Prototype</div>
      </div>

      <div className="p-6">
        <Card className="p-6">
          <div className="flex items-center gap-2.5 pb-4">
            <div className="flex h-9.5 w-9.5 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
              <LayoutGrid className="h-4.5 w-4.5" />
            </div>
            <div className="text-base font-bold">Features</div>
          </div>

          <div className="mb-5">
            <div className="mb-2 text-sm font-semibold">Select Part</div>

            <Select value={selectedPartId} onValueChange={handlePartChange}>
              <SelectTrigger className="w-62.5">
                <SelectValue placeholder="Select Part" />
              </SelectTrigger>
              <SelectContent>
                {partsData.parts.map((part) => (
                  <SelectItem key={part.id} value={part.id}>
                    {part.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={`${selectedPartId ? "": "hidden "}mb-5 flex justify-end`}>
            <Button
              variant="outline"
              onClick={addFeature}
              className="border-[#cfe0ff] bg-white"
            >
              <Plus className="h-4 w-4" />
              Add Feature
            </Button>
          </div>

          <div className="flex gap-6">
            {selectedPart?.photo && (
              <img
                src={selectedPart.photo}
                alt={selectedPart.name}
                className="h-64 aspect-4/3 shrink-0 rounded-lg border border-[#e6f0fb] object-cover"
              />
            )}

            <div className="grid flex-1 grid-cols-6 content-start gap-2.5">
              {features.map((value, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={value}
                    onChange={(e) => updateFeature(idx, e.target.value)}
                    placeholder="Enter feature name"
                    className="rounded-lg"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => deleteFeature(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <Button
              size="lg"
              disabled={!selectedPartId}
              onClick={handleStartInspection}
              className="min-w-45 border-none bg-vq-green text-white hover:bg-vq-green-dark"
            >
              Start Inspection
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
