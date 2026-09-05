import { Search, Building2, Home, Landmark } from "lucide-react";

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-900">
          Find Your Next Property in Ethiopia
        </h1>
        <p className="text-lg text-neutral-600">
          Discover verified apartments, villas, commercial spaces, and land in
          Addis Ababa and beyond.
        </p>

        <div className="pt-6">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-neutral-200 flex items-center space-x-3">
            <Search className="w-5 h-5 text-neutral-400 ml-2" />
            <input
              type="text"
              placeholder="Search by area (e.g., Bole, Kazanchis, CMC) or keyword..."
              className="w-full bg-transparent text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none"
            />
            <button className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition">
              Search
            </button>
          </div>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-start space-x-4">
          <div className="p-3 bg-brand-50 rounded-xl text-brand-600">
            <Home className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900">Residential</h3>
            <p className="text-sm text-neutral-500 mt-1">
              Apartments, studios, villas, and condominiums for rent and sale.
            </p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-start space-x-4">
          <div className="p-3 bg-brand-50 rounded-xl text-brand-600">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900">Commercial</h3>
            <p className="text-sm text-neutral-500 mt-1">
              Office space, retail shops, warehouses, and commercial buildings.
            </p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-start space-x-4">
          <div className="p-3 bg-brand-50 rounded-xl text-brand-600">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-neutral-900">Land & Plots</h3>
            <p className="text-sm text-neutral-500 mt-1">
              Residential, commercial, industrial, and agricultural plots.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
