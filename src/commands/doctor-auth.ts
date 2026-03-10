import {
  buildAuthHealthSummary,
  DEFAULT_OAUTH_WARN_MS,
  formatRemainingShort,
} from "../agents/auth-health.js";
import {
  ensureAuthProfileStore,
  repairOAuthProfileIdMismatch,
  resolveApiKeyForProfile,
  resolveProfileUnusableUntilForDisplay,
} from "../agents/auth-profiles.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { note } from "../terminal/note.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

export async function maybeRepairAnthropicOAuthProfileId(
  cfg: OpenClawConfig,
  prompter: DoctorPrompter,
): Promise<OpenClawConfig> {
  const store = ensureAuthProfileStore();
  const repair = repairOAuthProfileIdMismatch({
    cfg,
    store,
    provider: "anthropic",
    legacyProfileId: "anthropic:default",
  });
  if (!repair.migrated || repair.changes.length === 0) {
    return cfg;
  }

  note(repair.changes.map((c) => `- ${c}`).join("\n"), "Auth profiles");
  const apply = await prompter.confirm({
    message: "Update Anthropic OAuth profile id in config now?",
    initialValue: true,
  });
  if (!apply) {
    return cfg;
  }
  return repair.config;
}

export async function maybeRemoveDeprecatedCliAuthProfiles(
  cfg: OpenClawConfig,
  _prompter: DoctorPrompter,
): Promise<OpenClawConfig> {
  // Legacy built-in CLI auth profiles (claude-cli/codex-cli) were removed from this build.
  // Keep the command surface stable by making this a no-op.
  return cfg;
}

type AuthIssue = {
  profileId: string;
  provider: string;
  status: string;
  remainingMs?: number;
};

export function resolveUnusableProfileHint(params: {
  kind: "cooldown" | "disabled";
  reason?: string;
}): string {
  if (params.kind === "disabled") {
    if (params.reason === "billing") {
      return "Top up credits (provider billing) or switch provider.";
    }
    if (params.reason === "auth_permanent" || params.reason === "auth") {
      return "Refresh or replace credentials, then retry.";
    }
  }
  return "Wait for cooldown or switch provider.";
}

function formatAuthIssueHint(_issue: AuthIssue): string {
  return `Re-auth via \`${formatCliCommand("openclaw configure")}\` or \`${formatCliCommand("openclaw onboard")}\`.`;
}

function formatAuthIssueLine(issue: AuthIssue): string {
  const remaining =
    issue.remainingMs !== undefined ? ` (${formatRemainingShort(issue.remainingMs)})` : "";
  const hint = formatAuthIssueHint(issue);
  return `- ${issue.profileId}: ${issue.status}${remaining}${hint ? ` — ${hint}` : ""}`;
}

export async function noteAuthProfileHealth(params: {
  cfg: OpenClawConfig;
  prompter: DoctorPrompter;
  allowKeychainPrompt: boolean;
}): Promise<void> {
  const store = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: params.allowKeychainPrompt,
  });
  const unusable = (() => {
    const now = Date.now();
    const out: string[] = [];
    for (const profileId of Object.keys(store.usageStats ?? {})) {
      const until = resolveProfileUnusableUntilForDisplay(store, profileId);
      if (!until || now >= until) {
        continue;
      }
      const stats = store.usageStats?.[profileId];
      const remaining = formatRemainingShort(until - now);
      const disabledActive = typeof stats?.disabledUntil === "number" && now < stats.disabledUntil;
      const kind = disabledActive
        ? `disabled${stats.disabledReason ? `:${stats.disabledReason}` : ""}`
        : "cooldown";
      const hint = resolveUnusableProfileHint({
        kind: disabledActive ? "disabled" : "cooldown",
        reason: stats?.disabledReason,
      });
      out.push(`- ${profileId}: ${kind} (${remaining})${hint ? ` — ${hint}` : ""}`);
    }
    return out;
  })();

  const summary = buildAuthHealthSummary({
    cfg: params.cfg,
    store,
    warnAfterMs: DEFAULT_OAUTH_WARN_MS,
  });

  if (summary.providers.length === 0 && unusable.length === 0) {
    return;
  }

  const lines = ["Auth health:"];
  for (const provider of summary.providers) {
    for (const profile of provider.profiles) {
      lines.push(`- ${profile.profileId}: ${profile.status}`);
    }
  }
  for (const u of unusable) {
    lines.push(u);
  }
  note(lines.join("\n"), "Doctor");
}

export async function resolveApiKeyForProfileOrThrow(params: {
  cfg: OpenClawConfig;
  profileId: string;
}): Promise<string> {
  const store = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
  const resolved = await resolveApiKeyForProfile({
    cfg: params.cfg,
    store,
    profileId: params.profileId,
  });
  if (!resolved) {
    throw new Error(`Failed to resolve api key for auth profile: ${params.profileId}`);
  }
  return resolved.apiKey;
}

export function formatAuthIssues(issues: AuthIssue[]): string {
  return issues.map(formatAuthIssueLine).join("\n");
}
