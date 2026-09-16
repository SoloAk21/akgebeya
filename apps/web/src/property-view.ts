export type PreviewLanguage = 'original' | 'en' | 'am';
type Copy = { title: string; description: string };
export interface PropertyPreview {
  listing: {
    id: string; title: string; description: string; transactionType: 'RENT' | 'SALE';
    propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL'; status: 'DRAFT' | 'COMPLETE';
    priceEtb: string | null; areaSqm: string | null; bedrooms: number | null; bathrooms: number | null;
    version: number; missingFields: string[];
    location: { countryId: string; regionId: string; cityId: string; subcityId: string;
      latitude: number; longitude: number; address: { formattedAddress: string } | null };
  };
  media: Array<{ id: string; url: string; width: number; height: number; byteSize: number; createdAt: string }>;
  mediaVersion: number;
  copy: { en: Copy; am: Copy; sourceVersion: number; model: string; generatedAt: string } | null;
  copyStale: boolean;
  provider: { displayName: string | null; providerType: string | null };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === 'string' && [...value].length <= max;
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const decimal = (value: unknown) => value === null || (typeof value === 'string' && /^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value) && Number(value) > 0);
const types = { APARTMENT: 'Apartment', HOUSE: 'House', LAND: 'Land', COMMERCIAL: 'Commercial property' };
const providerTypes: Record<string, string> = { OWNER: 'Owner', BROKER: 'Broker', AGENT: 'Agent', AGENCY: 'Agency', DEVELOPER: 'Developer' };
const subcities: Record<string, string> = { 'addis-ketema': 'Addis Ketema', 'akaki-kality': 'Akaki Kality', arada: 'Arada', bole: 'Bole', gulele: 'Gulele', kirkos: 'Kirkos',
  'kolfe-keranio': 'Kolfe Keranio', lideta: 'Lideta', 'nifas-silk-lafto': 'Nifas Silk Lafto', yeka: 'Yeka', 'lemi-kura': 'Lemi Kura' };

export function parsePropertyPreview(value: unknown, expectedId: string): PropertyPreview {
  const invalid = () => new Error('The saved preview was incomplete. Reload the preview to try again.');
  if (!object(value) || !object(value['listing']) || !object(value['provider'])) throw invalid();
  const listing = value['listing'], location = listing['location'];
  if (!uuid.test(expectedId) || listing['id'] !== expectedId || !text(listing['title'], 120) || !listing['title']
    || !text(listing['description'], 2000) || typeof listing['transactionType'] !== 'string' || !['RENT', 'SALE'].includes(listing['transactionType'])
    || typeof listing['propertyType'] !== 'string' || !Object.hasOwn(types, listing['propertyType'])
    || typeof listing['status'] !== 'string' || !['DRAFT', 'COMPLETE'].includes(listing['status'])
    || !decimal(listing['priceEtb']) || !decimal(listing['areaSqm'])
    || ![listing['bedrooms'], listing['bathrooms']].every(v => v === null || integer(v, 0, 100))
    || !integer(listing['version'], 1, 2147483647) || !Array.isArray(listing['missingFields'])
    || listing['missingFields'].some(v => !['description', 'priceEtb', 'areaSqm', 'bedrooms', 'bathrooms'].includes(v))
    || !object(location) || location['countryId'] !== 'ET' || location['regionId'] !== 'addis-ababa' || location['cityId'] !== 'addis-ababa-city'
    || typeof location['subcityId'] !== 'string' || !Object.hasOwn(subcities, location['subcityId'])
    || typeof location['latitude'] !== 'number' || !Number.isFinite(location['latitude']) || Math.abs(location['latitude']) > 90
    || typeof location['longitude'] !== 'number' || !Number.isFinite(location['longitude']) || Math.abs(location['longitude']) > 180
    || (location['address'] !== null && (!object(location['address']) || !text(location['address']['formattedAddress'], 600)))) throw invalid();
  const media = value['media'];
  if (!Array.isArray(media) || media.length > 10 || !integer(value['mediaVersion'], 1, 2147483647)
    || media.some(photo => !object(photo) || typeof photo['id'] !== 'string' || !uuid.test(photo['id'])
      || photo['url'] !== `/api/listings/${expectedId}/media/${photo['id']}`
      || !integer(photo['width'], 1, 1600) || !integer(photo['height'], 1, 1600) || !integer(photo['byteSize'], 1, 1048576)
      || typeof photo['createdAt'] !== 'string' || !Number.isFinite(Date.parse(photo['createdAt'])))
    || new Set(media.map(photo => photo.id)).size !== media.length) throw invalid();
  const copy = value['copy'];
  if (typeof value['copyStale'] !== 'boolean' || (copy === null && value['copyStale'])) throw invalid();
  if (copy !== null) {
    if (!object(copy) || !integer(copy['sourceVersion'], 1, 2147483647)
      || value['copyStale'] !== (copy['sourceVersion'] !== listing['version']) || !text(copy['model'], 100)
      || typeof copy['generatedAt'] !== 'string' || !Number.isFinite(Date.parse(copy['generatedAt']))) throw invalid();
    for (const lang of ['en', 'am']) {
      const section = copy[lang];
      if (!object(section) || !text(section['title'], 120) || !section['title'] || !text(section['description'], 2000) || !section['description']) throw invalid();
    }
  }
  const provider = value['provider'];
  if ((provider['displayName'] !== null && !text(provider['displayName'], 80))
    || (provider['providerType'] !== null && (typeof provider['providerType'] !== 'string' || !Object.hasOwn(providerTypes, provider['providerType'])))) throw invalid();
  return value as unknown as PropertyPreview;
}

export function previewText(data: PropertyPreview, language: PreviewLanguage): Copy {
  return language !== 'original' && data.copy && !data.copyStale && data.copy.sourceVersion === data.listing.version
    ? data.copy[language] : { title: data.listing.title, description: data.listing.description };
}
export function formatPropertyAmount(value: string | null): string {
  if (value === null) return 'Not provided';
  const [whole, decimals = '00'] = value.split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decimals === '00' ? '' : `.${decimals}`}`;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}

// One display renderer for this owner-only preview and the later public listing
// feature. It has no write, payment, authentication or AI-generation side effects.
export function renderPropertyView(container: HTMLElement, data: PropertyPreview, language: PreviewLanguage) {
  for (const image of container.querySelectorAll('img')) image.removeAttribute('src');
  container.replaceChildren();
  const listing = data.listing, copy = previewText(data, language);
  const article = element('article', undefined, 'property-view');
  const category = element('p', `${listing.transactionType === 'RENT' ? 'For rent' : 'For sale'} · ${types[listing.propertyType]}`, 'eyebrow');
  const title = element('h2', copy.title); title.lang = language !== 'original' && data.copy && !data.copyStale ? language : 'und';
  const place = element('p', `${subcities[listing.location.subcityId]}, Addis Ababa`, 'property-place');
  const price = element('p', listing.priceEtb === null ? 'Price not provided' : `${formatPropertyAmount(listing.priceEtb)} ETB${listing.transactionType === 'RENT' ? ' / month' : ''}`, 'property-price');
  article.append(category, title, place, price);
  const gallery = element('div', undefined, 'property-gallery');
  if (!data.media.length) gallery.append(element('p', 'No property photos have been added yet.', 'property-empty'));
  else {
    const cover = element('img', undefined, 'property-cover'); cover.decoding = 'async';
    const status = element('p', undefined, 'note'); status.setAttribute('role', 'status');
    const thumbs = element('div', undefined, 'property-thumbnails'); thumbs.setAttribute('role', 'group'); thumbs.setAttribute('aria-label', 'Property photos');
    let selected = 0;
    const buttons: HTMLButtonElement[] = [];
    function select(index: number) {
      selected = index; const photo = data.media[index]!;
      cover.alt = `Property photo ${index + 1}${index === 0 ? ', cover photo' : ''}`;
      cover.width = photo.width; cover.height = photo.height;
      status.textContent = `Loading photo ${index + 1} of ${data.media.length}…`;
      cover.src = photo.url;
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    }
    cover.addEventListener('load', () => { status.textContent = `Photo ${selected + 1} of ${data.media.length}${selected === 0 ? ' · Cover' : ''}`; });
    cover.addEventListener('error', () => { status.textContent = 'This photo could not load. Reload the preview to try again.'; });
    data.media.forEach((photo, index) => {
      const button = element('button'); button.type = 'button'; button.className = 'secondary';
      button.setAttribute('aria-label', `Show property photo ${index + 1}`);
      const thumbnail = element('img'); thumbnail.src = photo.url; thumbnail.alt = ''; thumbnail.loading = 'lazy'; thumbnail.width = 96; thumbnail.height = 64;
      button.append(thumbnail, element('span', String(index + 1))); button.addEventListener('click', () => select(index));
      buttons.push(button); thumbs.append(button);
    });
    gallery.append(cover, status, thumbs); select(0);
  }
  article.append(gallery);
  const facts = element('dl', undefined, 'property-facts');
  const rows: Array<[string, string]> = [['Property type', types[listing.propertyType]], ['Area', listing.areaSqm === null ? 'Not provided' : `${formatPropertyAmount(listing.areaSqm)} m²`]];
  if (['APARTMENT', 'HOUSE'].includes(listing.propertyType)) rows.push(['Bedrooms', listing.bedrooms === null ? 'Not provided' : listing.bedrooms === 0 ? 'Studio' : String(listing.bedrooms)]);
  if (listing.propertyType !== 'LAND') rows.push(['Bathrooms', listing.bathrooms === null ? 'Not provided' : String(listing.bathrooms)]);
  for (const [label, value] of rows) { const row = element('div'); row.append(element('dt', label), element('dd', value)); facts.append(row); }
  const description = element('p', copy.description || 'A property description has not been provided.', 'property-description'); description.lang = title.lang;
  const location = element('div', undefined, 'property-location');
  location.append(element('h3', 'Location'), element('p', listing.location.address?.formattedAddress || `${subcities[listing.location.subcityId]}, Addis Ababa`),
    element('p', `Saved pin: ${listing.location.latitude.toFixed(6)}, ${listing.location.longitude.toFixed(6)}`, 'note'));
  const provider = element('div', undefined, 'property-provider');
  provider.append(element('h3', 'Listed by'), element('p', data.provider.displayName || 'Property provider'));
  if (data.provider.providerType) provider.append(element('p', providerTypes[data.provider.providerType]!, 'note'));
  article.append(facts, element('h3', 'About this property'), description, location, provider);
  container.append(article);
}
