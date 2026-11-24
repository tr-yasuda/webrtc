# 認可ルール追跡

この表は `scripts/check-traceability.mjs` が `README.md` のルール表から生成する。手で編集しない。

| ルールID | 仕様 | テスト | 形式検証 |
|---|---|---|---|
| `P-INPUT-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [participant-validation.test.ts](test/contract/participant-validation.test.ts) | Lean `participant_allow_sound` |
| `P-INPUT-002` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [input-validation.test.ts](test/participant/input-validation.test.ts) | Lean `participant_allow_sound` |
| `P-INPUT-003` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [participant-validation.test.ts](test/contract/participant-validation.test.ts) | Lean `participant_allow_sound` |
| `P-INPUT-004` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [participant-validation.test.ts](test/contract/participant-validation.test.ts) | Lean `validation_rejects_unknown_grant` |
| `P-INPUT-005` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [participant-validation.test.ts](test/contract/participant-validation.test.ts) | Lean `validation_rejects_non_boolean_grant` |
| `PU-INPUT-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-user-validation.test.ts](test/contract/project-user-validation.test.ts) | Lean `project_user_allow_sound` |
| `PU-INPUT-002` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [input-validation.test.ts](test/project-user/input-validation.test.ts) | Lean `project_user_allow_sound` |
| `PU-INPUT-003` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [input-validation.test.ts](test/project-user/input-validation.test.ts) | Lean `project_user_allow_sound` |
| `PU-INPUT-004` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [input-validation.test.ts](test/project-user/input-validation.test.ts) | Lean `project_user_allow_sound` |
| `MC-INPUT-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [management-credential-validation.test.ts](test/contract/management-credential-validation.test.ts) | Lean `management_credential_allow_sound` |
| `MC-INPUT-002` | [management.md「Management API credential」](../../docs/platform/management.md) | [management-credential-validation.test.ts](test/contract/management-credential-validation.test.ts) | Lean `management_credential_allow_sound` |
| `MC-INPUT-003` | [management.md「Management API credential」](../../docs/platform/management.md) | [management-credential-validation.test.ts](test/contract/management-credential-validation.test.ts) | Lean `management_credential_allow_sound` |
| `MC-INPUT-004` | [management.md「Management API credential」](../../docs/platform/management.md) | [input-validation.test.ts](test/management-credential/input-validation.test.ts) | Lean `management_credential_allow_sound` |
| `MC-INPUT-005` | [management.md「Management API credential」](../../docs/platform/management.md) | [management-credential-validation.test.ts](test/contract/management-credential-validation.test.ts) | Lean `management_credential_allow_sound` |
| `P-PROJ-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-TGT-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [credential-target.test.ts](test/participant/credential-target.test.ts) | Lean `participant_allow_sound` |
| `P-SUB-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [subject.test.ts](test/participant/subject.test.ts) | Lean `participant_allow_sound` |
| `P-SUB-002` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [subject.test.ts](test/participant/subject.test.ts) | Lean `participant_allow_sound` |
| `P-SUB-003` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [subject.test.ts](test/participant/subject.test.ts) | Lean `participant_allow_sound` |
| `P-GRANT-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-RC-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-create.test.ts](test/participant/room-create.test.ts) | Lean `participant_allow_sound` |
| `P-RC-002` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-create.test.ts](test/participant/room-create.test.ts) | Lean `participant_allow_sound` |
| `P-RC-003` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-create.test.ts](test/participant/room-create.test.ts) | Lean `participant_allow_sound` |
| `P-RC-004` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-create.test.ts](test/participant/room-create.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-002` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-003` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-004` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join-state.test.ts](test/participant/room-join-state.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-005` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-006` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-007` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-008` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-RJ-009` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [room-join.test.ts](test/participant/room-join.test.ts) | Lean `participant_allow_sound` |
| `P-MD-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-MD-002` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-MD-003` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-MD-004` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-MD-005` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-MD-006` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-MD-007` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `P-ALLOW-001` | [credentials.md「顧客アプリサーバーが署名して Browser SDK へ渡すまで」](../../docs/auth/credentials.md) | [media-data.test.ts](test/participant/media-data.test.ts) | Lean `participant_allow_sound` |
| `PU-PROJ-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-target.test.ts](test/project-user/project-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-ACTOR-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-target.test.ts](test/project-user/project-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-TGT-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-target.test.ts](test/project-user/project-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-ROLE-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-target.test.ts](test/project-user/project-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-ID-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [target-id.test.ts](test/project-user/target-id.test.ts) | Lean `project_user_allow_sound` |
| `PU-ROLE-004` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-target.test.ts](test/project-user/project-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-ROLE-005` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [role-target.test.ts](test/project-user/role-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-ROLE-006` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [role-target.test.ts](test/project-user/role-target.test.ts) | Lean `project_user_allow_sound` |
| `PU-OWNER-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [owner-management.test.ts](test/project-user/owner-management.test.ts) | Lean `project_user_allow_sound` |
| `PU-ALLOW-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [decision-contract.test.ts](test/project-user/decision-contract.test.ts) | Lean `project_user_allow_sound` |
| `MC-CRED-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-CRED-002` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-CRED-003` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-TGT-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-PROJ-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-ID-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [target-id.test.ts](test/management-credential/target-id.test.ts) | Lean `management_credential_allow_sound` |
| `MC-SCOPE-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-SCOPE-002` | [management.md「Management API credential」](../../docs/platform/management.md) | [credential-state.test.ts](test/management-credential/credential-state.test.ts) | Lean `management_credential_allow_sound` |
| `MC-ALLOW-001` | [management.md「Management API credential」](../../docs/platform/management.md) | [scope-matrix.test.ts](test/management-credential/scope-matrix.test.ts) | Lean `management_credential_allow_sound` |
| `DI-OWNER-001` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-owner.test.ts](../domain/test/project-owner.test.ts) | TLA+ `ProjectOwner.tla` |
| `DI-OWNER-002` | [management.md「ProjectUser の権限ロール」](../../docs/platform/management.md) | [project-owner.test.ts](../domain/test/project-owner.test.ts) | TLA+ `ProjectOwner.tla` |

