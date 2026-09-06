import Link from "next/link";
import { MapPin, Bed, Bath, Maximize2, ShieldCheck } from "lucide-react";

export interface PropertyCardProps {
  id: string;
  lang: string;
  titleEn: string;
  titleAm: string;
  price: number;
  currency: string;
  category: string;
  transaction: string;
  subCity?: string;
  city: string;
  bedrooms?: number;
  bathrooms?: number;
  areaSqM?: number;
  imageUrl?: string;
  isVerified?: boolean;
}

export function PropertyCard(props: PropertyCardProps) {
  const isAmharic = props.lang === "am";
  const title = isAmharic ? props.titleAm : props.titleEn;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between">
      <div>
        <div className="relative aspect-[16/10] bg-neutral-100 overflow-hidden flex items-center justify-center text-neutral-400">
          {props.imageUrl ? (
            <img
              src={props.imageUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs font-semibold">AkGebeya Property</span>
          )}
          <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md text-neutral-900 text-xs font-bold px-2.5 py-1 rounded-lg border border-neutral-200 uppercase">
            {props.category}
          </div>
          {props.isVerified && (
            <div className="absolute top-3 right-3 bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 shadow">
              <ShieldCheck className="w-3 h-3" />
              <span>VERIFIED</span>
            </div>
          )}
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-extrabold text-neutral-900">
              {Number(props.price).toLocaleString()} {props.currency}
            </span>
            <span className="text-xs font-semibold text-neutral-500 uppercase">
              {props.transaction}
            </span>
          </div>

          <h3 className="font-semibold text-neutral-900 line-clamp-2 text-sm leading-snug">
            {title}
          </h3>

          <p className="flex items-center text-xs text-neutral-500">
            <MapPin className="w-3.5 h-3.5 mr-1 text-neutral-400 shrink-0" />
            <span className="truncate">
              {props.subCity ? `${props.subCity}, ` : ""}
              {props.city}, Ethiopia
            </span>
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-600">
        <div className="flex items-center space-x-3">
          {props.bedrooms !== undefined && (
            <span className="flex items-center space-x-1">
              <Bed className="w-3.5 h-3.5 text-neutral-400" />
              <span>{props.bedrooms}</span>
            </span>
          )}
          {props.bathrooms !== undefined && (
            <span className="flex items-center space-x-1">
              <Bath className="w-3.5 h-3.5 text-neutral-400" />
              <span>{props.bathrooms}</span>
            </span>
          )}
          {props.areaSqM !== undefined && (
            <span className="flex items-center space-x-1">
              <Maximize2 className="w-3.5 h-3.5 text-neutral-400" />
              <span>{props.areaSqM} m²</span>
            </span>
          )}
        </div>

        <Link
          href={`/${props.lang}/property/${props.id}`}
          className="text-brand-700 font-bold hover:underline"
        >
          {isAmharic ? "ዝርዝር ይመልከቱ" : "View Details →"}
        </Link>
      </div>
    </div>
  );
}
