import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareCard } from "@/components/share-card";
import { MapPin, Bed, Bath, Maximize2, ShieldCheck } from "lucide-react";

interface Props {
  params: Promise<{
    lang: string;
    id: string;
  }>;
}

async function getPropertyData(id: string) {
  try {
    const res = await fetch(`http://localhost:5000/api/v1/listings/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.listing;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, id } = await params;
  const isAmharic = lang === "am";
  const property = await getPropertyData(id);

  if (!property) {
    return {
      title: isAmharic
        ? "ቤት አልተገኘም — AkGebeya"
        : "Property Not Found — AkGebeya",
    };
  }

  const title = isAmharic ? property.titleAm : property.titleEn;
  const description = isAmharic
    ? property.descriptionAm
    : property.descriptionEn;
  const canonicalUrl = `https://akgebeya.com/${lang}/property/${id}`;

  return {
    title: `${title} | AkGebeya Real Estate`,
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        en: `https://akgebeya.com/en/property/${id}`,
        am: `https://akgebeya.com/am/property/${id}`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "AkGebeya Marketplace",
      locale: isAmharic ? "am_ET" : "en_US",
      type: "article",
      images: [
        {
          url:
            property.media?.[0]?.url || "https://akgebeya.com/og-default.jpg",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        property.media?.[0]?.url || "https://akgebeya.com/og-default.jpg",
      ],
    },
  };
}

export default async function PropertyDetailPage({ params }: Props) {
  const { lang, id } = await params;
  const isAmharic = lang === "am";
  const property = await getPropertyData(id);

  if (!property) {
    notFound();
  }

  const title = isAmharic ? property.titleAm : property.titleEn;
  const description = isAmharic
    ? property.descriptionAm
    : property.descriptionEn;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: title,
    description: description,
    url: `https://akgebeya.com/${lang}/property/${id}`,
    price: property.price,
    priceCurrency: property.currency || "ETB",
    address: {
      "@type": "PostalAddress",
      addressLocality: property.location?.city || "Addis Ababa",
      addressRegion: property.location?.subCity || "Bole",
      addressCountry: "ET",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-xs font-semibold text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full w-fit">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {property.provider?.isVerified
                  ? "VERIFIED PROVIDER"
                  : "REGISTERED LISTING"}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold mt-2 text-neutral-900">
              {title}
            </h1>
            <p className="flex items-center text-sm text-neutral-500 mt-1">
              <MapPin className="w-4 h-4 mr-1 text-neutral-400" />
              {property.location?.subCity
                ? `${property.location.subCity}, `
                : ""}
              {property.location?.city}, Ethiopia
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-extrabold text-neutral-900">
              {Number(property.price).toLocaleString()} {property.currency}
            </span>
            <p className="text-xs text-neutral-500">{property.transaction}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-white border border-neutral-200 rounded-2xl shadow-sm text-sm">
          <div className="flex items-center space-x-2">
            <Bed className="w-5 h-5 text-neutral-400" />
            <span>{property.bedrooms ?? "-"} Bedrooms</span>
          </div>
          <div className="flex items-center space-x-2">
            <Bath className="w-5 h-5 text-neutral-400" />
            <span>{property.bathrooms ?? "-"} Bathrooms</span>
          </div>
          <div className="flex items-center space-x-2">
            <Maximize2 className="w-5 h-5 text-neutral-400" />
            <span>{property.areaSqM ? `${property.areaSqM} m²` : "-"}</span>
          </div>
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-neutral-400" />
            <span>{property.category}</span>
          </div>
        </div>

        <div className="bg-white p-6 border border-neutral-200 rounded-2xl shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {isAmharic ? "መግለጫ" : "Description"}
          </h2>
          <p className="text-neutral-700 leading-relaxed whitespace-pre-line">
            {description}
          </p>
        </div>

        <ShareCard
          title={title}
          url={`https://akgebeya.com/${lang}/property/${id}`}
        />
      </div>
    </>
  );
}
