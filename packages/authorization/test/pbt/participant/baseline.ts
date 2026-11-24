import { fc } from "@fast-check/vitest";
import type {
  ParticipantAuthorizationInput,
  ParticipantGrants,
  ParticipantOperation,
} from "../../../src/participant.js";
import { allParticipantOperations } from "../../policy.js";
import { idPoolArbitrary, type IdPool } from "../support.js";

export type ParticipantBaselineVariant =
  | "default"
  | "existing-room"
  | "existing-room-participant"
  | "existing-room-session"
  | "absent-room";

export type ParticipantCaseBase = {
  readonly input: ParticipantAuthorizationInput;
  readonly ids: IdPool;
  readonly operation: ParticipantOperation;
  readonly variant: ParticipantBaselineVariant;
};

const noGrants: ParticipantGrants = {
  "room.create": false,
  "room.join": false,
  "media.publish": false,
  "media.subscribe": false,
  "data.send": false,
};

export const allParticipantBaselineVariants: readonly ParticipantBaselineVariant[] = [
  "default",
  "existing-room",
  "existing-room-participant",
  "existing-room-session",
  "absent-room",
];

export function participantBaselineCaseArbitrary(): fc.Arbitrary<ParticipantCaseBase> {
  return fc
    .tuple(fc.constantFrom(...allParticipantOperations), idPoolArbitrary())
    .chain(([operation, ids]) => {
      const variants = participantBaselineVariants(operation);
      return fc
        .tuple(fc.constantFrom(...variants), subjectArbitrary(ids))
        .map(([variant, subjectValue]) => ({
          input: participantBaseline(operation, variant, ids, subjectValue),
          ids,
          operation,
          variant,
        }));
    });
}

export function participantBaseline(
  operation: ParticipantOperation,
  variant: ParticipantBaselineVariant,
  ids: IdPool,
  subjectValue: string,
): ParticipantAuthorizationInput {
  const project = { id: ids.projectId, state: "active" as const };
  const credential = {
    projectId: ids.projectId,
    roomName: "room-a",
    subject: subjectValue,
  };

  switch (operation) {
    case "room.create":
      return {
        operation,
        project,
        credential: {
          ...credential,
          grants: grantsFor("room.create", "room.join"),
        },
        room: {
          state: "absent",
          projectId: ids.projectId,
          name: "room-a",
        },
      };
    case "room.join": {
      if (variant === "absent-room") {
        return {
          operation,
          project,
          credential: {
            ...credential,
            grants: grantsFor("room.create", "room.join"),
          },
          room: {
            state: "absent",
            projectId: ids.projectId,
            name: "room-a",
          },
        };
      }
      if (variant === "existing-room-participant") {
        return {
          operation,
          project,
          credential: {
            ...credential,
            grants: grantsFor("room.join"),
          },
          room: {
            state: "active",
            id: ids.roomId,
            projectId: ids.projectId,
            name: "room-a",
          },
          participant: {
            id: ids.participantId,
            roomId: ids.roomId,
            externalUserId: subjectValue,
            state: "active",
          },
        };
      }
      if (variant === "existing-room-session") {
        return {
          operation,
          project,
          credential: {
            ...credential,
            grants: grantsFor("room.join"),
          },
          room: {
            state: "active",
            id: ids.roomId,
            projectId: ids.projectId,
            name: "room-a",
          },
          session: {
            id: ids.sessionId,
            projectId: ids.projectId,
            roomId: ids.roomId,
            participantId: ids.participantId,
            state: "active",
          },
          participant: {
            id: ids.participantId,
            roomId: ids.roomId,
            externalUserId: subjectValue,
            state: "active",
          },
        };
      }
      return {
        operation,
        project,
        credential: {
          ...credential,
          grants: grantsFor("room.join"),
        },
        room: {
          state: "active",
          id: ids.roomId,
          projectId: ids.projectId,
          name: "room-a",
        },
      };
    }
    default:
      return {
        operation,
        project,
        credential: {
          ...credential,
          grants: grantsFor(operation),
        },
        room: {
          state: "active",
          id: ids.roomId,
          projectId: ids.projectId,
          name: "room-a",
        },
        session: {
          id: ids.sessionId,
          projectId: ids.projectId,
          roomId: ids.roomId,
          participantId: ids.participantId,
          state: "active",
        },
        participant: {
          id: ids.participantId,
          roomId: ids.roomId,
          externalUserId: subjectValue,
          state: "active",
        },
      };
  }
}

export function participantBaselineVariants(
  operation: ParticipantOperation,
): readonly ParticipantBaselineVariant[] {
  switch (operation) {
    case "room.join":
      return ["existing-room", "existing-room-participant", "existing-room-session", "absent-room"];
    default:
      return ["default"];
  }
}

function grantsFor(...operations: readonly ParticipantOperation[]): ParticipantGrants {
  const grants: Record<ParticipantOperation, boolean> = { ...noGrants };
  for (const operation of operations) {
    grants[operation] = true;
  }
  return grants;
}

function subjectArbitrary(ids: IdPool): fc.Arbitrary<string> {
  return fc.oneof(fc.constantFrom(ids.subject, ids.otherSubject), fc.string({ minLength: 1 }));
}
