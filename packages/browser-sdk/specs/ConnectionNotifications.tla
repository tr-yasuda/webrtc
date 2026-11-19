---- MODULE ConnectionNotifications ----
EXTENDS Naturals, Sequences

CONSTANT MaxGeneration
VARIABLES generation, stage, stageGeneration

vars == <<generation, stage, stageGeneration>>
ConnectionStages == <<"participant-registered", "transport-connected", "e2ee-ready">>

Init ==
  /\ generation = 0
  /\ stage = 0
  /\ stageGeneration = 0

ReplaceConnection ==
  /\ generation < MaxGeneration
  /\ generation' = generation + 1
  /\ stage' = 0
  /\ stageGeneration' = generation'

ApplyNotification(source, reportedStage) ==
  /\ source = generation
  /\ reportedStage > stage
  /\ stage' = reportedStage
  /\ stageGeneration' = source
  /\ UNCHANGED generation

Next ==
  \/ ReplaceConnection
  \/ \E source \in 0..generation, reportedStage \in 1..Len(ConnectionStages):
      ApplyNotification(source, reportedStage)

Spec == Init /\ [][Next]_vars
StageBelongsToCurrentConnection == stageGeneration = generation
NoStageRollback == [][generation' = generation => stage' >= stage]_vars
====
