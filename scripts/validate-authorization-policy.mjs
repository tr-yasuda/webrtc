import { loadPolicy, validatePolicy } from "./authorization-policy.mjs";

const policy = loadPolicy();
const errors = validatePolicy(policy);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
