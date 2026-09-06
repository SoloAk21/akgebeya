import {
  PropertyValuationInput,
  MortgageCalculatorInput,
  PropertyCondition,
} from "../schemas/financial.schema";

const SUB_CITY_MEDIAN_RATES_PER_SQM: Record<string, number> = {
  bole: 85000,
  kazanchis: 95000,
  cmc: 65000,
  sarbet: 75000,
  piassa: 70000,
  mexico: 80000,
  nifas_silk: 60000,
  akaki_kality: 40000,
  kolfe_keraniyo: 45000,
  gullele: 50000,
  yeka: 60000,
  arada: 75000,
};

const CONDITION_MULTIPLIERS: Record<PropertyCondition, number> = {
  NEW: 1.2,
  EXCELLENT: 1.1,
  GOOD: 1.0,
  FAIR: 0.85,
  NEEDS_RENOVATION: 0.7,
};

export class FinancialService {
  calculatePropertyValuation(input: PropertyValuationInput): {
    estimatedPrice: number;
    estimatedPriceMin: number;
    estimatedPriceMax: number;
    medianRatePerSqM: number;
    currency: string;
    subCity: string;
  } {
    const subCityKey = input.subCity
      .toLowerCase()
      .trim()
      .replace(/[\s-]/g, "_");
    const medianRatePerSqM = SUB_CITY_MEDIAN_RATES_PER_SQM[subCityKey] || 55000;
    const conditionFactor = CONDITION_MULTIPLIERS[input.condition];

    const estimatedPrice = Math.round(
      medianRatePerSqM * input.areaSqM * conditionFactor,
    );
    const estimatedPriceMin = Math.round(estimatedPrice * 0.9);
    const estimatedPriceMax = Math.round(estimatedPrice * 1.1);

    return {
      estimatedPrice,
      estimatedPriceMin,
      estimatedPriceMax,
      medianRatePerSqM,
      currency: "ETB",
      subCity: input.subCity,
    };
  }

  calculateMortgage(input: MortgageCalculatorInput): {
    propertyPrice: number;
    downPaymentAmount: number;
    loanPrincipal: number;
    monthlyPayment: number;
    totalInterestPaid: number;
    totalCost: number;
    currency: string;
    annualInterestRate: number;
    loanTermYears: number;
  } {
    const downPaymentAmount = Math.round(
      (input.propertyPrice * input.downPaymentPercent) / 100,
    );
    const loanPrincipal = input.propertyPrice - downPaymentAmount;

    const monthlyInterestRate = input.annualInterestRate / 100 / 12;
    const totalMonths = input.loanTermYears * 12;

    let monthlyPayment = 0;
    if (monthlyInterestRate > 0) {
      const compoundFactor = Math.pow(1 + monthlyInterestRate, totalMonths);
      monthlyPayment = Math.round(
        (loanPrincipal * monthlyInterestRate * compoundFactor) /
          (compoundFactor - 1),
      );
    } else {
      monthlyPayment = Math.round(loanPrincipal / totalMonths);
    }

    const totalCost = downPaymentAmount + monthlyPayment * totalMonths;
    const totalInterestPaid = totalCost - input.propertyPrice;

    return {
      propertyPrice: input.propertyPrice,
      downPaymentAmount,
      loanPrincipal,
      monthlyPayment,
      totalInterestPaid,
      totalCost,
      currency: "ETB",
      annualInterestRate: input.annualInterestRate,
      loanTermYears: input.loanTermYears,
    };
  }
}

export const financialService = new FinancialService();
