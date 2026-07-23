import { Loader2 } from "lucide-react";

export const BigSpinner = () => (
  <div className="relative flex items-center justify-center">
    <Loader2 data-testid="big-spinner" strokeWidth={1} className={`h-24 w-24 animate-spin text-primary absolute`} />
    <img src="/etavat-logo.svg" className="w-8" alt={`etavat logo`} />
  </div>
);