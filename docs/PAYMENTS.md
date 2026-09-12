Chapa, webhook, idempotency


Step 4.10 persists a ListingFeeQuote before payment initiation. The approved V1
quote is 50000 ETB minor units (500 ETB), version v1, without expiry or automatic
repricing. Payment rows and Chapa integration remain a later task. That task must
bind payment to the exact immutable quote and compare listing, amount and
currency. See [Listing fee](LISTING_FEE.md).
