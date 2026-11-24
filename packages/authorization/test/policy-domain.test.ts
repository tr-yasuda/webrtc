import { describe, expect, test } from "vitest";
import {
  managementCredentialScopeValues,
  managementOperationValues,
  participantOperationValues,
  projectUserRoleValues,
} from "../src/generated/policy.js";
import { authSpecName } from "./auth-spec.js";
import {
  allManagementCredentialScopes,
  allManagementOperations,
  allParticipantOperations,
  allProjectUserRoles,
} from "./policy.js";

describe("認可ポリシーの有限ドメイン", () => {
  test(
    authSpecName("AUTH-VER-03", "テスト用のロール・操作・scope 一覧が生成ポリシーと一致する"),
    () => {
      expect([...allProjectUserRoles].toSorted()).toStrictEqual(
        [...projectUserRoleValues].toSorted(),
      );
      expect([...allManagementOperations].toSorted()).toStrictEqual(
        [...managementOperationValues].toSorted(),
      );
      expect([...allManagementCredentialScopes].toSorted()).toStrictEqual(
        [...managementCredentialScopeValues].toSorted(),
      );
      expect([...allParticipantOperations].toSorted()).toStrictEqual(
        [...participantOperationValues].toSorted(),
      );
    },
  );
});
