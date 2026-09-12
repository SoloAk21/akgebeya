Chapa, webhook, idempotency


Step 4.10 persists a ListingFeeQuote before payment initiation. The approved V1
quote is 50000 ETB minor units (500 ETB), version v1, without expiry or automatic
repricing. Payment rows and Chapa integration remain a later task. That task must
bind payment to the exact immutable quote and compare listing, amount and
currency. See [Listing fee](LISTING_FEE.md).

Step 4.11 implements backend-only Chapa checkout initialization from the immutable
quote. Successful initialization leaves Payment PENDING and moves the private
listing to PAYMENT. It does not verify payment or publish. Rejected, unknown and
interrupted reservations block replacement attempts. See
[Chapa payment initiation](CHAPA_PAYMENT_INITIATION.md) for failure handling and
the required development/test verification gate.

Steps 4.12-4.13 add authoritative server-side verification/reconciliation and a separate paid publication action. See [Payment verification and publication](PAYMENT_VERIFICATION_PUBLICATION.md). Callback/return URLs never establish success.
