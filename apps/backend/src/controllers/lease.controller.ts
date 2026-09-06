import { Request, Response } from "express";
import { generateLeaseSchema } from "../schemas/lease.schema";
import { leaseService } from "../services/lease.service";

export const generateLeaseAgreement = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parseResult = generateLeaseSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const pdfBuffer = await leaseService.generateLeasePdf(parseResult.data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=AkGebeya_Lease_Agreement.pdf",
    );
    res.setHeader("Content-Length", pdfBuffer.length);

    res.status(200).send(pdfBuffer);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to generate lease agreement";
    const statusCode = message === "Listing not found" ? 404 : 400;
    res.status(statusCode).json({ status: "error", message });
  }
};
