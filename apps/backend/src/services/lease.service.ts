import PDFDocument from "pdfkit";
import {
  listingRepository,
  ListingRepository,
} from "../repositories/listing.repository";
import { GenerateLeaseInput } from "../schemas/lease.schema";

export class LeaseService {
  constructor(private listingRepo: ListingRepository = listingRepository) {}

  async generateLeasePdf(input: GenerateLeaseInput): Promise<Buffer> {
    const listing = await this.listingRepo.findById(input.listingId);
    if (!listing) {
      throw new Error("Listing not found");
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: "A4" });
        const buffers: Buffer[] = [];

        doc.on("data", (chunk: Buffer) => buffers.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(buffers)));

        // Document Header
        doc
          .fillColor("#15803d")
          .fontSize(20)
          .text("AkGebeya Real Estate Marketplace", { align: "center" });
        doc
          .fillColor("#333333")
          .fontSize(14)
          .text("Residential Lease Agreement / የመኖሪያ ቤት ኪራይ ውል ስምምነት", {
            align: "center",
          });
        doc.moveDown(1.5);

        // Agreement Metadata Box
        doc.rect(50, doc.y, 495, 60).fillAndStroke("#f0fdf4", "#15803d");

        doc
          .fillColor("#15803d")
          .fontSize(10)
          .text(
            `Agreement Reference: AKG-LEASE-${Date.now().toString().slice(-6)}`,
            60,
            doc.y - 50,
          )
          .text(`Listing Title: ${listing.titleEn}`)
          .text(
            `Property Location: ${listing.location?.city || "Addis Ababa"}, Ethiopia`,
          );

        doc.moveDown(3);

        // Parties Section
        doc
          .fillColor("#111827")
          .fontSize(12)
          .text("1. PARTIES TO THIS AGREEMENT / የውል ተዋዋይ ወገኖች", {
            underline: true,
          });
        doc.moveDown(0.5);

        doc
          .fontSize(10)
          .fillColor("#374151")
          .text(`• Landlord / አከራይ: ${input.landlordName}`)
          .text(`• Tenant / ተከራይ: ${input.tenantName}`);

        if (input.brokerName) {
          doc.text(`• Facilitating Broker / ደላላ/ወኪል: ${input.brokerName}`);
        }
        doc.moveDown(1.5);

        // Lease Terms Section
        doc
          .fillColor("#111827")
          .fontSize(12)
          .text("2. FINANCIAL TERMS & DURATION / የኪራይ መጠን እና ጊዜ", {
            underline: true,
          });
        doc.moveDown(0.5);

        doc
          .fontSize(10)
          .fillColor("#374151")
          .text(
            `• Monthly Rent / ወርሃዊ ኪራይ: ${input.monthlyRent.toLocaleString()} ETB`,
          )
          .text(
            `• Security Deposit / የውል ማስከበሪያ (መያዣ): ${input.depositAmount.toLocaleString()} ETB`,
          )
          .text(`• Start Date / የውል መጀመሪያ ቀን: ${input.startDate}`)
          .text(`• Duration / የውል ቆይታ: ${input.durationMonths} Months`);
        doc.moveDown(1.5);

        // Standard Conditions Section
        doc
          .fillColor("#111827")
          .fontSize(12)
          .text("3. STANDARD COVENANTS / የውል ግዴታዎች", { underline: true });
        doc.moveDown(0.5);

        const defaultTerms =
          input.termsEn ||
          "1. The Tenant agrees to pay monthly rent in advance on or before the 1st day of each Ethiopian calendar month.\n" +
            "2. The Security Deposit shall be refunded upon termination subject to inspection for damages.\n" +
            "3. Subletting or transferring the property without written consent from the Landlord is strictly prohibited.";

        doc
          .fontSize(9)
          .fillColor("#4b5563")
          .text(defaultTerms, { align: "justify", lineGap: 3 });
        doc.moveDown(2);

        // Signatures Section
        doc
          .fillColor("#111827")
          .fontSize(12)
          .text("4. SIGNATURES & EXECUTION / ፊርማ", { underline: true });
        doc.moveDown(1.5);

        const currentY = doc.y;

        // Landlord Signature Block
        doc.moveTo(50, currentY).lineTo(190, currentY).stroke("#9ca3af");
        doc
          .fontSize(9)
          .fillColor("#374151")
          .text("Landlord Signature / የአከራይ ፊርማ", 50, currentY + 5);

        // Tenant Signature Block
        doc.moveTo(200, currentY).lineTo(340, currentY).stroke("#9ca3af");
        doc
          .fontSize(9)
          .fillColor("#374151")
          .text("Tenant Signature / የተከራይ ፊርማ", 200, currentY + 5);

        // Witness / Broker Signature Block
        doc.moveTo(350, currentY).lineTo(490, currentY).stroke("#9ca3af");
        doc
          .fontSize(9)
          .fillColor("#374151")
          .text("Witness / Broker / ምስክር", 350, currentY + 5);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const leaseService = new LeaseService();
