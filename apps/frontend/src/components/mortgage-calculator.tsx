"use client";

import { useState } from "react";
import { Calculator, Building, Landmark, ChevronRight } from "lucide-react";

export function MortgageCalculator() {
  const [activeTab, setActiveTab] = useState<"mortgage" | "valuation">(
    "mortgage",
  );

  // Mortgage Form State
  const [price, setPrice] = useState<number>(10000000);
  const [downPaymentPercent, setDownPaymentPercent] = useState<number>(20);
  const [interestRate, setInterestRate] = useState<number>(16);
  const [loanTerm, setLoanTerm] = useState<number>(20);

  // Valuation Form State
  const [subCity, setSubCity] = useState<string>("Bole");
  const [areaSqM, setAreaSqM] = useState<number>(120);
  const [condition, setCondition] = useState<string>("GOOD");
  const [valuationResult, setValuationResult] = useState<{
    estimatedPrice: number;
    estimatedPriceMin: number;
    estimatedPriceMax: number;
    medianRatePerSqM: number;
  } | null>(null);

  // Calculated Mortgage Values
  const downPaymentETB = Math.round((price * downPaymentPercent) / 100);
  const principal = price - downPaymentETB;
  const monthlyRate = interestRate / 100 / 12;
  const totalMonths = loanTerm * 12;
  const monthlyPayment =
    monthlyRate > 0
      ? Math.round(
          (principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
            (Math.pow(1 + monthlyRate, totalMonths) - 1),
        )
      : Math.round(principal / totalMonths);

  const totalCost = downPaymentETB + monthlyPayment * totalMonths;
  const totalInterest = totalCost - price;

  const handleValuationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(
        "http://localhost:5000/api/v1/finance/valuation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subCity, areaSqM, condition }),
        },
      );
      const data = await res.json();
      if (data.status === "success") {
        setValuationResult(data.data);
      }
    } catch {
      // Graceful fallback for offline mode
      const rate = subCity.toLowerCase() === "bole" ? 85000 : 65000;
      const estimated = rate * areaSqM;
      setValuationResult({
        estimatedPrice: estimated,
        estimatedPriceMin: Math.round(estimated * 0.9),
        estimatedPriceMax: Math.round(estimated * 1.1),
        medianRatePerSqM: rate,
      });
    }
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden max-w-4xl mx-auto">
      <div className="flex border-b border-neutral-200 bg-neutral-50/50">
        <button
          onClick={() => setActiveTab("mortgage")}
          className={`flex-1 py-4 px-6 text-sm font-semibold flex items-center justify-center space-x-2 border-b-2 transition ${
            activeTab === "mortgage"
              ? "border-brand-600 text-brand-700 bg-white"
              : "border-transparent text-neutral-500 hover:text-neutral-900"
          }`}
        >
          <Landmark className="w-4 h-4" />
          <span>Mortgage Calculator</span>
        </button>
        <button
          onClick={() => setActiveTab("valuation")}
          className={`flex-1 py-4 px-6 text-sm font-semibold flex items-center justify-center space-x-2 border-b-2 transition ${
            activeTab === "valuation"
              ? "border-brand-600 text-brand-700 bg-white"
              : "border-transparent text-neutral-500 hover:text-neutral-900"
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Property Valuation Engine</span>
        </button>
      </div>

      <div className="p-6 md:p-8">
        {activeTab === "mortgage" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                  Property Price (ETB)
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                  Down Payment ({downPaymentPercent}%) —{" "}
                  {downPaymentETB.toLocaleString()} ETB
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={downPaymentPercent}
                  onChange={(e) =>
                    setDownPaymentPercent(Number(e.target.value))
                  }
                  className="w-full accent-brand-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                    Interest Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={interestRate}
                    onChange={(e) => setInterestRate(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                    Loan Term (Years)
                  </label>
                  <input
                    type="number"
                    value={loanTerm}
                    onChange={(e) => setLoanTerm(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-brand-50/50 border border-brand-100 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
                  Estimated Monthly Payment
                </span>
                <div className="text-4xl font-extrabold text-neutral-900 mt-2">
                  {monthlyPayment.toLocaleString()}{" "}
                  <span className="text-base font-semibold text-neutral-500">
                    ETB/mo
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-6 border-t border-brand-100 text-xs text-neutral-600">
                <div className="flex justify-between">
                  <span>Down Payment:</span>
                  <span className="font-semibold text-neutral-900">
                    {downPaymentETB.toLocaleString()} ETB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Loan Principal:</span>
                  <span className="font-semibold text-neutral-900">
                    {principal.toLocaleString()} ETB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Total Interest Paid:</span>
                  <span className="font-semibold text-neutral-900">
                    {totalInterest.toLocaleString()} ETB
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleValuationSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                  Sub-city
                </label>
                <select
                  value={subCity}
                  onChange={(e) => setSubCity(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="Bole">Bole</option>
                  <option value="Kazanchis">Kazanchis</option>
                  <option value="CMC">CMC</option>
                  <option value="Sarbet">Sarbet</option>
                  <option value="Yeka">Yeka</option>
                  <option value="Nifas_Silk">Nifas Silk</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                  Area (m²)
                </label>
                <input
                  type="number"
                  value={areaSqM}
                  onChange={(e) => setAreaSqM(Number(e.target.value))}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                  Property Condition
                </label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="NEW">New Construction</option>
                  <option value="EXCELLENT">Excellent</option>
                  <option value="GOOD">Good</option>
                  <option value="FAIR">Fair</option>
                  <option value="NEEDS_RENOVATION">Needs Renovation</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-3 rounded-xl transition flex items-center space-x-2"
            >
              <Calculator className="w-4 h-4" />
              <span>Estimate Market Value</span>
            </button>

            {valuationResult && (
              <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                      Estimated Market Price
                    </span>
                    <div className="text-3xl font-extrabold text-brand-700 mt-1">
                      {valuationResult.estimatedPrice.toLocaleString()} ETB
                    </div>
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    <div>Valuation Range:</div>
                    <div className="font-semibold text-neutral-800">
                      {valuationResult.estimatedPriceMin.toLocaleString()} -{" "}
                      {valuationResult.estimatedPriceMax.toLocaleString()} ETB
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
