export type CompletionScenario={name:string;actor?:'owner'|'other'|'admin'|'spare'|'rejected'|'suspended'|'roleless';method:string;path:string;status:number;body?:unknown;error?:string;fields?:string[];match?:string;listingStatus?:string;capture?:Record<string,string>};
export const completionScenarios:CompletionScenario[]=[
  {
    "name": "Create empty draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {},
    "listingStatus": "DRAFT",
    "capture": {
      "emptyId": "id",
      "emptyEtag": "etag"
    }
  },
  {
    "name": "Create res draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "RESIDENTIAL",
      "type": "SALE",
      "propertyType": "HOUSE",
      "titleEn": "Completion fixture",
      "descriptionEn": "Private completion verification fixture",
      "price": "100.00",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "listingStatus": "DRAFT",
    "capture": {
      "resId": "id",
      "resEtag": "etag",
      "resInitialEtag": "etag"
    }
  },
  {
    "name": "Create partial draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "RESIDENTIAL",
      "type": "SALE",
      "propertyType": "HOUSE",
      "titleEn": "Completion fixture",
      "price": "100.00",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "listingStatus": "DRAFT",
    "capture": {
      "partialId": "id",
      "partialEtag": "etag"
    }
  },
  {
    "name": "Create commercial draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "COMMERCIAL",
      "type": "SALE",
      "propertyType": "OFFICE",
      "titleEn": "Completion fixture",
      "descriptionEn": "Private completion verification fixture",
      "price": "100.00",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "listingStatus": "DRAFT",
    "capture": {
      "commercialId": "id",
      "commercialEtag": "etag"
    }
  },
  {
    "name": "Create land draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "LAND",
      "type": "SALE",
      "propertyType": "RESIDENTIAL_LAND",
      "titleEn": "Completion fixture",
      "descriptionEn": "Private completion verification fixture",
      "price": "100.00",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "listingStatus": "DRAFT",
    "capture": {
      "landId": "id",
      "landEtag": "etag"
    }
  },
  {
    "name": "Create deleted draft",
    "actor": "owner",
    "method": "POST",
    "path": "",
    "status": 201,
    "body": {
      "category": "RESIDENTIAL",
      "type": "SALE",
      "propertyType": "HOUSE",
      "titleEn": "Completion fixture",
      "descriptionEn": "Private completion verification fixture",
      "price": "100.00",
      "location": {
        "regionEn": "Addis Ababa",
        "cityEn": "Addis Ababa"
      }
    },
    "listingStatus": "DRAFT",
    "capture": {
      "deletedId": "id",
      "deletedEtag": "etag"
    }
  },
  {
    "name": "Delete fixture draft",
    "actor": "owner",
    "method": "DELETE",
    "path": "/{{deletedId}}",
    "status": 200,
    "match": "{{deletedEtag}}"
  },
  {
    "name": "Unauthenticated completion",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 401,
    "body": {},
    "error": "UNAUTHORIZED"
  },
  {
    "name": "admin completion denied",
    "actor": "admin",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 403,
    "body": {},
    "match": "{{resEtag}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "spare completion denied",
    "actor": "spare",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 403,
    "body": {},
    "match": "{{resEtag}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "rejected completion denied",
    "actor": "rejected",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 403,
    "body": {},
    "match": "{{resEtag}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "suspended completion denied",
    "actor": "suspended",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 403,
    "body": {},
    "match": "{{resEtag}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "roleless completion denied",
    "actor": "roleless",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 403,
    "body": {},
    "match": "{{resEtag}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "Other provider completion",
    "actor": "other",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 404,
    "body": {},
    "match": "{{resEtag}}",
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "Deleted completion",
    "actor": "owner",
    "method": "POST",
    "path": "/{{deletedId}}/complete",
    "status": 404,
    "body": {},
    "match": "{{deletedEtag}}",
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "Empty completion",
    "actor": "owner",
    "method": "POST",
    "path": "/{{emptyId}}/complete",
    "status": 422,
    "body": {},
    "match": "{{emptyEtag}}",
    "error": "LISTING_INCOMPLETE",
    "fields": [
      "category",
      "type",
      "propertyType",
      "titleEn",
      "descriptionEn",
      "price",
      "locationId"
    ]
  },
  {
    "name": "Missing English description",
    "actor": "owner",
    "method": "POST",
    "path": "/{{partialId}}/complete",
    "status": 422,
    "body": {},
    "match": "{{partialEtag}}",
    "error": "LISTING_INCOMPLETE",
    "fields": [
      "descriptionEn"
    ]
  },
  {
    "name": "Missing precondition",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 428,
    "body": {},
    "error": "PRECONDITION_REQUIRED"
  },
  {
    "name": "Malformed precondition",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 400,
    "body": {},
    "match": "*",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject client transition body",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 400,
    "body": {
      "status": "COMPLETE"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Skip complete denied",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/validate",
    "status": 409,
    "body": {},
    "match": "{{resEtag}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Residential complete",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 200,
    "body": {},
    "match": "{{resEtag}}",
    "listingStatus": "COMPLETE",
    "capture": {
      "resEtag": "etag"
    }
  },
  {
    "name": "Stale validation ETag",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/validate",
    "status": 412,
    "body": {},
    "match": "{{resInitialEtag}}",
    "error": "PRECONDITION_FAILED"
  },
  {
    "name": "Repeated complete",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 409,
    "body": {},
    "match": "{{resEtag}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Complete to draft denied",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{resId}}",
    "status": 400,
    "body": {
      "status": "DRAFT"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Suspended validation denied",
    "actor": "suspended",
    "method": "POST",
    "path": "/{{resId}}/validate",
    "status": 403,
    "body": {},
    "match": "{{resEtag}}",
    "error": "FORBIDDEN"
  },
  {
    "name": "Other provider validation denied",
    "actor": "other",
    "method": "POST",
    "path": "/{{resId}}/validate",
    "status": 404,
    "body": {},
    "match": "{{resEtag}}",
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "Residential validate",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/validate",
    "status": 200,
    "body": {},
    "match": "{{resEtag}}",
    "listingStatus": "VALIDATE",
    "capture": {
      "resEtag": "etag"
    }
  },
  {
    "name": "Repeated validate",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/validate",
    "status": 409,
    "body": {},
    "match": "{{resEtag}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Reverse validate to complete",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/complete",
    "status": 409,
    "body": {},
    "match": "{{resEtag}}",
    "error": "LISTING_TRANSITION_CONFLICT"
  },
  {
    "name": "Reject PATCH DRAFT",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{resId}}",
    "status": 400,
    "body": {
      "status": "DRAFT"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject PATCH COMPLETE",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{resId}}",
    "status": 400,
    "body": {
      "status": "COMPLETE"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject PATCH VALIDATE",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{resId}}",
    "status": 400,
    "body": {
      "status": "VALIDATE"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject PATCH AI_ASSIST",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{resId}}",
    "status": 400,
    "body": {
      "status": "AI_ASSIST"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Reject PATCH PUBLISHED",
    "actor": "owner",
    "method": "PATCH",
    "path": "/{{resId}}",
    "status": 400,
    "body": {
      "status": "PUBLISHED"
    },
    "match": "{{resEtag}}",
    "error": "BAD_REQUEST"
  },
  {
    "name": "Publication endpoint absent",
    "actor": "owner",
    "method": "POST",
    "path": "/{{resId}}/publish",
    "status": 404,
    "body": {},
    "match": "{{resEtag}}",
    "error": "NOT_FOUND"
  },
  {
    "name": "Own validated read",
    "actor": "owner",
    "method": "GET",
    "path": "/{{resId}}",
    "status": 200,
    "listingStatus": "VALIDATE"
  },
  {
    "name": "Other validated read denied",
    "actor": "other",
    "method": "GET",
    "path": "/{{resId}}",
    "status": 404,
    "error": "LISTING_NOT_FOUND"
  },
  {
    "name": "commercial complete",
    "actor": "owner",
    "method": "POST",
    "path": "/{{commercialId}}/complete",
    "status": 200,
    "body": {},
    "match": "{{commercialEtag}}",
    "listingStatus": "COMPLETE",
    "capture": {
      "commercialEtag": "etag"
    }
  },
  {
    "name": "commercial validate",
    "actor": "owner",
    "method": "POST",
    "path": "/{{commercialId}}/validate",
    "status": 200,
    "body": {},
    "match": "{{commercialEtag}}",
    "listingStatus": "VALIDATE",
    "capture": {
      "commercialEtag": "etag"
    }
  },
  {
    "name": "land complete",
    "actor": "owner",
    "method": "POST",
    "path": "/{{landId}}/complete",
    "status": 200,
    "body": {},
    "match": "{{landEtag}}",
    "listingStatus": "COMPLETE",
    "capture": {
      "landEtag": "etag"
    }
  },
  {
    "name": "land validate",
    "actor": "owner",
    "method": "POST",
    "path": "/{{landId}}/validate",
    "status": 200,
    "body": {},
    "match": "{{landEtag}}",
    "listingStatus": "VALIDATE",
    "capture": {
      "landEtag": "etag"
    }
  }
];
