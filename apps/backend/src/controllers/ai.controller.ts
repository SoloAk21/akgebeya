import { Request, Response } from "express";
import { aiService } from "../services/ai.service";

export const generateListingContent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const result = await aiService.generateBilingualListing(req.body);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "AI listing generation failed";
    res.status(400).json({ status: "error", message });
  }
};

export const parseSearchQuery = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const result = await aiService.parseNaturalLanguageSearch(req.body);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "AI natural language search parsing failed";
    res.status(400).json({ status: "error", message });
  }
};
