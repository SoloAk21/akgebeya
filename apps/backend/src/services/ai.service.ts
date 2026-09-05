import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.config";
import {
  generateContentInputSchema,
  bilingualListingOutputSchema,
  naturalLanguageSearchInputSchema,
  naturalLanguageSearchOutputSchema,
  BilingualListingOutput,
  NaturalLanguageSearchOutput,
} from "../schemas/ai.schema";

export class AiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  async generateBilingualListing(
    input: unknown,
  ): Promise<BilingualListingOutput> {
    const parsedInput = generateContentInputSchema.parse(input);

    if (
      env.NODE_ENV === "development" &&
      env.GEMINI_API_KEY.startsWith("AIzaSyFakeKey")
    ) {
      return {
        titleEn: `Modern ${parsedInput.propertyType || "Property"} in ${parsedInput.location || "Addis Ababa"}`,
        titleAm: `ዘመናዊ ${parsedInput.propertyType || "ቤት"} በ${parsedInput.location || "አዲስ አበባ"}`,
        descriptionEn: `Spacious property featuring premium finishes and convenient access. Prompt: ${parsedInput.prompt}`,
        descriptionAm: `ምቹ እና ዘመናዊ መኖሪያ ቤት ከሙሉ የውሃ እና መብራት አገልግሎት ጋር። ማብራሪያ፡ ${parsedInput.prompt}`,
      };
    }

    const systemPrompt =
      "You are an expert real estate AI assistant for Ethiopia. Return ONLY valid JSON with keys: titleEn, titleAm, descriptionEn, descriptionAm.";
    const userPrompt = `Generate real estate listing titles and descriptions in English and Amharic based on this raw details: ${parsedInput.prompt}, Property Type: ${parsedInput.propertyType || "N/A"}, Location: ${parsedInput.location || "N/A"}, Price: ${parsedInput.price || "N/A"}`;

    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
      ],
    });

    const text = response.text || "";
    const cleanJson = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const rawData = JSON.parse(cleanJson);

    return bilingualListingOutputSchema.parse(rawData);
  }

  async parseNaturalLanguageSearch(
    input: unknown,
  ): Promise<NaturalLanguageSearchOutput> {
    const parsedInput = naturalLanguageSearchInputSchema.parse(input);

    if (
      env.NODE_ENV === "development" &&
      env.GEMINI_API_KEY.startsWith("AIzaSyFakeKey")
    ) {
      const lower = parsedInput.query.toLowerCase();
      return {
        transaction:
          lower.includes("rent") || lower.includes("kira") ? "RENT" : "SALE",
        propertyType: lower.includes("apartment") ? "APARTMENT" : "VILLA",
        bedrooms:
          lower.includes("2 bedroom") || lower.includes("2 bed") ? 2 : 3,
        location: lower.includes("bole") ? "Bole" : "Addis Ababa",
        maxPrice: lower.includes("40k") ? 40000 : 50000,
        currency: "ETB",
      };
    }

    const systemPrompt =
      'Extract structured real estate filter parameters from natural language search queries in English or Amharic (e.g., "bet le kira"). Return ONLY valid JSON with keys: transaction (SALE|RENT|BUY_REQUEST|RENT_REQUEST), propertyType, bedrooms, location, maxPrice, currency.';

    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemPrompt}\n\nQuery: ${parsedInput.query}` }],
        },
      ],
    });

    const text = response.text || "";
    const cleanJson = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const rawData = JSON.parse(cleanJson);

    return naturalLanguageSearchOutputSchema.parse(rawData);
  }
}

export const aiService = new AiService();
