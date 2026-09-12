export type WebhookScenario={name:string;body?:unknown;raw?:string;auth?:'none'|'invalid'|'static'|'owner';status:number;error?:string;method?:string;path?:string;listingStatus?:string};
export const webhookScenarios:WebhookScenario[]=[
  {
    "name": "Missing signature",
    "body": {
      "event": "charge.success",
      "tx_ref": "{{referenceToken}}"
    },
    "auth": "none",
    "status": 401,
    "error": "WEBHOOK_UNAUTHORIZED"
  },
  {
    "name": "Invalid signature",
    "body": {
      "event": "charge.success",
      "tx_ref": "{{referenceToken}}"
    },
    "auth": "invalid",
    "status": 401,
    "error": "WEBHOOK_UNAUTHORIZED"
  },
  {
    "name": "Malformed JSON",
    "raw": "{",
    "auth": "none",
    "status": 400,
    "error": "INVALID_JSON"
  },
  {
    "name": "Missing event",
    "body": {
      "tx_ref": "{{referenceToken}}"
    },
    "status": 400,
    "error": "BAD_REQUEST"
  },
  {
    "name": "Missing reference",
    "body": {
      "event": "charge.success"
    },
    "status": 400,
    "error": "BAD_REQUEST"
  },
  {
    "name": "Unknown reference",
    "body": {
      "event": "charge.success",
      "tx_ref": "unknown-local-reference"
    },
    "status": 200
  },
  {
    "name": "Unsupported refund event ignored",
    "body": {
      "event": "charge.refunded"
    },
    "status": 200
  },
  {
    "name": "Pending authoritative state",
    "status": 200
  },
  {
    "name": "Failed authoritative state",
    "status": 200
  },
  {
    "name": "Duplicate failure",
    "status": 200
  },
  {
    "name": "Authoritative amount mismatch",
    "status": 502,
    "error": "PAYMENT_VERIFICATION_MISMATCH"
  },
  {
    "name": "Network ambiguity",
    "status": 502,
    "error": "PAYMENT_VERIFICATION_UNAVAILABLE"
  },
  {
    "name": "Authoritative success despite tampered payload facts",
    "body": {
      "event": "charge.failed",
      "tx_ref": "{{referenceToken}}",
      "status": "failed",
      "amount": "1",
      "currency": "USD",
      "userId": "untrusted"
    },
    "status": 200
  },
  {
    "name": "Duplicate success",
    "status": 200
  },
  {
    "name": "Out of order failure",
    "body": {
      "event": "charge.failed",
      "tx_ref": "{{referenceToken}}"
    },
    "status": 200
  },
  {
    "name": "Replay success",
    "auth": "static",
    "status": 200
  },
  {
    "name": "Manual verification converges",
    "method": "POST",
    "path": "/listings/{{id}}/payment/verify",
    "auth": "owner",
    "status": 200,
    "listingStatus": "VERIFY_PAYMENT"
  }
];
