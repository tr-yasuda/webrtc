---- MODULE ProjectOwner ----
EXTENDS Naturals, FiniteSets

CONSTANTS Owners

VARIABLES owners, attempts, committed

vars == <<owners, attempts, committed>>

Init ==
  /\ owners = Owners
  /\ attempts = [i \in 1..2 |-> "start"]
  /\ committed = 0

Request(i) ==
  /\ attempts[i] = "start"
  /\ attempts' = [attempts EXCEPT ![i] = "ready"]
  /\ UNCHANGED <<owners, committed>>

Commit(i) ==
  /\ attempts[i] = "ready"
  /\ \E target \in owners :
       /\ Cardinality(owners) > 1
       /\ owners' = owners \ {target}
       /\ attempts' = [attempts EXCEPT ![i] = "committed"]
       /\ committed' = committed + 1

Finish(i) ==
  /\ attempts[i] = "ready"
  /\ Cardinality(owners) = 1
  /\ attempts' = [attempts EXCEPT ![i] = "rejected"]
  /\ UNCHANGED <<owners, committed>>

Done ==
  /\ \A i \in 1..2 : attempts[i] \in {"committed", "rejected"}
  /\ UNCHANGED <<owners, attempts, committed>>

Next ==
  \/ \E i \in 1..2 : Request(i)
  \/ \E i \in 1..2 : Commit(i)
  \/ \E i \in 1..2 : Finish(i)
  \/ Done

Spec == Init /\ [][Next]_vars

OwnerInvariant == owners # {}

AtMostOneCommit == committed <= 1

====
