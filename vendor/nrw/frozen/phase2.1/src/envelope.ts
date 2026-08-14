/**
 * Phase 1.2 chooses the trusted-precondition approach. These facts are not
 * asserted by the offline profile input and are not covered by its byte bind.
 * A real HTTP adapter must validate them before calling evaluateObservation.
 */
export const OFFLINE_RESPONSE_ENVELOPE_PRECONDITION = {
  kind: "trusted-precondition" as const,
  common: [
    "The body is from the final response to the represented request and authority context.",
    "The provider contract classifies the HTTP status as successful, not an error or retry/intermediate response.",
    "The response media type is a provider-compatible JSON representation and decoding succeeded exactly once.",
    "Any redirect or effective URL change has been captured in the represented request and source scope.",
  ],
  profiles: {
    "algolia-search": [
      "The response is a successful 2xx Search API v1 single-index response with JSON media type.",
    ],
    "elasticsearch-local-search": [
      "The response is the final 200 application/json response from the synchronous local _search endpoint.",
    ],
    "odata-4.01-entity-collection": [
      "The response is a successful OData entity-collection response with JSON media type.",
      "The OData-Version response header is present and compatible with the selected 4.01 profile semantics.",
      "Any semantics-relevant Preference-Applied behavior is represented or rejected before evaluation.",
    ],
  },
} as const;
