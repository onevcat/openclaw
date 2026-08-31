import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveOpenClawExecRuntimeEnv } from "./runtime-env.js";

export default definePluginEntry({
  id: "onevcat-runtime-identity",
  name: "onevcat Runtime Identity",
  description: "Projects OpenClaw execution identity into local exec environments",
  register(api: OpenClawPluginApi) {
    api.on("resolve_exec_env", (event, context) =>
      resolveOpenClawExecRuntimeEnv({
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        eventSessionKey: event.sessionKey,
        sessionId: context.sessionId,
      }),
    );
  },
});
