import type { Metadata } from "next";
import { ProviderCard } from "@/components/provider-card";

interface Props {
  params: Promise<{
    lang: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const isAmharic = lang === "am";

  return {
    title: isAmharic
      ? "የተረጋገጡ የቤት ደላሎች እና ኤጀንሲዎች — አክገበያ"
      : "Verified Brokers & Real Estate Agencies — AkGebeya",
    description:
      "Directory of verified real estate brokers, agencies, owners, and developers in Ethiopia.",
  };
}

async function getProviders() {
  try {
    const res = await fetch(
      "http://localhost:5000/api/v1/providers/public/directory",
      {
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.data?.providers || [];
  } catch {
    return [
      {
        id: "prov_1",
        businessName: "Bole Prime Real Estate Agency",
        fullName: "Kasa Haile",
        type: "AGENCY",
        phone: "+251911223344",
        whatsapp: "+251911223344",
        publicProfileUrl: "bole-prime-agency",
        isVerified: true,
        bio: "Premier verified real estate agency specializing in luxury apartments and commercial offices around Bole and Kazanchis.",
      },
      {
        id: "prov_2",
        businessName: "Addis Property Brokers",
        fullName: "Abebe Bikila",
        type: "BROKER",
        phone: "+251911556677",
        whatsapp: "+251911556677",
        publicProfileUrl: "addis-property-brokers",
        isVerified: true,
        bio: "Licensed and verified professional broker offering residential sales and long-term rental management across CMC and Yeka.",
      },
    ];
  }
}

export default async function ProvidersPage({ params }: Props) {
  const { lang } = await params;
  const isAmharic = lang === "am";
  const providers = await getProviders();

  return (
    <div className="max-w-7xl mx-auto px-4 py-10 space-y-8">
      <div className="border-b border-neutral-200 pb-6">
        <h1 className="text-3xl font-bold text-neutral-900">
          {isAmharic
            ? "የተረጋገጡ ደላሎች እና ኤጀንሲዎች"
            : "Verified Brokers & Real Estate Agencies"}
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          {isAmharic
            ? "በአክገበያ የተረጋገጡ ባለሙያ የቤት ደላሎች እና ድርጅቶች ዝርዝር"
            : "Connect with verified real estate brokers, agents, agencies, and developers in Ethiopia."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {providers.map((prov: any) => (
          <ProviderCard
            key={prov.id}
            id={prov.id}
            lang={lang}
            businessName={prov.businessName}
            fullName={prov.fullName}
            type={prov.type}
            phone={prov.phone}
            whatsapp={prov.whatsapp}
            publicProfileUrl={prov.publicProfileUrl}
            isVerified={prov.isVerified}
            bio={prov.bio}
          />
        ))}
      </div>
    </div>
  );
}
