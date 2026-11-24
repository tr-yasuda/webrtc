import { fc } from "@fast-check/vitest";
import type {
  ParticipantAuthorizationReason,
  ParticipantOperation,
} from "../../../src/participant.js";
import { allParticipantOperations } from "../../policy.js";
import { unknownStringArbitrary } from "../support.js";
import type { ParticipantBaselineVariant, ParticipantCaseBase } from "./baseline.js";

export type ParticipantMutation = {
  readonly id: string;
  readonly category: string;
  readonly reason: ParticipantAuthorizationReason;
  readonly multiFault?: boolean;
  readonly apply: (base: ParticipantCaseBase) => ParticipantCaseBase | undefined;
  readonly catalog: {
    readonly operation: ParticipantOperation;
    readonly variant: ParticipantBaselineVariant;
  };
};

export const participantMutations: readonly ParticipantMutation[] = [
  mutation("project-suspended", "project", "project-not-active", (base) => ({
    ...base,
    input: {
      ...base.input,
      project: { ...base.input.project, state: "suspended" },
    },
  })),
  mutation(
    "credential-project-mismatch",
    "credential-project",
    "credential-target-mismatch",
    (base) => ({
      ...base,
      input: {
        ...base.input,
        credential: { ...base.input.credential, projectId: base.ids.otherProjectId },
      },
    }),
  ),
  mutation("credential-room-mismatch", "credential-room", "credential-target-mismatch", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: {
        ...base.input.credential,
        roomName: base.input.credential.roomName === "room-a" ? "room-b" : "room-a",
      },
    },
  })),
  mutation("room-project-mismatch", "room-project", "credential-target-mismatch", (base) => ({
    ...base,
    input: {
      ...base.input,
      room: { ...base.input.room, projectId: base.ids.otherProjectId },
    },
  })),
  mutation("subject-empty", "subject", "subject-required", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: { ...base.input.credential, subject: "" },
    },
  })),
  mutation("participant-external-empty", "participant-subject", "subject-required", (base) => {
    if (base.input.participant === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        participant: { ...base.input.participant, externalUserId: "" },
      },
    };
  }),
  mutation("participant-subject-mismatch", "participant-subject", "subject-mismatch", (base) => {
    if (base.input.participant === undefined) {
      return undefined;
    }
    const mismatchedSubject =
      base.input.credential.subject === base.ids.subject ? base.ids.otherSubject : base.ids.subject;
    return {
      ...base,
      input: {
        ...base.input,
        participant: { ...base.input.participant, externalUserId: mismatchedSubject },
      },
    };
  }),
  mutation("grant-missing", "grant", "grant-not-granted", (base) => ({
    ...base,
    input: {
      ...base.input,
      credential: {
        ...base.input.credential,
        grants: { ...base.input.credential.grants, [base.operation]: false },
      },
    },
  })),
  mutation("room-state-deleting", "room-state", "room-not-active", (base) => {
    if (base.input.room.state === "absent") {
      return undefined;
    }
    return {
      ...base,
      input: { ...base.input, room: { ...base.input.room, state: "deleting" } },
    };
  }),
  mutation("room-state-deleted", "room-state", "room-not-active", (base) => {
    if (base.input.room.state === "absent") {
      return undefined;
    }
    return {
      ...base,
      input: { ...base.input, room: { ...base.input.room, state: "deleted" } },
    };
  }),
  mutation("session-missing", "session-presence", "session-required", (base) => {
    if (base.input.session === undefined || base.operation === "room.join") {
      return undefined;
    }
    const { session: _session, ...input } = base.input;
    return { ...base, input };
  }),
  mutation("session-state-revoked", "session-state", "session-not-active", (base) => {
    if (base.input.session === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        session: { ...base.input.session, state: "revoked" },
      },
    };
  }),
  mutation("session-state-ended", "session-state", "session-not-active", (base) => {
    if (base.input.session === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        session: { ...base.input.session, state: "ended" },
      },
    };
  }),
  mutation("session-project-mismatch", "session-project", "session-target-mismatch", (base) => {
    if (base.input.session === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        session: { ...base.input.session, projectId: base.ids.otherProjectId },
      },
    };
  }),
  mutation("session-room-mismatch", "session-room", "session-target-mismatch", (base) => {
    if (base.input.session === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        session: { ...base.input.session, roomId: base.ids.otherRoomId },
      },
    };
  }),
  mutation(
    "session-participant-mismatch",
    "session-participant",
    "session-target-mismatch",
    (base) => {
      if (base.input.session === undefined || base.input.participant === undefined) {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          session: { ...base.input.session, participantId: base.ids.otherParticipantId },
        },
      };
    },
  ),
  mutation("participant-missing", "participant-presence", "participant-required", (base) => {
    if (
      base.input.participant === undefined ||
      (base.operation === "room.join" && base.input.session === undefined)
    ) {
      return undefined;
    }
    const { participant: _participant, ...input } = base.input;
    return { ...base, input };
  }),
  mutation("participant-state-revoked", "participant-state", "participant-not-active", (base) => {
    if (base.input.participant === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        participant: { ...base.input.participant, state: "revoked" },
      },
    };
  }),
  mutation("participant-state-left", "participant-state", "participant-not-active", (base) => {
    if (base.input.participant === undefined) {
      return undefined;
    }
    return {
      ...base,
      input: {
        ...base.input,
        participant: { ...base.input.participant, state: "left" },
      },
    };
  }),
  mutation(
    "participant-room-mismatch",
    "participant-room",
    "participant-target-mismatch",
    (base) => {
      if (base.input.participant === undefined) {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          participant: { ...base.input.participant, roomId: base.ids.otherRoomId },
        },
      };
    },
  ),
  mutation(
    "room-create-on-existing",
    "room-create-rule",
    "room-already-exists",
    (base) => {
      if (base.operation !== "room.create" || base.input.room.state !== "absent") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          room: {
            state: "active",
            id: base.ids.roomId,
            projectId: base.ids.projectId,
            name: base.input.room.name,
          },
        },
      };
    },
    { operation: "room.create", variant: "default" },
  ),
  mutation(
    "room-create-without-join",
    "room-create-rule",
    "room-join-required",
    (base) => {
      if (base.operation !== "room.create") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          credential: {
            ...base.input.credential,
            grants: { ...base.input.credential.grants, "room.join": false },
          },
        },
      };
    },
    { operation: "room.create", variant: "default" },
  ),
  mutation(
    "room-create-with-session",
    "room-create-rule",
    "session-target-mismatch",
    (base) => {
      if (base.operation !== "room.create") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          session: {
            id: base.ids.sessionId,
            projectId: base.ids.projectId,
            roomId: base.ids.roomId,
            participantId: base.ids.participantId,
            state: "active",
          },
        },
      };
    },
    { operation: "room.create", variant: "default" },
  ),
  mutation(
    "room-create-with-participant",
    "room-create-rule",
    "participant-target-mismatch",
    (base) => {
      if (base.operation !== "room.create") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          participant: {
            id: base.ids.participantId,
            roomId: base.ids.roomId,
            externalUserId: base.input.credential.subject,
            state: "active",
          },
        },
      };
    },
    { operation: "room.create", variant: "default" },
  ),
  mutation(
    "room-join-without-create",
    "room-join-rule",
    "room-create-required",
    (base) => {
      if (base.operation !== "room.join" || base.input.room.state !== "absent") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          credential: {
            ...base.input.credential,
            grants: { ...base.input.credential.grants, "room.create": false },
          },
        },
      };
    },
    { operation: "room.join", variant: "absent-room" },
  ),
  mutation(
    "room-join-absent-with-session",
    "room-join-absent-session",
    "session-target-mismatch",
    (base) => {
      if (base.operation !== "room.join" || base.input.room.state !== "absent") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          session: {
            id: base.ids.sessionId,
            projectId: base.ids.projectId,
            roomId: base.ids.roomId,
            participantId: base.ids.participantId,
            state: "active",
          },
        },
      };
    },
    { operation: "room.join", variant: "absent-room" },
  ),
  mutation(
    "room-join-absent-with-participant",
    "room-join-absent-participant",
    "participant-target-mismatch",
    (base) => {
      if (base.operation !== "room.join" || base.input.room.state !== "absent") {
        return undefined;
      }
      return {
        ...base,
        input: {
          ...base.input,
          participant: {
            id: base.ids.participantId,
            roomId: base.ids.roomId,
            externalUserId: base.input.credential.subject,
            state: "active",
          },
        },
      };
    },
    { operation: "room.join", variant: "absent-room" },
  ),
  mutation(
    "room-join-session-only",
    "room-join-rule",
    "participant-required",
    (base) => {
      if (base.operation !== "room.join" || base.input.room.state === "absent") {
        return undefined;
      }
      const { participant: _participant, ...input } = base.input;
      return {
        ...base,
        input: {
          ...input,
          session: base.input.session ?? {
            id: base.ids.sessionId,
            projectId: base.ids.projectId,
            roomId: base.ids.roomId,
            participantId: base.ids.participantId,
            state: "active",
          },
        },
      };
    },
    { operation: "room.join", variant: "existing-room" },
  ),
  mutation(
    "unknown-operation",
    "unknown-operation",
    "unsupported-operation",
    (base) => ({
      ...base,
      input: {
        ...base.input,
        operation: "unknown.operation" as ParticipantOperation,
      },
    }),
    { operation: "media.publish", variant: "default" },
    false,
  ),
];

const participantValidationMutationIds = new Set(["unknown-operation"]);

export const participantAuthorizationMutations = participantMutations.filter(
  (candidate) => !participantValidationMutationIds.has(candidate.id),
);

export const participantValidationMutations = participantMutations.filter((candidate) =>
  participantValidationMutationIds.has(candidate.id),
);

export function participantUnknownOperationArbitrary(): fc.Arbitrary<ParticipantOperation> {
  return unknownStringArbitrary(allParticipantOperations) as fc.Arbitrary<ParticipantOperation>;
}

function mutation(
  id: string,
  category: string,
  reason: ParticipantAuthorizationReason,
  apply: (base: ParticipantCaseBase) => ParticipantCaseBase | undefined,
  catalog: ParticipantMutation["catalog"] = { operation: "media.publish", variant: "default" },
  multiFault = true,
): ParticipantMutation {
  return { id, category, reason, multiFault, apply, catalog };
}
