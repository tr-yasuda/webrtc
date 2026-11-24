import Lean

open Lean

syntax (name := auth_spec) "auth_spec " str : attr

initialize registerBuiltinAttribute {
  name := `auth_spec
  descr := "Authorization specification IDs"
  add := fun _ _ _ => pure ()
}

