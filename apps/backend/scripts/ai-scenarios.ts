import type { CompletionScenario } from './completion-scenarios.js';
export const aiScenarios:CompletionScenario[]=[
  {
    "name": "Create test draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "RESIDENTIAL",
      "type": "SALE",
      "propertyType": "HOUSE",
      "titleEn": "House for sale in Addis Ababa",
      "descriptionEn": "House in Addis Ababa.",
      "price": "100.00",
      "bedrooms": 2,
      "bathrooms": 1,
      "areaSqm": "80.00",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "listingStatus": "DRAFT",
    "capture": {
      "id": "id",
      "revision": "etag",
      "initialRevision": "etag"
    }
  },
  {
    "name": "Unauthenticated",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 401,
    "error": "UNAUTHORIZED"
  },
  {
    "name": "admin denied",
    "actor": "admin",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 403,
    "match": "{{revision}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "spare denied",
    "actor": "spare",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 403,
    "match": "{{revision}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "rejected denied",
    "actor": "rejected",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 403,
    "match": "{{revision}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "suspended denied",
    "actor": "suspended",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 403,
    "match": "{{revision}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "roleless denied",
    "actor": "roleless",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 403,
    "match": "{{revision}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "Other provider denied",
    "actor": "other",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 404,
    "match": "{{revision}}",
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "DRAFT denied",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 409,
    "match": "{{revision}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Complete fixture",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/complete",
    "status": 200,
    "body": {},
    "match": "{{revision}}",
    "listingStatus": "COMPLETE",
    "capture": {
      "revision": "etag"
    }
  },
  {
    "name": "COMPLETE denied",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 409,
    "match": "{{revision}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Validate fixture",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/validate",
    "status": 200,
    "body": {},
    "match": "{{revision}}",
    "listingStatus": "VALIDATE",
    "capture": {
      "revision": "etag"
    }
  },
  {
    "name": "Missing If-Match",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 428,
    "error": "PRECONDITION_REQUIRED"
  },
  {
    "name": "Malformed If-Match",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 400,
    "match": "*",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Stale If-Match",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 412,
    "match": "{{initialRevision}}",
    "error": "PRECONDITION_FAILED"
  },
  {
    "name": "Reject supplied price",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 400,
    "match": "{{revision}}",
    "body": {
      "price": "1"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject supplied status",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 400,
    "match": "{{revision}}",
    "body": {
      "status": "AI_ASSIST"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject supplied providerId",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 400,
    "match": "{{revision}}",
    "body": {
      "providerId": "injected"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject supplied location",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 400,
    "match": "{{revision}}",
    "body": {
      "location": {
        "cityEn": "invented"
      }
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject direct lifecycle PATCH",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{id}}",
    "status": 400,
    "body": {
      "status": "AI_ASSIST"
    },
    "match": "{{revision}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Real Gemini assistance",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 200,
    "match": "{{revision}}",
    "listingStatus": "AI_ASSIST",
    "capture": {
      "revision": "etag"
    }
  },
  {
    "name": "Repeated assistance",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/ai-assist",
    "status": 409,
    "match": "{{revision}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Read assisted listing",
    "actor": "owner",
    "method": "GET",
    "path": "/{{id}}",
    "status": 200,
    "listingStatus": "AI_ASSIST"
  },
  {
    "name": "Other provider cannot read assisted listing",
    "actor": "other",
    "method": "GET",
    "path": "/{{id}}",
    "status": 404,
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "No publication action",
    "actor": "owner",
    "method": "POST",
    "path": "/{{id}}/publish",
    "status": 404,
    "match": "{{revision}}",
    "error": "NOT_FOUND"
  }
];
