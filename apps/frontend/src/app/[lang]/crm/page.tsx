import { Phone, MessageSquare, Clock, ArrowRight } from "lucide-react";

export default function CrmDashboardPage() {
  const mockLeads = [
    {
      id: "inq_1",
      buyerName: "Abebe Bikila",
      buyerPhone: "+251911223344",
      propertyTitle: "2 Bedroom Luxury Apartment around Bole",
      status: "NEW_INQUIRY",
      date: "10 mins ago",
    },
    {
      id: "inq_2",
      buyerName: "Haile Gebrselassie",
      buyerPhone: "+251911556677",
      propertyTitle: "Commercial Office Space in Kazanchis",
      status: "TOUR_SCHEDULED",
      date: "2 hours ago",
    },
    {
      id: "inq_3",
      buyerName: "Kenenisa Bekele",
      buyerPhone: "+251911889900",
      propertyTitle: "G+2 Villa in CMC",
      status: "NEGOTIATION",
      date: "Yesterday",
    },
  ];

  const columns = [
    {
      key: "NEW_INQUIRY",
      title: "New Inquiries",
      color: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      key: "TOUR_SCHEDULED",
      title: "Tour Scheduled",
      color: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      key: "NEGOTIATION",
      title: "Negotiation",
      color: "bg-purple-50 text-purple-700 border-purple-200",
    },
    {
      key: "DEAL_CLOSED",
      title: "Deal Closed",
      color: "bg-green-50 text-green-700 border-green-200",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            Broker CRM Pipeline
          </h1>
          <p className="text-neutral-500 text-xs mt-1">
            Manage inquiries, schedule property tours, and close deals
            seamlessly.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {columns.map((col) => {
          const leadsInCol = mockLeads.filter((l) => l.status === col.key);
          return (
            <div
              key={col.key}
              className="bg-neutral-100/70 p-4 rounded-2xl space-y-3 min-h-[400px]"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full border ${col.color}`}
                >
                  {col.title}
                </span>
                <span className="text-xs font-semibold text-neutral-500">
                  {leadsInCol.length}
                </span>
              </div>

              {leadsInCol.map((lead) => (
                <div
                  key={lead.id}
                  className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm space-y-3"
                >
                  <div>
                    <h4 className="font-semibold text-sm text-neutral-900">
                      {lead.buyerName}
                    </h4>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {lead.propertyTitle}
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 text-xs text-neutral-600">
                    <Phone className="w-3.5 h-3.5 text-brand-600" />
                    <span>{lead.buyerPhone}</span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-neutral-100 text-[10px] text-neutral-400">
                    <span className="flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {lead.date}
                    </span>
                    <button className="text-brand-600 font-semibold hover:underline flex items-center">
                      Move <ArrowRight className="w-3 h-3 ml-0.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
