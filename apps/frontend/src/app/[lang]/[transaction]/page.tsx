import type { Metadata } from "next";
import { PropertyCard } from "@/components/property-card";
import { Search, Filter } from "lucide-react";

interface Props {
  params: Promise<{
    lang: string;
    transaction: string;
  }>;
  searchParams: Promise<{
    subCity?: string;
    category?: string;
    propertyType?: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, transaction } = await params;
  const isAmharic = lang === "am";
  const isRent = transaction === "rent" || transaction === "kira";

  const title = isAmharic
    ? isRent
      ? "የሚከራዩ ቤቶች ዝርዝር — አክገበያ"
      : "የሚሸጡ ቤቶች ዝርዝር — አክገበያ"
    : isRent
      ? "Properties for Rent in Ethiopia — AkGebeya"
      : "Properties for Sale in Ethiopia — AkGebeya";

  return {
    title,
    description:
      "Explore verified residential, commercial, and land property listings across Ethiopia.",
  };
}

async function getListings(
  transaction: string,
  category?: string,
  subCity?: string,
) {
  const txType =
    transaction === "rent" || transaction === "kira" ? "RENT" : "SALE";
  const query = new URLSearchParams({ transaction: txType });
  if (category) query.append("category", category);
  if (subCity) query.append("subCity", subCity);

  try {
    const res = await fetch(
      `http://localhost:5000/api/v1/listings/search?${query.toString()}`,
      {
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.data?.listings || [];
  } catch {
    return [
      {
        id: "sample_1",
        titleEn: "Modern 2 Bedroom Apartment around Bole Atlas",
        titleAm: "በቦሌ አትላስ አካባቢ የሚገኝ ዘመናዊ ባለ 2 ክፍል አፓርታማ",
        price: 35000,
        currency: "ETB",
        category: "RESIDENTIAL",
        transaction: txType,
        location: { city: "Addis Ababa", subCity: "Bole" },
        bedrooms: 2,
        bathrooms: 2,
        areaSqM: 110,
      },
      {
        id: "sample_2",
        titleEn: "Spacious Commercial Office Space in Kazanchis",
        titleAm: "በካዛንቺስ የሚገኝ ሰፊ የንግድ ቢሮ",
        price: 85000,
        currency: "ETB",
        category: "COMMERCIAL",
        transaction: txType,
        location: { city: "Addis Ababa", subCity: "Kazanchis" },
        areaSqM: 180,
      },
    ];
  }
}

export default async function ListingsPage({ params, searchParams }: Props) {
  const { lang, transaction } = await params;
  const { category, subCity } = await searchParams;
  const isAmharic = lang === "am";
  const isRent = transaction === "rent" || transaction === "kira";

  const listings = await getListings(transaction, category, subCity);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      <div className="border-b border-neutral-200 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight">
            {isAmharic
              ? isRent
                ? "የሚከራዩ ቤቶች"
                : "የሚሸጡ ቤቶች"
              : isRent
                ? "Properties for Rent"
                : "Properties for Sale"}
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            {isAmharic
              ? "በአዲስ አበባ እና በኢትዮጵያ ከተሞች የተረጋገጡ ንብረቶች"
              : "Verified property listings in Addis Ababa and major Ethiopian cities."}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <a
            href={`/${lang}/${isRent ? "sale" : "rent"}`}
            className="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-4 py-2 rounded-xl transition"
          >
            {isAmharic
              ? isRent
                ? "ወደ የሚሸጡ ቤቶች ቀይር"
                : "ወደ የሚከራዩ ቤቶች ቀይር"
              : isRent
                ? "Switch to For Sale"
                : "Switch to For Rent"}
          </a>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-xs">
          <Search className="w-4 h-4 text-neutral-400 mr-2" />
          <input
            type="text"
            placeholder={
              isAmharic
                ? "በአካባቢ ይፈልጉ (ምሳሌ፡ ቦሌ፣ ካዛንቺስ)..."
                : "Filter by location (e.g. Bole, Kazanchis)..."
            }
            className="bg-transparent w-full text-neutral-900 focus:outline-none"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <Filter className="w-4 h-4 text-neutral-400" />
          <a
            href={`/${lang}/${transaction}`}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 font-medium"
          >
            All
          </a>
          <a
            href={`/${lang}/${transaction}?category=RESIDENTIAL`}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 font-medium"
          >
            Residential
          </a>
          <a
            href={`/${lang}/${transaction}?category=COMMERCIAL`}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 font-medium"
          >
            Commercial
          </a>
          <a
            href={`/${lang}/${transaction}?category=LAND`}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 font-medium"
          >
            Land
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {listings.map((item: any) => (
          <PropertyCard
            key={item.id}
            id={item.id}
            lang={lang}
            titleEn={item.titleEn}
            titleAm={item.titleAm}
            price={Number(item.price)}
            currency={item.currency || "ETB"}
            category={item.category}
            transaction={item.transaction}
            subCity={item.location?.subCity}
            city={item.location?.city || "Addis Ababa"}
            bedrooms={item.bedrooms}
            bathrooms={item.bathrooms}
            areaSqM={item.areaSqM}
            isVerified={true}
          />
        ))}
      </div>
    </div>
  );
}
