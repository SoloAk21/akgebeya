import { AuthError } from './auth-security.js';

export class ListingValidationError extends AuthError {
  constructor(status: number, code: string, message: string, public fieldErrors: Record<string, string>) { super(status, code, message); }
}
export interface ListingEditInput {
  version: number;
  title: string;
  transactionType: 'RENT' | 'SALE';
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL';
  description: string;
  priceEtb: string | null;
  areaSqm: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  complete: boolean;
}
type CompletionFields = Pick<ListingEditInput, 'description' | 'priceEtb' | 'areaSqm' | 'bedrooms' | 'bathrooms' | 'propertyType'>;
export function missingListingFields(input: CompletionFields): string[] {
  const missing: string[] = [];
  if ([...input.description].length < 20) missing.push('description');
  if (input.priceEtb === null) missing.push('priceEtb');
  if (input.areaSqm === null) missing.push('areaSqm');
  if (['APARTMENT', 'HOUSE'].includes(input.propertyType)) {
    if (input.bedrooms === null) missing.push('bedrooms');
    if (input.bathrooms === null || input.bathrooms < 1) missing.push('bathrooms');
  }
  return missing;
}
export function listingEditInput(value: unknown): ListingEditInput {
  const errors: Record<string, string> = {};
  const fail = () => { throw new ListingValidationError(400, 'INVALID_LISTING', 'Check the highlighted listing fields.', errors); };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { errors['form'] = 'Send listing details.'; return fail(); }
  const input = value as Record<string, unknown>;
  const keys = ['version', 'title', 'transactionType', 'propertyType', 'description', 'priceEtb', 'areaSqm', 'bedrooms', 'bathrooms', 'complete'];
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) errors['form'] = 'Send exactly the supported listing fields.';
  if (!Number.isSafeInteger(input['version']) || (input['version'] as number) < 1 || (input['version'] as number) >= 2147483647) errors['version'] = 'Reload the current listing version.';
  const title = typeof input['title'] === 'string' ? input['title'].trim().normalize('NFC') : '';
  if (typeof input['title'] !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input['title']) || [...title].length < 1 || [...title].length > 120) errors['title'] = 'Use 1–120 characters without control characters.';
  if (typeof input['transactionType'] !== 'string' || !['RENT', 'SALE'].includes(input['transactionType'])) errors['transactionType'] = 'Choose rent or sale.';
  if (typeof input['propertyType'] !== 'string' || !['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL'].includes(input['propertyType'])) errors['propertyType'] = 'Choose a property type.';
  const rawDescription = typeof input['description'] === 'string' ? input['description'].replace(/\r\n/g, '\n') : '';
  const description = rawDescription.trim().normalize('NFC');
  if (typeof input['description'] !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(rawDescription.replace(/[\n\t]/g, '')) || [...description].length > 2000) errors['description'] = 'Use up to 2,000 characters; only line breaks and tabs are allowed as control characters.';
  function decimal(key: 'priceEtb' | 'areaSqm', digits: number) {
    const value = input[key];
    if (value === null) return null;
    if (typeof value !== 'string' || !new RegExp(`^(?:0|[1-9][0-9]{0,${digits - 1}})(?:\\.[0-9]{1,2})?$`).test(value) || Number(value) <= 0) {
      errors[key] = `Use a positive decimal amount with up to ${digits} whole digits and two decimal places.`; return null;
    }
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  }
  const priceEtb = decimal('priceEtb', 12), areaSqm = decimal('areaSqm', 9);
  for (const key of ['bedrooms', 'bathrooms'] as const) {
    if (input[key] !== null && (!Number.isInteger(input[key]) || (input[key] as number) < 0 || (input[key] as number) > 100)) errors[key] = 'Use a whole number from 0 to 100 or leave blank.';
  }
  if (input['propertyType'] === 'LAND' && input['bathrooms'] !== null) errors['bathrooms'] = 'Land must leave bathrooms blank.';
  if (['LAND', 'COMMERCIAL'].includes(input['propertyType'] as string) && input['bedrooms'] !== null) errors['bedrooms'] = 'This property type must leave bedrooms blank.';
  if (typeof input['complete'] !== 'boolean') errors['complete'] = 'Choose draft or complete.';
  if (Object.keys(errors).length) return fail();
  const result = { ...input, title, description, priceEtb, areaSqm } as unknown as ListingEditInput;
  const missing = missingListingFields(result);
  if (result.complete && missing.length) throw new ListingValidationError(422, 'INCOMPLETE_LISTING', 'Complete the required details before marking this listing complete.',
    Object.fromEntries(missing.map(key => [key, key === 'description' ? 'Use at least 20 characters.' : key === 'bathrooms' ? 'Enter at least one bathroom.' : 'This field is required.'])));
  return result;
}
