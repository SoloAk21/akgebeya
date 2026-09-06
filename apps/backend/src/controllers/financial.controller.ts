import { Request, Response } from "express";
import {
  propertyValuationSchema,
  mortgageCalculatorSchema,
} from "../schemas/financial.schema";
import { financialService } from "../services/financial.service";

export const getValuationEstimate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parseResult = propertyValuationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const result = financialService.calculatePropertyValuation(
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Valuation calculation failed";
    res.status(400).json({ status: "error", message });
  }
};

export const calculateMortgageEstimate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parseResult = mortgageCalculatorSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const result = financialService.calculateMortgage(parseResult.data);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Mortgage calculation failed";
    res.status(400).json({ status: "error", message });
  }
};
