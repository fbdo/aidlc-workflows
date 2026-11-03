// harness/jcode/emit.ts - the jcode per-shell emission plugin.
//
// The unified packager copies core/ into dist/jcode/.jcode/ and then calls this
// emit() for the one file that is CODE rather than declarative data: the
// project's [hooks] table in .jcode/config.toml. jcode reads only that table
// from a project config, and runs it only after `jcode trust grant`.
//
// Every row points at the one authored adapter through the dispatcher's own
// `adapter jcode <target>` route, so the native runtime and the copy channel
// spell it the way the packager projects every other harness's hooks.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EmitContext } from "../../scripts/manifest-types.ts";
import { EXTENDED_SUBPROCESS_TIMEOUT_MS } from "../../core/tools/aidlc-runtime-budget.ts";

// jcode clamps a project's hook timeouts to its global project_timeout_cap_ms
// (120000 by default) and user_prompt_submit to 30000, so the extended budget
// is asked for up to those limits and the cap decides.
const PROJECT_TIMEOUT_CAP_MS = 120_000;
const PROMPT_TIMEOUT_CAP_MS = 30_000;
function timeoutMs(event: string): number {
  const cap = event === "user_prompt_submit" ? PROMPT_TIMEOUT_CAP_MS : PROJECT_TIMEOUT_CAP_MS;
  return Math.min(EXTENDED_SUBPROCESS_TIMEOUT_MS, cap);
}

// One row per jcode event with a real core-hook consumer. pre_tool and
// post_tool_feedback are the only tool seams that can block or answer the
// model, so the guards ride the first and the audit/sensor/graph follow-ups the
// second. post_tool (a detached observer) is deliberately unused.
const HOOK_WIRING: Array<{ event: string; target: string; timeout: boolean }> = [
  { event: "session_start", target: "session-start", timeout: false },
  { event: "session_end", target: "session-end", timeout: false },
  { event: "user_prompt_submit", target: "record-human-turn", timeout: true },
  { event: "pre_tool", target: "guard-tool-call", timeout: true },
  { event: "post_tool_feedback", target: "post-tool", timeout: true },
  { event: "stop", target: "continue-workflow", timeout: true },
  { event: "swarm_member_start", target: "log-subagent", timeout: false },
  { event: "swarm_member_end", target: "log-subagent", timeout: false },
];

export function emitConfigToml(
  substituteToken: (value: string) => string,
  harnessName: string,
  trustedNamespace: string,
): string {
  const lines = [
    "# AI-DLC hooks for jcode. jcode reads only this [hooks] table from a project",
    "# config and runs it after `jcode trust grant` (review with `jcode trust show`).",
    "# Editing this table asks for approval again.",
    "[hooks]",
  ];
  for (const { event, target, timeout } of HOOK_WIRING) {
    const command = substituteToken(`{{INVOKE}} ${trustedNamespace} adapter ${harnessName} ${target}`);
    lines.push(`${event} = ${JSON.stringify(command)}`);
    if (timeout) lines.push(`${event}_timeout_ms = ${timeoutMs(event)}`);
  }
  return `${lines.join("\n")}\n`;
}

export default function emit(ctx: EmitContext): void {
  const { harnessName, distRoot, harnessDir, trustedRouteNamespace, substituteToken } = ctx;
  const path = join(distRoot, harnessDir, "config.toml");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, emitConfigToml(substituteToken, harnessName, trustedRouteNamespace), "utf-8");
}
