export type ListingScenario={name:string;actor?:'owner'|'other'|'admin'|'spare'|'rejected'|'suspended'|'roleless';method:string;path:string;status:number;body?:unknown;error?:string;capture?:Record<string,string>;match?:string;count?:number};
export const listingScenarios:ListingScenario[]=[
  {
    "name": "Unauthenticated",
    "method": "POST",
    "path": "",
    "status": 401,
    "body": {},
    "error": "UNAUTHORIZED"
  },
  {
    "name": "No provider",
    "actor": "admin",
    "method": "POST",
    "path": "",
    "status": 403,
    "body": {},
    "error": "FORBIDDEN"
  },
  {
    "name": "Unverified provider",
    "actor": "spare",
    "method": "POST",
    "path": "",
    "status": 403,
    "body": {},
    "error": "FORBIDDEN"
  },
  {
    "name": "Rejected provider",
    "actor": "rejected",
    "method": "POST",
    "path": "",
    "status": 403,
    "body": {},
    "error": "FORBIDDEN"
  },
  {
    "name": "Suspended provider",
    "actor": "suspended",
    "method": "POST",
    "path": "",
    "status": 403,
    "body": {},
    "error": "FORBIDDEN"
  },
  {
    "name": "Roleless provider",
    "actor": "roleless",
    "method": "POST",
    "path": "",
    "status": 403,
    "body": {},
    "error": "FORBIDDEN"
  },
  {
    "name": "Empty draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {},
    "capture": {
      "draftId": "id",
      "etag": "etag",
      "initialEtag": "etag"
    }
  },
  {
    "name": "Category-only draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "LAND"
    }
  },
  {
    "name": "Purpose-only draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "type": "RENT_REQUEST"
    }
  },
  {
    "name": "Compatible property type",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "COMMERCIAL",
      "propertyType": "OFFICE",
      "type": "RENT"
    }
  },
  {
    "name": "Incompatible property type",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": {
      "category": "LAND",
      "propertyType": "HOUSE"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Invalid category",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": {
      "category": "INVALID"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Removed property type",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": {
      "propertyType": "LAND"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Invalid purpose",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": {
      "type": "INVALID"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Invalid body",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": [],
    "error": "BAD_REQUEST"
  },
  {
    "name": "Publication escalation",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": {
      "status": "PUBLISHED"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Completion escalation",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 400,
    "body": {
      "status": "COMPLETE"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Own draft",
    "actor": "owner",
    "method": "GET",
    "path": "/{{draftId}}",
    "status": 200
  },
  {
    "name": "Own drafts",
    "actor": "owner",
    "method": "GET",
    "path": "/mine",
    "status": 200,
    "count": 4
  },
  {
    "name": "Other provider read",
    "actor": "other",
    "method": "GET",
    "path": "/{{draftId}}",
    "status": 404,
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "Other provider update",
    "actor": "other",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 404,
    "body": {
      "titleEn": "Unauthorized"
    },
    "error": "LISTING_NOT_FOUND",
    "match": "{{etag}}"
  },
  {
    "name": "Other provider delete",
    "actor": "other",
    "method": "DELETE",
    "path": "/{{draftId}}",
    "status": 404,
    "error": "LISTING_NOT_FOUND",
    "match": "{{etag}}"
  },
  {
    "name": "Missing precondition",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 428,
    "body": {
      "titleEn": "Missing precondition"
    },
    "error": "PRECONDITION_REQUIRED"
  },
  {
    "name": "Update own draft",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 200,
    "body": {
      "titleEn": "Draft home",
      "titleAm": "ቤት",
      "descriptionAm": "መግለጫ",
      "category": "RESIDENTIAL",
      "propertyType": "APARTMENT",
      "price": "1234.50",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "capture": {
      "etag": "etag"
    },
    "match": "{{etag}}"
  },
  {
    "name": "Stale edit",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 412,
    "body": {
      "titleEn": "Stale value"
    },
    "error": "PRECONDITION_FAILED",
    "match": "{{initialEtag}}"
  },
  {
    "name": "Incompatible merged update",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 400,
    "body": {
      "category": "LAND"
    },
    "error": "BAD_REQUEST",
    "match": "{{etag}}"
  },
  {
    "name": "Unverified mutation",
    "actor": "spare",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 403,
    "body": {
      "titleEn": "Denied"
    },
    "error": "FORBIDDEN",
    "match": "{{etag}}"
  },
  {
    "name": "Rejected mutation",
    "actor": "rejected",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 403,
    "body": {
      "titleEn": "Denied"
    },
    "error": "FORBIDDEN",
    "match": "{{etag}}"
  },
  {
    "name": "Suspended mutation",
    "actor": "suspended",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 403,
    "body": {
      "titleEn": "Denied"
    },
    "error": "FORBIDDEN",
    "match": "{{etag}}"
  },
  {
    "name": "Non-DRAFT mutation",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{nonDraftId}}",
    "status": 409,
    "body": {
      "titleEn": "Denied"
    },
    "error": "LISTING_CONFLICT",
    "match": "{{etag}}"
  },
  {
    "name": "Soft-delete draft",
    "actor": "owner",
    "method": "DELETE",
    "path": "/{{draftId}}",
    "status": 200,
    "match": "{{etag}}"
  },
  {
    "name": "Deleted draft read",
    "actor": "owner",
    "method": "GET",
    "path": "/{{draftId}}",
    "status": 404,
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "Deleted draft update",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{draftId}}",
    "status": 404,
    "body": {
      "titleEn": "Denied"
    },
    "error": "LISTING_NOT_FOUND",
    "match": "{{etag}}"
  },
  {
    "name": "Own drafts after deletion",
    "actor": "owner",
    "method": "GET",
    "path": "/mine",
    "status": 200,
    "count": 3
  }
];
