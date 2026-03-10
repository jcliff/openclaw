import type { AuthChoice } from "./onboard-types.js";

/**
 * Legacy alias normalization for onboarding auth choices.
 *
 * Historically "oauth" was an alias for the token setup flow.
 */
export const AUTH_CHOICE_LEGACY_ALIASES_FOR_CLI: ReadonlyArray<AuthChoice> = [
  "setup-token",
  "oauth",
  "minimax-cloud",
  "minimax",
];

export function normalizeLegacyOnboardAuthChoice(
  authChoice: AuthChoice | undefined,
): AuthChoice | undefined {
  if (authChoice === "oauth") {
    return "setup-token";
  }
  return authChoice;
}
