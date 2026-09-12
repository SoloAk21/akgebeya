users, properties, localization, UX, features

## Approved listing taxonomy

Property category and property type are separate classifications.

| Category | Property types |
| --- | --- |
| RESIDENTIAL | STUDIO, APARTMENT, CONDOMINIUM, VILLA, HOUSE, G_PLUS_1, G_PLUS_2 |
| COMMERCIAL | OFFICE, SHOP, WAREHOUSE, BUILDING, HOTEL |
| LAND | INDUSTRIAL_LAND, AGRICULTURAL_LAND, RESIDENTIAL_LAND, COMMERCIAL_LAND |

Transaction purposes: SALE, RENT, BUY_REQUEST, RENT_REQUEST.
G_PLUS_1 and G_PLUS_2 are database/API identifiers; UI labels may be G+1 and G+2.
LAND, COMMERCIAL and OTHER are not property types.

Initial drafts may be empty or have only a category or purpose. English and
Amharic fields are separate and optional in DRAFT. No placeholder property data
is created. See [Listing draft foundation](LISTING_DRAFTS.md).

## Approved V1 listing fee (Step 4.10)

The AkGebeya listing publication fee is a flat 500 ETB (50000 integer minor units),
pricingVersion v1, for every provider role, listing purpose, category and supported
property type. No discounts, credits, coupons, promotions, taxes, VAT or tiers apply
in this step. Quotes do not expire or automatically reprice. Fee calculation does
not initiate payment or publish a listing. See [Listing fee](LISTING_FEE.md).
