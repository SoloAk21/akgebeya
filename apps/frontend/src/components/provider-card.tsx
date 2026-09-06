import { ShieldCheck, Phone, MessageSquare, ExternalLink } from "lucide-react";

export interface ProviderCardProps {
  id: string;
  lang: string;
  businessName?: string;
  fullName?: string;
  type: string;
  phone: string;
  whatsapp?: string;
  publicProfileUrl?: string;
  isVerified: boolean;
  bio?: string;
}

export function ProviderCard(props: ProviderCardProps) {
  const isAmharic = props.lang === "am";
  const displayName =
    props.businessName || props.fullName || "Real Estate Provider";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-bold tracking-wider text-brand-700 uppercase bg-brand-50 px-2 py-0.5 rounded-md border border-brand-100">
              {props.type}
            </span>
            <h3 className="font-bold text-lg text-neutral-900 mt-2">
              {displayName}
            </h3>
          </div>
          {props.isVerified && (
            <div className="flex items-center space-x-1 bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
              <ShieldCheck className="w-3 h-3" />
              <span>VERIFIED</span>
            </div>
          )}
        </div>

        {props.bio && (
          <p className="text-xs text-neutral-600 line-clamp-2 leading-relaxed">
            {props.bio}
          </p>
        )}
      </div>

      <div className="pt-4 border-t border-neutral-100 flex items-center justify-between gap-2">
        <a
          href={`tel:${props.phone}`}
          className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 text-xs font-semibold py-2 px-3 rounded-xl flex items-center justify-center space-x-1.5 transition"
        >
          <Phone className="w-3.5 h-3.5 text-brand-600" />
          <span>Call</span>
        </a>

        {props.whatsapp && (
          <a
            href={`https://wa.me/${props.whatsapp.replace(/[^0-9]/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] text-xs font-semibold py-2 px-3 rounded-xl flex items-center justify-center space-x-1.5 transition"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </a>
        )}

        {props.publicProfileUrl && (
          <a
            href={`/${props.lang}/providers/public/${props.publicProfileUrl}`}
            className="p-2 text-neutral-400 hover:text-neutral-900 transition"
            title="Public Profile"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}
