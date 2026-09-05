import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";

export const metadata: Metadata = {
  title: "AkGebeya — Ethiopian Real Estate Marketplace",
  description:
    "Find verified properties for sale and rent across Ethiopia with Telegram integration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className="min-h-screen bg-neutral-50 text-neutral-900 antialiased flex flex-col"
        suppressHydrationWarning
      >
        <QueryProvider>
          <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-brand-700">
                  AkGebeya
                </span>
                <span className="text-xs bg-brand-100 text-brand-700 font-medium px-2 py-0.5 rounded-full">
                  አክገበያ
                </span>
              </div>
              <nav className="flex items-center space-x-6 text-sm font-medium text-neutral-600">
                <a href="/en/rent" className="hover:text-neutral-900">
                  Rent
                </a>
                <a href="/en/sale" className="hover:text-neutral-900">
                  Buy
                </a>
                <a href="/en/providers" className="hover:text-neutral-900">
                  Brokers & Agencies
                </a>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="bg-white border-t border-neutral-200 py-8">
            <div className="max-w-7xl mx-auto px-4 text-center text-xs text-neutral-500">
              © 2026 AkGebeya Real Estate Marketplace. All rights reserved.
            </div>
          </footer>
        </QueryProvider>
      </body>
    </html>
  );
}
