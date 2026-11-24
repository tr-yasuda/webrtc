---- MODULE ResourceLifecycle ----
EXTENDS Naturals, FiniteSets

\* 通知の消失・重複・遅延は、完了済みの遷移を再度有効にしないことで抽象化する。
CONSTANTS Slots, MaxCount, Confirmed

VARIABLES state, counted, everReleased

vars == <<state, counted, everReleased>>

ResourceStates == {"reserved", "in-use", "release-pending", "isolated", "released", "result-unknown"}
CountedStates == {"reserved", "in-use", "release-pending", "isolated", "result-unknown"}
ReconcileStates == {"in-use", "release-pending", "released", "isolated"}

Init ==
  /\ state = [r \in Slots |-> "free"]
  /\ counted = 0
  /\ everReleased = {}

RecordReleased ==
  everReleased' = everReleased \cup {r \in Slots : state'[r] = "released"}

Reserve(r) ==
  /\ state[r] = "free"
  /\ counted < MaxCount
  /\ state' = [state EXCEPT ![r] = "reserved"]
  /\ counted' = counted + 1
  /\ RecordReleased

Allocate(r) ==
  /\ state[r] = "reserved"
  /\ state' = [state EXCEPT ![r] = "in-use"]
  /\ UNCHANGED counted
  /\ RecordReleased

RequestRelease(r) ==
  /\ state[r] = "in-use"
  /\ state' = [state EXCEPT ![r] = "release-pending"]
  /\ UNCHANGED counted
  /\ RecordReleased

ConfirmRelease(r) ==
  /\ state[r] \in CountedStates
  /\ state' = [state EXCEPT ![r] = "released"]
  /\ counted' = counted - 1
  /\ RecordReleased

MarkUnknown(r) ==
  /\ state[r] \in {"reserved", "in-use", "release-pending"}
  /\ state' = [state EXCEPT ![r] = "result-unknown"]
  /\ UNCHANGED counted
  /\ RecordReleased

Reconcile(r, nextState) ==
  /\ \/ (state[r] = "result-unknown" /\ nextState \in ReconcileStates)
     \/ (state[r] = "isolated" /\ nextState = "released")
  /\ state' = [state EXCEPT ![r] = nextState]
  /\ counted' = IF nextState = "released" THEN counted - 1 ELSE counted
  /\ RecordReleased

WorkerRestart ==
  /\ \E r \in Slots : state[r] \in CountedStates
  /\ LET active == {r \in Slots : state[r] \in CountedStates}
         releasedByRestart == {r \in active : state[r] = "reserved" \/ r \in Confirmed}
     IN /\ state' = [r \in Slots |->
                       IF r \in releasedByRestart THEN "released"
                       ELSE IF r \in active THEN "isolated"
                       ELSE state[r]]
        /\ counted' = counted - Cardinality(releasedByRestart)
  /\ RecordReleased

Next ==
  \/ \E r \in Slots :
       \/ Reserve(r)
       \/ Allocate(r)
       \/ RequestRelease(r)
       \/ ConfirmRelease(r)
       \/ MarkUnknown(r)
       \/ \E nextState \in ReconcileStates : Reconcile(r, nextState)
  \/ WorkerRestart

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ state \in [Slots -> {"free"} \cup ResourceStates]
  /\ counted \in Nat
  /\ everReleased \subseteq Slots

AccountingMatches ==
  counted = Cardinality({r \in Slots : state[r] \in CountedStates})

WithinLimit ==
  counted <= MaxCount

ReleasedTerminal ==
  \A r \in everReleased : state[r] = "released"

====
