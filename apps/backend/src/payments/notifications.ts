export type PaymentNotification = {titleEn:string;titleAm:string;bodyEn:string;bodyAm:string};
// Fixed bilingual copy; no gateway payload, account identity, or checkout credentials.
export function paymentNotification(status:'SUCCEEDED'|'FAILED'):PaymentNotification {
 return status==='SUCCEEDED'
  ? {titleEn:'Payment confirmed',titleAm:'ክፍያ ተረጋግጧል',bodyEn:'Your 500 ETB listing payment has been confirmed. Publication is a separate step.',bodyAm:'የማስታወቂያዎ 500 ብር ክፍያ ተረጋግጧል። ማስታወቂያውን ማተም የተለየ እርምጃ ነው።'}
  : {titleEn:'Payment unsuccessful',titleAm:'ክፍያው አልተሳካም',bodyEn:'The payment provider reported that your listing payment was unsuccessful. Your listing has not been published. No new payment attempt was created.',bodyAm:'የክፍያ አቅራቢው የማስታወቂያዎ ክፍያ እንዳልተሳካ አሳውቋል። ማስታወቂያዎ አልታተመም። አዲስ የክፍያ ሙከራ አልተፈጠረም።'};
}
