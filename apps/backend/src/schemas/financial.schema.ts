import { z } from "zod";

export const propertyConditionEnum = z.enum([
  "NEW",
  "EXCELLENT",
  "GOOD",
  "FAIR",
  "NEEDS_RENOVATION",
]);

export const propertyValuationSchema = z.object({
  subCity: z.string().min(1, "Sub-city is required"),
  areaSqM: z.number().positive("Area in square meters must be greater than 0"),
  condition: propertyConditionEnum.default("GOOD"),
  bedrooms: z.number().int().nonnegative().optional(),
});

export const mortgageCalculatorSchema = z.object({
  propertyPrice: z.number().positive("Property price must be greater than 0"),
  downPaymentPercent: z.number().min(0).max(100).default(20),
  annualInterestRate: z.number().min(0.1).max(30).default(16),
  loanTermYears: z.number().int().min(1).max(30).default(20),
});

export type PropertyCondition = z.infer<typeof propertyConditionEnum>;
export type PropertyValuationInput = z.infer<typeof propertyValuationSchema>;
export type MortgageCalculatorInput = z.infer<typeof mortgageCalculatorSchema>;
