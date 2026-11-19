---- MODULE Smoke ----
EXTENDS Naturals

CONSTANT Capacity
VARIABLE count

Init == count = 0

Next == \/ /\ count < Capacity
           /\ count' = count + 1
        \/ /\ count > 0
           /\ count' = count - 1

WithinCapacity == count \in 0..Capacity
====
