"use client";

import { Share2, Send, Copy, Check } from "lucide-react";
import { useState } from "react";

interface ShareCardProps {
  title: string;
  url: string;
}

export function ShareCard({ title, url }: ShareCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;

  return (
    <div className="bg-white p-6 border border-neutral-200 rounded-2xl shadow-sm space-y-4">
      <div className="flex items-center space-x-2 text-sm font-semibold text-neutral-900">
        <Share2 className="w-4 h-4 text-brand-600" />
        <span>Share Listing</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={telegramShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-2 bg-[#229ED9] hover:bg-[#1d8bc0] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition"
        >
          <Send className="w-4 h-4" />
          <span>Share to Telegram</span>
        </a>

        <button
          onClick={handleCopy}
          className="flex items-center space-x-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold px-4 py-2.5 rounded-xl transition"
        >
          {copied ? (
            <Check className="w-4 h-4 text-brand-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          <span>{copied ? "Link Copied!" : "Copy Share Link"}</span>
        </button>
      </div>
    </div>
  );
}
