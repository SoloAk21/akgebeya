import type { ListingAiClient } from '../src/listings/ai.js';
import { completionFixture } from './completion-fixture.js';
export const aiOutput = {
  titleEn: 'House for sale in Addis Ababa',
  titleAm: '\u1260\u12a0\u12f2\u1235 \u12a0\u1260\u1263 \u12e8\u121a\u1238\u1325 \u1264\u1275',
  descriptionEn: 'House for sale in Addis Ababa for 100.00 ETB.',
  descriptionAm: '\u1260\u12a0\u12f2\u1235 \u12a0\u1260\u1263 \u1264\u1275 \u1260100.00 \u1265\u122d \u12ed\u1238\u1323\u120d\u1362',
};
export const fakeAi: ListingAiClient = { async generate() { return JSON.stringify(aiOutput); } };
export async function aiFixture(client: ListingAiClient = fakeAi) {
  const f = await completionFixture(client);
  f.row.status = 'VALIDATE';
  return f;
}
