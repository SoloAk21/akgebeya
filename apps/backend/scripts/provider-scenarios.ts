export type ProviderScenario = { name: string; actor?: 'owner' | 'other' | 'admin'; method: string; path: string; status: number; body?: Record<string, unknown>; error?: string; state?: string; capture?: Record<string, string>; };
export const providerScenarios: ProviderScenario[] = [
  {
    "name": "Unauthenticated creation",
    "method": "POST",
    "path": "/providers",
    "status": 401,
    "body": {
      "role": "OWNER",
      "nameEn": "Provider fixture"
    },
    "error": "UNAUTHORIZED"
  },
  {
    "name": "Invalid provider role",
    "actor": "owner",
    "method": "POST",
    "path": "/providers",
    "status": 400,
    "body": {
      "role": "ADMIN",
      "nameEn": "Provider fixture"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "Create provider",
    "actor": "owner",
    "method": "POST",
    "path": "/providers",
    "status": 201,
    "body": {
      "role": "OWNER",
      "nameEn": "Provider fixture",
      "nameAm": "????"
    },
    "state": "UNVERIFIED",
    "capture": {
      "providerId": "provider.id"
    }
  },
  {
    "name": "Duplicate provider",
    "actor": "owner",
    "method": "POST",
    "path": "/providers",
    "status": 409,
    "body": {
      "role": "OWNER",
      "nameEn": "Provider fixture"
    },
    "error": "PROVIDER_CONFLICT"
  },
  {
    "name": "Get own provider",
    "actor": "owner",
    "method": "GET",
    "path": "/providers/me",
    "status": 200,
    "state": "UNVERIFIED"
  },
  {
    "name": "Submit verification",
    "actor": "owner",
    "method": "POST",
    "path": "/providers/me/verification",
    "status": 201,
    "body": {},
    "state": "PENDING",
    "capture": {
      "verificationId": "verification.id"
    }
  },
  {
    "name": "Duplicate pending submission",
    "actor": "owner",
    "method": "POST",
    "path": "/providers/me/verification",
    "status": 409,
    "body": {},
    "error": "PROVIDER_CONFLICT"
  },
  {
    "name": "Get pending status",
    "actor": "owner",
    "method": "GET",
    "path": "/providers/me/verification",
    "status": 200,
    "state": "PENDING"
  },
  {
    "name": "USER cannot approve",
    "actor": "owner",
    "method": "POST",
    "path": "/admin/providers/{{providerId}}/verification/approve",
    "status": 403,
    "body": {
      "verificationId": "{{verificationId}}"
    },
    "error": "FORBIDDEN"
  },
  {
    "name": "USER cannot reject",
    "actor": "other",
    "method": "POST",
    "path": "/admin/providers/{{providerId}}/verification/reject",
    "status": 403,
    "body": {
      "verificationId": "{{verificationId}}"
    },
    "error": "FORBIDDEN"
  },
  {
    "name": "Reject injected ownership",
    "actor": "other",
    "method": "POST",
    "path": "/providers/me/verification",
    "status": 400,
    "body": {
      "providerId": "{{providerId}}"
    },
    "error": "BAD_REQUEST"
  },
  {
    "name": "ADMIN approval",
    "actor": "admin",
    "method": "POST",
    "path": "/admin/providers/{{providerId}}/verification/approve",
    "status": 200,
    "body": {
      "verificationId": "{{verificationId}}"
    },
    "state": "VERIFIED"
  },
  {
    "name": "Verified provider state",
    "actor": "owner",
    "method": "GET",
    "path": "/providers/me",
    "status": 200,
    "state": "VERIFIED"
  },
  {
    "name": "Repeated decision",
    "actor": "admin",
    "method": "POST",
    "path": "/admin/providers/{{providerId}}/verification/reject",
    "status": 409,
    "body": {
      "verificationId": "{{verificationId}}"
    },
    "error": "PROVIDER_CONFLICT"
  },
  {
    "name": "Create second provider",
    "actor": "other",
    "method": "POST",
    "path": "/providers",
    "status": 201,
    "body": {
      "role": "BROKER",
      "nameEn": "Second provider fixture"
    },
    "state": "UNVERIFIED",
    "capture": {
      "otherProviderId": "provider.id"
    }
  },
  {
    "name": "Submit second verification",
    "actor": "other",
    "method": "POST",
    "path": "/providers/me/verification",
    "status": 201,
    "body": {},
    "state": "PENDING",
    "capture": {
      "otherVerificationId": "verification.id"
    }
  },
  {
    "name": "ADMIN rejection",
    "actor": "admin",
    "method": "POST",
    "path": "/admin/providers/{{otherProviderId}}/verification/reject",
    "status": 200,
    "body": {
      "verificationId": "{{otherVerificationId}}"
    },
    "state": "REJECTED"
  },
  {
    "name": "Rejected provider state",
    "actor": "other",
    "method": "GET",
    "path": "/providers/me/verification",
    "status": 200,
    "state": "REJECTED"
  },
  {
    "name": "ADMIN own provider",
    "actor": "admin",
    "method": "POST",
    "path": "/providers",
    "status": 201,
    "body": {
      "role": "DEVELOPER",
      "nameEn": "Admin own fixture"
    },
    "state": "UNVERIFIED",
    "capture": {
      "adminProviderId": "provider.id"
    }
  },
  {
    "name": "ADMIN own submission",
    "actor": "admin",
    "method": "POST",
    "path": "/providers/me/verification",
    "status": 201,
    "body": {},
    "state": "PENDING",
    "capture": {
      "adminVerificationId": "verification.id"
    }
  },
  {
    "name": "ADMIN cannot self approve",
    "actor": "admin",
    "method": "POST",
    "path": "/admin/providers/{{adminProviderId}}/verification/approve",
    "status": 403,
    "body": {
      "verificationId": "{{adminVerificationId}}"
    },
    "error": "FORBIDDEN"
  },
  {
    "name": "ADMIN cannot self reject",
    "actor": "admin",
    "method": "POST",
    "path": "/admin/providers/{{adminProviderId}}/verification/reject",
    "status": 403,
    "body": {
      "verificationId": "{{adminVerificationId}}"
    },
    "error": "FORBIDDEN"
  }
];
