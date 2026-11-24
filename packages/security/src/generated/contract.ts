// Generated from specs/security/contract.json. Do not edit by hand.
export const SECURITY_CONTRACT = {
  "version": 1,
  "tls": {
    "prohibitedVersions": [
      "1.0",
      "1.1"
    ],
    "tls12": {
      "minVersion": "1.2",
      "keyExchange": [
        "ECDHE"
      ],
      "cipherKinds": [
        "AEAD"
      ],
      "prohibited": [
        "CBC",
        "RSA_KEY_EXCHANGE",
        "NULL",
        "COMPRESSION",
        "RENEGOTIATION"
      ],
      "sessionResumption": true,
      "requireAuthenticationOnResumption": true
    },
    "tls13": {
      "minVersion": "1.3",
      "keyExchange": [
        "ECDHE"
      ],
      "groups": [
        "x25519",
        "secp256r1",
        "secp384r1"
      ],
      "psk": {
        "allowed": true,
        "mode": "psk_dhe_ke",
        "externalPskRequiresExplicitConfig": true,
        "pskKeAllowed": false
      },
      "sessionResumption": true,
      "requireAuthenticationOnResumption": true,
      "zeroRtt": false
    }
  },
  "dtls": {
    "supportedVersions": [
      "1.2",
      "1.3"
    ],
    "preferredVersion": "1.3",
    "prohibitedVersions": [
      "1.0"
    ],
    "plaintextFallback": false,
    "webrtcDtls12Renegotiation": false,
    "requireCertificateFingerprintVerification": true
  },
  "baseline": {
    "transportProfiles": {
      "public-control": [
        "tls",
        "tls-1.2-min",
        "tls-1.3-preferred",
        "aead-only",
        "ecdhe-only",
        "server-certificate-verification",
        "no-plaintext-fallback",
        "no-0-rtt",
        "no-external-psk"
      ],
      "internal-service": [
        "mutual-service-auth",
        "encrypted-transport",
        "tls-1.3-if-tls",
        "no-0-rtt",
        "mechanism-selected-by-22"
      ],
      "dplane-ipc": [
        "unix-domain-socket",
        "runtime-directory",
        "dedicated-uid-gid",
        "file-permissions",
        "peer-credentials",
        "no-network-listen",
        "no-tls-required"
      ],
      "turn": [
        "turn-auth",
        "tls-or-dtls",
        "tls-1.2-min",
        "dtls-1.2-or-1.3",
        "dtls-1.3-preferred",
        "no-unauthenticated-allocation"
      ],
      "webrtc-media": [
        "dtls-srtp",
        "dtls-fingerprint-verification",
        "dtls-1.2-or-1.3",
        "dtls-1.3-preferred",
        "sframe-e2ee",
        "e2ee-key-not-shared-with-control-plane",
        "e2ee-counter-no-rollback",
        "no-plaintext-fallback"
      ],
      "webrtc-data": [
        "dtls",
        "dtls-1.2-or-1.3",
        "dtls-1.3-preferred",
        "dtls-fingerprint-verification",
        "data-e2ee",
        "e2ee-key-not-shared-with-control-plane",
        "no-plaintext-fallback"
      ],
      "stun-binding": [
        "unauthenticated-binding-allowed",
        "not-a-control-path"
      ]
    },
    "forbiddenFallbacks": {
      "public-control": [
        "plaintext",
        "weak-tls",
        "skip-certificate-verification"
      ],
      "internal-service": [
        "plaintext",
        "skip-service-auth",
        "unauthenticated-service"
      ],
      "dplane-ipc": [
        "tcp-listen",
        "world-accessible-socket",
        "missing-peer-uid-check",
        "same-uid-assumption"
      ],
      "turn": [
        "unauthenticated-allocation",
        "tls-as-turn-auth"
      ],
      "webrtc-media": [
        "plaintext-rtp",
        "missing-fingerprint-verification",
        "e2ee-key-to-cplane-or-dplane",
        "counter-rollback-on-migration"
      ],
      "webrtc-data": [
        "plaintext-data-channel",
        "missing-fingerprint-verification",
        "e2ee-key-to-cplane-or-dplane"
      ],
      "stun-binding": [
        "stun-as-auth",
        "stun-as-control-channel"
      ]
    },
    "secretClasses": [
      "authentication",
      "key-material",
      "content",
      "control-message",
      "personal-data",
      "identifier"
    ],
    "outputBoundaries": [
      "log",
      "audit",
      "public-error",
      "url",
      "diagnostic",
      "test-output"
    ],
    "auditEventKinds": [
      "authorization-decision",
      "operation-result",
      "request-rejected",
      "resource"
    ],
    "validationStages": [
      "pre-parse",
      "parse",
      "post-parse",
      "decompress-reassemble",
      "execution"
    ],
    "tls": {
      "prohibitedVersions": [
        "1.0",
        "1.1"
      ],
      "tls12KeyExchange": [
        "ECDHE"
      ],
      "tls12CipherKinds": [
        "AEAD"
      ],
      "tls12Prohibited": [
        "CBC",
        "RSA_KEY_EXCHANGE",
        "NULL",
        "COMPRESSION",
        "RENEGOTIATION"
      ],
      "tls13KeyExchange": [
        "ECDHE"
      ],
      "tls13Groups": [
        "x25519",
        "secp256r1",
        "secp384r1"
      ],
      "zeroRtt": false,
      "pskMode": "psk_dhe_ke",
      "pskKeAllowed": false
    },
    "dtls": {
      "supportedVersions": [
        "1.2",
        "1.3"
      ],
      "preferredVersion": "1.3",
      "prohibitedVersions": [
        "1.0"
      ],
      "plaintextFallback": false,
      "webrtcDtls12Renegotiation": false,
      "requireCertificateFingerprintVerification": true
    }
  },
  "secretClasses": [
    {
      "id": "authentication",
      "examples": [
        "participant-jwt",
        "id-token",
        "management-api-credential",
        "application-signing-key",
        "turn-credential",
        "ice-credential",
        "service-credential"
      ]
    },
    {
      "id": "key-material",
      "examples": [
        "e2ee-private-key",
        "e2ee-decryption-key",
        "dtls-private-key",
        "srtp-key",
        "dtls-cookie-secret",
        "sctp-state-cookie"
      ]
    },
    {
      "id": "content",
      "examples": [
        "audio-frame",
        "video-frame",
        "data-channel-payload",
        "packet-body"
      ]
    },
    {
      "id": "control-message",
      "examples": [
        "sdp",
        "full-control-message"
      ]
    },
    {
      "id": "personal-data",
      "examples": [
        "email-address",
        "display-name",
        "ip-address"
      ]
    },
    {
      "id": "identifier",
      "examples": [
        "project-id",
        "room-id",
        "participant-id",
        "session-id",
        "correlation-id"
      ]
    }
  ],
  "redaction": {
    "sensitiveKeys": [
      "authorization",
      "cookie",
      "token",
      "jwt",
      "secret",
      "password",
      "credential",
      "privateKey",
      "decryptionKey",
      "srtpKey",
      "sdp",
      "payload",
      "body",
      "signature",
      "apiKey",
      "sessionKey",
      "email",
      "emailAddress",
      "displayName",
      "ipAddress",
      "phoneNumber",
      "set-cookie",
      "x-api-key",
      "proxy-authorization"
    ],
    "marker": "[REDACTED]",
    "maxDepth": 8,
    "maxItems": 100,
    "maxStringLength": 1024
  },
  "outputBoundaries": [
    {
      "id": "log",
      "allowedTypes": [
        "SafeLogEvent",
        "SafeLogValue"
      ],
      "forbiddenClasses": [
        "authentication",
        "key-material",
        "content",
        "control-message",
        "personal-data"
      ],
      "redactionFallback": true
    },
    {
      "id": "audit",
      "allowedTypes": [
        "AuditRecord"
      ],
      "forbiddenClasses": [
        "authentication",
        "key-material",
        "content",
        "control-message",
        "personal-data"
      ],
      "redactionFallback": true
    },
    {
      "id": "public-error",
      "allowedTypes": [
        "PublicError"
      ],
      "forbiddenClasses": [
        "authentication",
        "key-material",
        "content",
        "control-message",
        "personal-data"
      ],
      "redactionFallback": true
    },
    {
      "id": "url",
      "allowedTypes": [
        "SafeUrl"
      ],
      "forbiddenClasses": [
        "authentication",
        "key-material",
        "content",
        "control-message",
        "personal-data"
      ],
      "redactionFallback": true
    },
    {
      "id": "diagnostic",
      "allowedTypes": [
        "SafeLogEvent",
        "PublicError"
      ],
      "forbiddenClasses": [
        "authentication",
        "key-material",
        "content",
        "control-message",
        "personal-data"
      ],
      "redactionFallback": true
    },
    {
      "id": "test-output",
      "allowedTypes": [
        "SafeTestReport"
      ],
      "forbiddenClasses": [
        "authentication",
        "key-material",
        "content",
        "control-message",
        "personal-data"
      ],
      "redactionFallback": false
    }
  ],
  "transportProfiles": [
    {
      "id": "public-control",
      "path": "browser-management-application-to-cplane",
      "requiredControls": [
        "tls",
        "tls-1.2-min",
        "tls-1.3-preferred",
        "aead-only",
        "ecdhe-only",
        "server-certificate-verification",
        "no-plaintext-fallback",
        "no-0-rtt",
        "no-external-psk"
      ],
      "forbiddenFallbacks": [
        "plaintext",
        "weak-tls",
        "skip-certificate-verification"
      ]
    },
    {
      "id": "internal-service",
      "path": "management-signaling-node-host",
      "requiredControls": [
        "mutual-service-auth",
        "encrypted-transport",
        "tls-1.3-if-tls",
        "no-0-rtt",
        "mechanism-selected-by-22"
      ],
      "forbiddenFallbacks": [
        "plaintext",
        "skip-service-auth",
        "unauthenticated-service"
      ]
    },
    {
      "id": "dplane-ipc",
      "path": "node-host-to-turn-and-sfu",
      "requiredControls": [
        "unix-domain-socket",
        "runtime-directory",
        "dedicated-uid-gid",
        "file-permissions",
        "peer-credentials",
        "no-network-listen",
        "no-tls-required"
      ],
      "forbiddenFallbacks": [
        "tcp-listen",
        "world-accessible-socket",
        "missing-peer-uid-check",
        "same-uid-assumption"
      ]
    },
    {
      "id": "turn",
      "path": "turn-client-to-turn-server",
      "requiredControls": [
        "turn-auth",
        "tls-or-dtls",
        "tls-1.2-min",
        "dtls-1.2-or-1.3",
        "dtls-1.3-preferred",
        "no-unauthenticated-allocation"
      ],
      "forbiddenFallbacks": [
        "unauthenticated-allocation",
        "tls-as-turn-auth"
      ]
    },
    {
      "id": "webrtc-media",
      "path": "browser-to-sfu-media",
      "requiredControls": [
        "dtls-srtp",
        "dtls-fingerprint-verification",
        "dtls-1.2-or-1.3",
        "dtls-1.3-preferred",
        "sframe-e2ee",
        "e2ee-key-not-shared-with-control-plane",
        "e2ee-counter-no-rollback",
        "no-plaintext-fallback"
      ],
      "forbiddenFallbacks": [
        "plaintext-rtp",
        "missing-fingerprint-verification",
        "e2ee-key-to-cplane-or-dplane",
        "counter-rollback-on-migration"
      ]
    },
    {
      "id": "webrtc-data",
      "path": "browser-to-sfu-data-channel",
      "requiredControls": [
        "dtls",
        "dtls-1.2-or-1.3",
        "dtls-1.3-preferred",
        "dtls-fingerprint-verification",
        "data-e2ee",
        "e2ee-key-not-shared-with-control-plane",
        "no-plaintext-fallback"
      ],
      "forbiddenFallbacks": [
        "plaintext-data-channel",
        "missing-fingerprint-verification",
        "e2ee-key-to-cplane-or-dplane"
      ]
    },
    {
      "id": "stun-binding",
      "path": "standalone-stun-binding",
      "requiredControls": [
        "unauthenticated-binding-allowed",
        "not-a-control-path"
      ],
      "forbiddenFallbacks": [
        "stun-as-auth",
        "stun-as-control-channel"
      ]
    }
  ],
  "audit": {
    "actorKinds": [
      "project-user",
      "participant",
      "service",
      "system"
    ],
    "eventKinds": [
      {
        "id": "authorization-decision",
        "requiredFields": [
          "id",
          "kind",
          "occurredAt",
          "actor",
          "operation",
          "target",
          "decision",
          "reason",
          "correlationId"
        ],
        "fieldTypes": {
          "id": "identifier",
          "kind": "identifier",
          "occurredAt": "timestamp",
          "recordedAt": "timestamp",
          "correlationId": "identifier",
          "actor": "actor",
          "operation": "identifier",
          "target": "target",
          "decision": "enum",
          "reason": "string"
        },
        "decisionValues": [
          "allow",
          "deny"
        ]
      },
      {
        "id": "operation-result",
        "requiredFields": [
          "id",
          "kind",
          "occurredAt",
          "actor",
          "operation",
          "target",
          "result",
          "reason",
          "authorizationDecisionId",
          "correlationId"
        ],
        "fieldTypes": {
          "id": "identifier",
          "kind": "identifier",
          "occurredAt": "timestamp",
          "recordedAt": "timestamp",
          "correlationId": "identifier",
          "actor": "actor",
          "operation": "identifier",
          "target": "target",
          "result": "enum",
          "reason": "string",
          "authorizationDecisionId": "identifier"
        },
        "resultValues": [
          "succeeded",
          "failed",
          "outcome-unknown"
        ]
      },
      {
        "id": "request-rejected",
        "requiredFields": [
          "id",
          "kind",
          "occurredAt",
          "stage",
          "reason",
          "correlationId"
        ],
        "fieldTypes": {
          "id": "identifier",
          "kind": "identifier",
          "occurredAt": "timestamp",
          "recordedAt": "timestamp",
          "correlationId": "identifier",
          "stage": "enum",
          "reason": "string",
          "actor": "actor",
          "target": "target"
        },
        "stageValues": [
          "authentication",
          "validation"
        ]
      },
      {
        "id": "resource",
        "requiredFields": [
          "id",
          "kind",
          "occurredAt",
          "recordedAt",
          "outcome",
          "scopes"
        ],
        "fieldTypes": {
          "id": "identifier",
          "kind": "identifier",
          "occurredAt": "timestamp",
          "recordedAt": "timestamp",
          "correlationId": "identifier",
          "operationId": "identifier",
          "resourceId": "identifier",
          "outcome": "enum",
          "scopes": "identifier-array"
        },
        "outcomeValues": [
          "applied",
          "started",
          "completed",
          "deleted"
        ]
      }
    ]
  },
  "validationStages": [
    {
      "id": "pre-parse",
      "requiredResponsibilities": [
        "message-size-limit",
        "read-time-limit",
        "connection-limit",
        "backpressure"
      ]
    },
    {
      "id": "parse",
      "requiredResponsibilities": [
        "syntax-limit",
        "length-limit",
        "depth-limit",
        "item-limit",
        "unknown-field-policy",
        "allocation-before-limit"
      ]
    },
    {
      "id": "post-parse",
      "requiredResponsibilities": [
        "target-consistency",
        "state-consistency",
        "authorization-input-consistency",
        "candidate-limit"
      ]
    },
    {
      "id": "decompress-reassemble",
      "requiredResponsibilities": [
        "expanded-byte-limit",
        "expansion-ratio-limit",
        "fragment-limit",
        "memory-limit",
        "time-limit"
      ]
    },
    {
      "id": "execution",
      "requiredResponsibilities": [
        "queue-limit",
        "concurrency-limit",
        "rate-limit",
        "deadline",
        "enforceable-cancellation"
      ]
    }
  ]
} as const;
export type SecurityContract = typeof SECURITY_CONTRACT;
export const SECURITY_CONTRACT_VERSION = 1 as const;
export const TRANSPORT_PROFILE_IDS = ["public-control", "internal-service", "dplane-ipc", "turn", "webrtc-media", "webrtc-data", "stun-binding"] as const;
export const OUTPUT_BOUNDARY_IDS = ["log", "audit", "public-error", "url", "diagnostic", "test-output"] as const;
export const AUDIT_EVENT_KINDS = ["authorization-decision", "operation-result", "request-rejected", "resource"] as const;
export const VALIDATION_STAGE_IDS = ["pre-parse", "parse", "post-parse", "decompress-reassemble", "execution"] as const;
