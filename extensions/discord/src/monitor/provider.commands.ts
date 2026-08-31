// Discord provider module implements model/runtime integration.
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  listNativeCommandSpecsForConfig,
  listSkillCommandsForAgents,
} from "openclaw/plugin-sdk/command-auth-native";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveDefaultAgentId } from "openclaw/plugin-sdk/config-runtime";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import {
  mergeNativeCommandSpecs,
  type NativeCommandSpec,
} from "openclaw/plugin-sdk/native-command-registry";
import type {
  PluginCommandNativeCandidate,
  PluginCommandRuntime,
} from "openclaw/plugin-sdk/plugin-command-runtime";
import { danger, warn, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
import { DISCORD_VOICE_COMMAND_SPEC } from "../voice/command.js";

export type DiscordProviderCommandSpec = NativeCommandSpec | PluginCommandNativeCandidate;

const loadPluginCommandRuntime = createLazyRuntimeModule(
  () => import("openclaw/plugin-sdk/plugin-command-runtime"),
);

function resolveNativeSkillAgentIdsForAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): string[] | undefined {
  const accountId = normalizeLowercaseStringOrEmpty(params.accountId);
  if (!accountId) {
    return undefined;
  }
  const boundAgentId = params.cfg.bindings?.find((binding) => {
    const match = binding.match;
    return (
      match.channel === "discord" &&
      normalizeLowercaseStringOrEmpty(match.accountId) === accountId &&
      match.peer === undefined
    );
  })?.agentId;
  if (boundAgentId) {
    return [boundAgentId];
  }
  if (accountId === normalizeLowercaseStringOrEmpty(DEFAULT_ACCOUNT_ID)) {
    return params.cfg.agents?.ownership === "explicit"
      ? undefined
      : [resolveDefaultAgentId(params.cfg)];
  }
  const configuredAgentIds = [
    ...Object.keys(params.cfg.agents?.entries ?? {}),
    ...(params.cfg.agents?.list?.map((agent) => agent.id) ?? []),
  ];
  const matchingAgentId = configuredAgentIds.find(
    (agentId) => normalizeLowercaseStringOrEmpty(agentId) === accountId,
  );
  return matchingAgentId ? [matchingAgentId] : undefined;
}

export async function resolveDiscordProviderCommandSpecs(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  nativeEnabled: boolean;
  nativeSkillsEnabled: boolean;
  voiceEnabled: boolean;
  accountId?: string;
  maxDiscordCommands?: number;
  listSkillCommandsForAgents?: typeof listSkillCommandsForAgents;
  listNativeCommandSpecsForConfig?: typeof listNativeCommandSpecsForConfig;
}): Promise<{
  skillCommands: ReturnType<typeof listSkillCommandsForAgents>;
  commandSpecs: DiscordProviderCommandSpec[];
}> {
  const listSkillCommands = params.listSkillCommandsForAgents ?? listSkillCommandsForAgents;
  const listNativeCommandSpecs =
    params.listNativeCommandSpecsForConfig ?? listNativeCommandSpecsForConfig;
  const maxDiscordCommands = params.maxDiscordCommands ?? 100;
  const nativeSkillAgentIds = resolveNativeSkillAgentIdsForAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  let pluginCommandRuntime: PluginCommandRuntime | undefined;
  if (params.nativeEnabled) {
    pluginCommandRuntime = (await loadPluginCommandRuntime()).createPluginCommandRuntime();
  }
  const pluginCommandSpecs = pluginCommandRuntime?.listNativeCandidates("discord") ?? [];
  const onCollision = (normalizedName: string) => {
    params.runtime.error?.(
      danger(
        `discord: plugin command "/${normalizedName}" duplicates an existing native command. Skipping.`,
      ),
    );
  };
  const mergePluginCommandSpecs = (
    primary: readonly NativeCommandSpec[],
    collisionHandler: (normalizedName: string) => void,
  ) =>
    mergeNativeCommandSpecs({
      primary,
      secondary: pluginCommandSpecs,
      onCollision: collisionHandler,
    });
  const listPrimaryCommandSpecs = (
    skillCommands: ReturnType<typeof listSkillCommandsForAgents>,
  ): NativeCommandSpec[] => {
    const standardSpecs = listNativeCommandSpecs(params.cfg, {
      skillCommands,
      provider: "discord",
    });
    if (!params.voiceEnabled) {
      return standardSpecs;
    }
    // The specialized voice handler owns /vc before plugin merging and cap planning;
    // remove generic specs so the deployed catalog cannot contain a shadow duplicate.
    const voiceName = DISCORD_VOICE_COMMAND_SPEC.name;
    return [
      ...standardSpecs.filter((spec) => normalizeLowercaseStringOrEmpty(spec.name) !== voiceName),
      DISCORD_VOICE_COMMAND_SPEC,
    ];
  };
  // Defer first-pass diagnostics until the skill-limit decision. A collision can disappear
  // when fallback removes skills, so only the final retained command set should report it.
  const provisionalCollisions: string[] = [];
  let skillCommands =
    params.nativeEnabled && params.nativeSkillsEnabled
      ? listSkillCommands({
          cfg: params.cfg,
          ...(nativeSkillAgentIds ? { agentIds: nativeSkillAgentIds } : {}),
        })
      : [];
  let commandSpecs: DiscordProviderCommandSpec[] = params.nativeEnabled
    ? mergePluginCommandSpecs(listPrimaryCommandSpecs(skillCommands), (normalizedName) =>
        provisionalCollisions.push(normalizedName),
      )
    : [];
  const initialCommandCount = commandSpecs.length;
  if (
    params.nativeEnabled &&
    params.nativeSkillsEnabled &&
    commandSpecs.length > maxDiscordCommands
  ) {
    skillCommands = [];
    commandSpecs = mergePluginCommandSpecs(listPrimaryCommandSpecs([]), onCollision);
    params.runtime.log?.(
      warn(
        `${initialCommandCount} commands exceed the ${maxDiscordCommands}-command Discord limit; removing per-skill commands and keeping /skill.`,
      ),
    );
  } else {
    for (const normalizedName of provisionalCollisions) {
      onCollision(normalizedName);
    }
  }
  if (params.nativeEnabled && commandSpecs.length > maxDiscordCommands) {
    params.runtime.log?.(
      warn(
        `${commandSpecs.length} commands exceed the ${maxDiscordCommands}-command Discord limit; some commands may fail to deploy.`,
      ),
    );
  }
  if (commandSpecs.some((command) => "prepareDispatch" in command)) {
    pluginCommandRuntime?.retainNativeCatalog("discord");
  }
  return { skillCommands, commandSpecs };
}
