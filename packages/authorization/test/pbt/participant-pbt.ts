import { fc } from "@fast-check/vitest";
import type {
  ParticipantAuthorizationInput,
  ParticipantAuthorizationReason,
  ParticipantAuthorizationTarget,
  ParticipantGrants,
  ParticipantOperation,
} from "../../src/participant.js";
import { allParticipantOperations } from "../policy-expectations.js";
import { idPoolArbitrary, type IdPool, unknownStringArbitrary } from "../pbt-support.js";

const participantOperationSet = new Set<string>(allParticipantOperations);

export type ParticipantBaselineVariant =
  | "default"
  | "existing-room"
  | "existing-room-session"
  | "absent-room";

export type ParticipantCaseBase = {
  readonly input: ParticipantAuthorizationInput;
  readonly ids: IdPool;
  readonly operation: ParticipantOperation;
  readonly variant: ParticipantBaselineVariant;
};

export type ParticipantCase = {
  readonly input: ParticipantAuthorizationInput;
  readonly mutations: string[];
  readonly operation: ParticipantOperation;
  readonly variant: ParticipantBaselineVariant;
};

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

export function participantValidCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return participantBaselineCaseArbitrary().map((base) => ({
    input: base.input,
    mutations: [],
    operation: base.operation,
    variant: base.variant,
  }));
}

export function participantSingleFaultCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return participantCaseWithMutationsArbitrary(1, 1);
}

export function participantMultiFaultCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return participantCaseWithMutationsArbitrary(2, 4);
}

export function participantCaseArbitrary(): fc.Arbitrary<ParticipantCase> {
  return fc.oneof(
    { arbitrary: participantValidCaseArbitrary(), weight: 1 },
    { arbitrary: participantSingleFaultCaseArbitrary(), weight: 3 },
    { arbitrary: participantMultiFaultCaseArbitrary(), weight: 2 },
  );
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

export function participantExpectedTarget(
  input: ParticipantAuthorizationInput,
): ParticipantAuthorizationTarget {
  return {
    projectId: input.project.id,
    roomName: input.room.name,
    ...(input.room.state === "absent" ? {} : { roomId: input.room.id }),
    ...(input.session === undefined ? {} : { sessionId: input.session.id }),
    ...(input.participant === undefined ? {} : { participantId: input.participant.id }),
  };
}

export function participantViolations(
  input: ParticipantAuthorizationInput,
): ReadonlySet<ParticipantAuthorizationReason> {
  const violations = new Set<ParticipantAuthorizationReason>();
  const operationIsKnown = isParticipantOperation(input.operation);

  if (!operationIsKnown) {
    violations.add("unsupported-operation");
  }
  if (input.project.state !== "active") {
    violations.add("project-not-active");
  }
  if (
    input.credential.projectId !== input.project.id ||
    input.credential.roomName !== input.room.name ||
    input.room.projectId !== input.project.id
  ) {
    violations.add("credential-target-mismatch");
  }
  if (!isNonEmptyString(input.credential.subject)) {
    violations.add("subject-required");
  } else if (input.participant !== undefined) {
    if (!isNonEmptyString(input.participant.externalUserId)) {
      violations.add("subject-required");
    } else if (input.participant.externalUserId !== input.credential.subject) {
      violations.add("subject-mismatch");
    }
  }
  if (operationIsKnown && input.credential.grants[input.operation] !== true) {
    violations.add("grant-not-granted");
  }

  switch (input.operation) {
    case "room.create":
      if (input.room.state !== "absent") {
        violations.add("room-already-exists");
      }
      if (input.credential.grants["room.join"] !== true) {
        violations.add("room-join-required");
      }
      if (input.session !== undefined) {
        violations.add("session-target-mismatch");
      }
      if (input.participant !== undefined) {
        violations.add("participant-target-mismatch");
      }
      break;
    case "room.join":
      if (input.room.state === "absent") {
        if (input.credential.grants["room.create"] !== true) {
          violations.add("room-create-required");
        }
        if (input.session !== undefined) {
          violations.add("session-target-mismatch");
        }
        if (input.participant !== undefined) {
          violations.add("participant-target-mismatch");
        }
        break;
      }
      if (input.room.state !== "active") {
        violations.add("room-not-active");
      }
      if (input.session !== undefined && input.participant === undefined) {
        violations.add("participant-required");
      }
      if (input.session !== undefined) {
        if (input.session.state !== "active") {
          violations.add("session-not-active");
        }
        if (
          input.session.projectId !== input.project.id ||
          input.session.roomId !== input.room.id ||
          (input.participant !== undefined && input.session.participantId !== input.participant.id)
        ) {
          violations.add("session-target-mismatch");
        }
      }
      if (input.participant !== undefined) {
        if (input.participant.state !== "active") {
          violations.add("participant-not-active");
        }
        if (input.participant.roomId !== input.room.id) {
          violations.add("participant-target-mismatch");
        }
      }
      break;
    case "media.publish":
    case "media.subscribe":
    case "data.send": {
      const roomId = input.room.state === "absent" ? undefined : input.room.id;
      if (input.room.state !== "active") {
        violations.add("room-not-active");
      }
      if (input.session === undefined) {
        violations.add("session-required");
      } else {
        if (input.session.state !== "active") {
          violations.add("session-not-active");
        }
        if (
          input.session.projectId !== input.project.id ||
          input.session.roomId !== roomId ||
          (input.participant !== undefined && input.session.participantId !== input.participant.id)
        ) {
          violations.add("session-target-mismatch");
        }
      }
      if (input.participant === undefined) {
        violations.add("participant-required");
      } else {
        if (input.participant.state !== "active") {
          violations.add("participant-not-active");
        }
        if (input.participant.roomId !== roomId) {
          violations.add("participant-target-mismatch");
        }
      }
      break;
    }
    default:
      break;
  }

  return violations;
}

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

export function participantUnknownOperationArbitrary(): fc.Arbitrary<ParticipantOperation> {
  return unknownStringArbitrary(allParticipantOperations) as fc.Arbitrary<ParticipantOperation>;
}

function participantCaseWithMutationsArbitrary(
  minMutations: number,
  maxMutations: number,
): fc.Arbitrary<ParticipantCase> {
  return participantBaselineCaseArbitrary().chain((base) => {
    const applicable = participantMutations.filter((candidate) => {
      if (minMutations > 1 && candidate.multiFault === false) {
        return false;
      }
      const next = candidate.apply(base);
      if (next === undefined) {
        return false;
      }
      const violationCount = participantViolations(next.input).size;
      return minMutations === 1 ? violationCount === 1 : violationCount >= 1;
    });
    const categories = [...new Set(applicable.map((candidate) => candidate.category))];
    if (categories.length < minMutations) {
      const emptyCase: ParticipantCase = {
        input: base.input,
        mutations: [],
        operation: base.operation,
        variant: base.variant,
      };
      return fc.constant(emptyCase).filter(() => false);
    }
    return fc
      .uniqueArray(fc.constantFrom(...categories), {
        minLength: minMutations,
        maxLength: Math.min(maxMutations, categories.length),
      })
      .map((selectedCategories) => {
        let current = base;
        const applied: string[] = [];
        for (const category of selectedCategories) {
          const candidate = applicable.find((entry) => entry.category === category);
          const next = candidate?.apply(current);
          if (candidate !== undefined && next !== undefined) {
            current = next;
            applied.push(candidate.id);
          }
        }
        if (applied.length < minMutations) {
          return undefined;
        }
        return {
          input: current.input,
          mutations: applied,
          operation: current.operation,
          variant: current.variant,
        };
      })
      .filter(
        (value): value is ParticipantCase =>
          value !== undefined &&
          value.mutations.length >= minMutations &&
          participantViolations(value.input).size >= minMutations,
      );
  });
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

export function participantBaselineVariants(
  operation: ParticipantOperation,
): readonly ParticipantBaselineVariant[] {
  switch (operation) {
    case "room.join":
      return ["existing-room", "existing-room-session", "absent-room"];
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

function isParticipantOperation(value: string): value is ParticipantOperation {
  return participantOperationSet.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
