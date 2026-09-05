import type { Metadata } from "next";
import Link from "next/link";

interface Props {
  params: Promise<{
    lang: string;
    location: string;
    propertyType: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, location, propertyType } = await params;
  const capitalizedLoc = location.charAt(0).toUpperCase() + location.slice(1);
  const capitalizedType =
    propertyType.charAt(0).toUpperCase() + propertyType.slice(1);

  const title =
    lang === "am"
      ? `${capitalizedLoc} ውስጥ የሚከራዩ ${capitalizedType} ቤቶች — አክገበያ`
      : `${capitalizedType} for Rent in ${capitalizedLoc} — AkGebeya`;

  return {
    title,
    description: `Browse verified ${capitalizedType.toLowerCase()} listings for rent in ${capitalizedLoc}, Addis Ababa on AkGebeya marketplace.`,
    alternates: {
      canonical: `https://akgebeya.com/${lang}/rent/${location}/${propertyType}`,
    },
  };
}

export default async function RentalSearchPage({ params }: Props) {
  const { lang, location, propertyType } = await params;
  const isAmharic = lang === "am";

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 space-y-6">
      <div className="border-b border-neutral-200 pb-6">
        <h1 className="text-3xl font-bold text-neutral-900 capitalize">
          {isAmharic
            ? `${location} ውስጥ የሚከራዩ ${propertyType} ቤቶች`
            : `${propertyType} for Rent in ${location}`}
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          {isAmharic
            ? "በአክገበያ የተረጋገጡ የመኖሪያ እና የንግድ ቤቶች ዝርዝር"
            : "Verified rental listings available across top neighborhoods"}
        </p>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-4">
        <p className="text-neutral-600">
          {isAmharic
            ? "በዚህ አካባቢ የሚፈለጉ ቤቶች ፍለጋ ውጤቶች"
            : `Showing property listings for ${propertyType} in ${location}.`}
        </p>
        <Link
          href="/"
          className="inline-block bg-brand-600 text-white font-semibold text-sm px-6 py-2.5 rounded-xl hover:bg-brand-700 transition"
        >
          {isAmharic ? "ወደ ዋናው ገጽ ተመለስ" : "Return to Home"}
        </Link>
      </div>
    </div>
  );
}
