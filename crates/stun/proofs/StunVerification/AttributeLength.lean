import Std.Tactic

namespace StunVerification

def paddedValueLength (length : Nat) : Nat := ((length + 3) / 4) * 4

theorem paddedValueLength_spec (length : Nat) :
    length ≤ paddedValueLength length ∧
      paddedValueLength length < length + 4 ∧
      paddedValueLength length % 4 = 0 := by
  unfold paddedValueLength
  omega

end StunVerification
