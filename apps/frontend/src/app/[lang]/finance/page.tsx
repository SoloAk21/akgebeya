import { MortgageCalculator } from "@/components/mortgage-calculator";
import { Shield, Sparkles } from "lucide-react";

export default function FinancePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <div className="inline-flex items-center space-x-2 bg-brand-50 text-brand-700 text-xs font-semibold px-3 py-1 rounded-full">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Real Estate Intelligence</span>
        </div>
        <h1 className="text-3xl font-bold text-neutral-900">
          Financial Tools & Market Intelligence
        </h1>
        <p className="text-neutral-500 text-sm">
          Estimate monthly mortgage payments and calculate real-time property
          market values across Addis Ababa sub-cities.
        </p>
      </div>

      <MortgageCalculator />
    </div>
  );
}
