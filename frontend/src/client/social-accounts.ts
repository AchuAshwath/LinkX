import type { CancelablePromise } from "@/client"
import { OpenAPI } from "@/client"
import { request as __request } from "@/client/core/request"

export type PersonaApi = {
  id: string
  name: string
  description: string | null
  user_id: string
  created_at: string | null
  updated_at: string | null
}

export type PersonasListResponse = {
  data: PersonaApi[]
}

export type PersonaCreate = {
  name: string
  description: string | null
}

export type LinkedInProfile = {
  display_name?: string | null
  email?: string | null
  profile_picture_url?: string | null
}

export type LinkedInStatusResponse = {
  connected: boolean
  needs_reconnect: boolean
  profile: LinkedInProfile | null
}

export type LinkedInAuthorizeResponse = {
  authorize_url: string
}

export type LinkedInConfigCheckResponse = {
  configured: boolean
  redirect_uri_masked: string
  hint: string
}

export class PersonasService {
  public static listPersonas(): CancelablePromise<PersonasListResponse> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/personas",
    })
  }

  public static createPersona(data: { requestBody: PersonaCreate }): CancelablePromise<PersonaApi> {
    return __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/personas",
      body: data.requestBody,
      mediaType: "application/json",
      errors: {
        422: "Validation Error",
      },
    })
  }

  public static updatePersona(data: {
    personaId: string
    requestBody: PersonaCreate
  }): CancelablePromise<PersonaApi> {
    return __request(OpenAPI, {
      method: "PUT",
      url: "/api/v1/personas/{persona_id}",
      path: { persona_id: data.personaId },
      body: data.requestBody,
      mediaType: "application/json",
      errors: {
        422: "Validation Error",
      },
    })
  }

  public static deletePersona(data: { personaId: string }): CancelablePromise<unknown> {
    return __request(OpenAPI, {
      method: "DELETE",
      url: "/api/v1/personas/{persona_id}",
      path: { persona_id: data.personaId },
      errors: {
        422: "Validation Error",
      },
    })
  }
}

export class LinkedInService {
  public static readStatus(data: {
    personaId: string
  }): CancelablePromise<LinkedInStatusResponse> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/linkedin/status",
      query: { persona_id: data.personaId },
      errors: {
        422: "Validation Error",
      },
    })
  }

  public static authorize(data: {
    personaId: string
  }): CancelablePromise<LinkedInAuthorizeResponse> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/auth/linkedin/authorize",
      query: { persona_id: data.personaId },
      errors: {
        422: "Validation Error",
      },
    })
  }

  public static configCheck(): CancelablePromise<LinkedInConfigCheckResponse> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/auth/linkedin/config-check",
    })
  }
}

