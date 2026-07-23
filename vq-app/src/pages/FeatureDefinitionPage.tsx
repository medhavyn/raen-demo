import { useEffect, useMemo, useState } from "react";
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
import { loadExpectedTexts, parseExpectedTexts, saveExpectedTexts } from "@/utils/expectedText";
import partsData from "@/data/partsFeatures.json";

export default function FeatureDefinitionPage() {
  const navigate = useNavigate();
  const [features, setFeatures] = useState<string[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>();

  useEffect(() => {
    const draft = window.localStorage.getItem("vq-expected-texts-draft");
    const saved = loadExpectedTexts();
    const savedFeatures = parseExpectedTexts(saved.join("\n"));

    if (draft) {
      const draftFeatures = parseExpectedTexts(draft);
      setFeatures(draftFeatures);
      setIsSaved(
        draftFeatures.length === savedFeatures.length &&
          draftFeatures.every((value, index) => value === savedFeatures[index]),
      );
    } else {
      setFeatures(savedFeatures);
      setIsSaved(savedFeatures.length > 0);
    }
  }, []);

  useEffect(() => {
    // persist a simple draft string to preserve UX across reloads
    window.localStorage.setItem("vq-expected-texts-draft", features.join("\n"));
  }, [features]);

  const parsedTexts = useMemo(() => parseExpectedTexts(features.join("\n")), [features]);
  const validFeatureCount = useMemo(
    () => features.map((value) => value.trim()).filter(Boolean).length,
    [features],
  );
  const canStartInspection = validFeatureCount > 0 && isSaved;

  function handleStartInspection() {
    if (parsedTexts.length === 0) {
      toast.error("Add at least one expected text before starting inspection.");
      return;
    }

    saveExpectedTexts(parsedTexts);
    window.localStorage.removeItem("vq-expected-texts-draft");
    navigate("/inspection", { state: { expectedTexts: parsedTexts } });
  }

  function handleSave() {
    const cleaned = parsedTexts;
    try {
      saveExpectedTexts(cleaned);
      setIsSaved(true);
      toast.success("Features saved");
    } catch (error) {
      toast.error("Failed to save features");
    }
  }

  function handlePartChange(partId: string) {
    const selectedPart = partsData.parts.find((part) => part.id === partId);

    if (!selectedPart) {
      return;
    }

    setSelectedPartId(partId);
    setFeatures([...selectedPart.features]);
    setIsSaved(false);
  }

  function addFeature() {
    setFeatures((prev) => [...prev, ""]);
    setIsSaved(false);
  }

  function updateFeature(index: number, value: string) {
    setFeatures((prev) => prev.map((v, i) => (i === index ? value : v)));
    setIsSaved(false);
  }

  function deleteFeature(index: number) {
    setFeatures((prev) => prev.filter((_, i) => i !== index));
    setIsSaved(false);
  }

  return (
    <div
      className="min-h-full p-6"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(21,104,224,0.12) 0%, transparent 38%), radial-gradient(circle at top right, rgba(26,158,74,0.10) 0%, transparent 32%), linear-gradient(180deg, #f8fbff 0%, #f4f7fb 100%)",
      }}
    >
      <div className="mx-auto max-w-[1280px] overflow-hidden rounded-3xl border border-slate-200/95 bg-white/92 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <div className="flex items-center border-b border-vq-border bg-white px-6 py-[18px]">
          <div className="text-xl font-extrabold">VisionQ OCR Inspection</div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6">
          <Card className="rounded-xl border border-[#e6f0fb] p-0">
            <div className="border-b border-[#d7ecff] bg-[#eaf6ff] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-[#2f6be8] text-white">
                    <LayoutGrid className="h-[18px] w-[18px]" />
                  </div>
                  <div className="text-base font-bold">Features</div>
                </div>
                <Button
                  variant="outline"
                  onClick={addFeature}
                  className="border-[#cfe0ff] bg-white"
                >
                  <Plus className="h-4 w-4" />
                  Add Feature
                </Button>
              </div>
            </div>

            <div className="bg-white p-[18px]">
              <div className="mb-5">
                <div className="mb-2 text-sm font-semibold">Select Part</div>

                <Select value={selectedPartId} onValueChange={handlePartChange}>
                  <SelectTrigger className="w-[250px]">
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

              <div className="flex flex-col gap-2.5">
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

              <div className="mt-5 flex gap-3">
                <Button
                  size="lg"
                  onClick={handleSave}
                  disabled={validFeatureCount === 0}
                  className={
                    validFeatureCount > 0
                      ? "min-w-[120px] border-none bg-vq-blue text-white hover:bg-vq-blue-dark"
                      : "min-w-[120px]"
                  }
                >
                  Save
                </Button>

                <Button
                  size="lg"
                  onClick={handleStartInspection}
                  disabled={!canStartInspection}
                  className="min-w-[180px] border-none bg-vq-green text-white hover:bg-vq-green-dark"
                >
                  Start Inspection
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
