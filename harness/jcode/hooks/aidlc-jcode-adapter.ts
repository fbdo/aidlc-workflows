#!/usr/bin/env bun
// aidlc-jcode-adapter.ts - the jcode hook shim (AUTHORED shell file; the
// aidlc-*.ts hook bodies beside it are PACKAGED core, byte-shared with the
// Claude Code harness). One shim normalizes jcode's hook contract to the
// ClaudeCodeHookInput shape the core hooks read and runs the named core hook,
// the way the Codex and Cursor adapters do.
//
// What jcode gives a hook (jcode docs/HOOKS.md, "Project hooks and trust"):
//   - the event, tool name and session as JCODE_HOOK_* env vars, all of it also
//     as JSON in JCODE_HOOK_PAYLOAD; the tool input as JSON on stdin for the
//     tool hooks, a Claude-shaped document on stdin for user_prompt_submit,
//     stop and the swarm member hooks;
//   - tool names in lowercase (bash, write, edit, apply_patch, read, swarm);
//     edits through apply_patch carry the paths inside `patch_text`;
//   - observers (session_start, session_end, swarm_member_*) are fire and
//     forget: their output goes nowhere. Context for the model rides
//     user_prompt_submit stdout, or post_tool_feedback stdout for a tool call.
//
// Output contracts used here:
//   - pre_tool: exit 2 blocks the call and stderr is the model's tool error;
//     a JSON object with hookSpecificOutput.updatedInput rewrites the input.
//   - user_prompt_submit / post_tool_feedback: plain stdout is added for the
//     model (a hidden reminder, or under the tool result).
//   - stop: {"decision":"block","reason"} keeps the turn going.
//   Every hook fails open (exit 0) on anything it cannot read.
//
// Usage (wired in .jcode/config.toml):
//   bun .jcode/hooks/aidlc-jcode-adapter.ts <target>
// where <target> is session-start | session-end | record-human-turn |
//   guard-tool-call | post-tool | continue-workflow | log-subagent

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readSessionBinding,
  runHookHere,
  sessionsDir,
  validSessionId,
} from "../tools/aidlc-lib.ts";

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

type Json = Record<string, unknown>;

interface CoreCall {
  tool_name: string;
  tool_input: Json;
}

function asRecord(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function parseJson(text: string): Json {
  if (!text.trim()) return {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

// The files a `*** Begin Patch` envelope touches, as the core hooks name them:
// Add is a Write, Update an Edit. `deletes` also lists Delete File and Move to,
// which are writes to those paths for the guards.
function patchedFiles(
  patch: string,
  projectDir: string,
): { written: Array<{ path: string; tool: "Write" | "Edit" }>; deletes: string[] } {
  const absolute = (rel: string): string => (isAbsolute(rel) ? rel : join(projectDir, rel));
  const written: Array<{ path: string; tool: "Write" | "Edit" }> = [];
  for (const m of patch.matchAll(/^\*\*\* (Add|Update) File: (.+)$/gm)) {
    written.push({ path: absolute(m[2].trim()), tool: m[1] === "Add" ? "Write" : "Edit" });
  }
  const deletes: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Delete File|Move to): (.+)$/gm)) {
    deletes.push(absolute(m[1].trim()));
  }
  return { written, deletes };
}

// jcode's lowercase tools as the Claude-shaped calls the core hooks understand.
export function coreCalls(toolName: string, input: Json, projectDir: string): CoreCall[] {
  switch (toolName) {
    case "bash":
      return typeof input.command === "string" ? [{ tool_name: "Bash", tool_input: { command: input.command } }] : [];
    case "read":
      return typeof input.file_path === "string" ? [{ tool_name: "Read", tool_input: { file_path: input.file_path } }] : [];
    case "write":
      return typeof input.file_path === "string" ? [{ tool_name: "Write", tool_input: { file_path: input.file_path } }] : [];
    case "edit":
      return typeof input.file_path === "string" ? [{ tool_name: "Edit", tool_input: { file_path: input.file_path } }] : [];
    case "apply_patch": {
      const { written, deletes } = patchedFiles(typeof input.patch_text === "string" ? input.patch_text : "", projectDir);
      return [
        ...written.map((f) => ({ tool_name: f.tool, tool_input: { file_path: f.path } })),
        ...deletes.map((path) => ({ tool_name: "Edit", tool_input: { file_path: path } })),
      ];
    }
    default:
      return [];
  }
}

// The text of a core hook's JSON context output, for the channels jcode adds
// to the model's view as plain text.
function feedbackText(coreStdout: string): string {
  const text = contextText(coreStdout);
  if (text) return text;
  const message = asRecord(parseJson(coreStdout)).systemMessage;
  return typeof message === "string" ? message : "";
}

function contextText(coreStdout: string): string {
  const trimmed = coreStdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as Json;
    const specific = asRecord(parsed.hookSpecificOutput);
    for (const value of [parsed.additionalContext, specific.additionalContext]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  } catch {
    return trimmed;
  }
}

function startedSessions(projectDir: string): string {
  return join(sessionsDir(projectDir), "jcode-sessions");
}

// jcode reports the agent definition name, else the spawn label, as the agent
// type. A worker is delegated only when that names an AI-DLC persona (not just
// the label) or when its coordinator is already bound to an intent here. A
// label-only worker under an unbound coordinator is the conductor itself.
function delegatedAgentType(projectDir: string): string {
  const type = process.env.JCODE_HOOK_AGENT_TYPE ?? "";
  if (!type) return "";
  if (type !== (process.env.JCODE_HOOK_SWARM_LABEL ?? "") && /^aidlc-.+-agent$/.test(type)) return type;
  const coordinator = validSessionId(process.env.JCODE_HOOK_COORDINATOR_SESSION_ID);
  if (!coordinator) return "";
  return readSessionBinding(projectDir, coordinator)?.intent ? type : "";
}

export async function run(target: string, input: string, _extraArgs: string[] = []): Promise<number> {
  const envPayload = parseJson(process.env.JCODE_HOOK_PAYLOAD ?? "");
  const stdinJson = parseJson(input);
  const projectDirRaw = process.env.JCODE_PROJECT_DIR ?? process.env.AIDLC_PROJECT_DIR ??
    process.env.JCODE_HOOK_CWD ?? (typeof stdinJson.cwd === "string" ? stdinJson.cwd : process.cwd());
  const projectDir = isAbsolute(projectDirRaw) ? projectDirRaw : resolve(process.cwd(), projectDirRaw);
  const sessionId = validSessionId(
    process.env.JCODE_HOOK_SESSION_ID ??
      (typeof stdinJson.session_id === "string" ? stdinJson.session_id : undefined),
  );
  if (sessionId) {
    process.env.AIDLC_SESSION_OVERRIDE = sessionId;
    process.env.AIDLC_SESSION_OVERRIDE_SOURCE = "payload";
  }
  if (sessionId) {
    // Liveness for the engine: its `next` and doctor warn when this is missing.
    try {
      mkdirSync(startedSessions(projectDir), { recursive: true });
      writeFileSync(join(startedSessions(projectDir), `${sessionId}.hooked`), "", "utf-8");
    } catch {
      // observability only
    }
  }
  const toolName = process.env.JCODE_HOOK_TOOL_NAME ?? (typeof envPayload.tool_name === "string" ? envPayload.tool_name : "");
  const agentType = delegatedAgentType(projectDir);
  const projectPins = { AIDLC_PROJECT_DIR: projectDir, CLAUDE_PROJECT_DIR: projectDir };
  const projectEnv = { ...process.env, ...projectPins };

  // A core hook as a child process: the compiled engine runs it through its own
  // `engine hook` route, the Bun channel runs the file. The human-turn record
  // carries a one-time authority token the engine checks.
  function runCoreChild(hookFile: string, payload: string): { stdout: string; stderr: string; code: number } {
    const executable = process.env.AIDLC_COMPILED_EXECUTABLE;
    const hook = hookFile.replace(/^aidlc-|\.ts$/g, "");
    const token = hook === "record-human-turn" ? randomUUID() : "";
    const command = executable
      ? token
        ? [executable, "--internal-aidlc-record-human-turn", join(HOOKS_DIR, hookFile)]
        : [executable, "engine", "hook", hook]
      : token
        ? [process.execPath, join(HOOKS_DIR, "..", "tools", "aidlc.ts"), "--internal-aidlc-record-human-turn", join(HOOKS_DIR, hookFile)]
        : [process.execPath, join(HOOKS_DIR, hookFile)];
    const r = Bun.spawnSync(command, {
      stdin: Buffer.from(payload, "utf-8"),
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectDir,
      env: token ? { ...projectEnv, AIDLC_INTERNAL_HUMAN_TURN_TOKEN: token } : projectEnv,
    });
    return { stdout: r.stdout?.toString() ?? "", stderr: r.stderr?.toString() ?? "", code: r.exitCode ?? 0 };
  }

  // The hooks that run on every tool call run in this process, so a call costs
  // one engine load; one that cannot be imported runs as a child.
  async function runCore(hookFile: string, payload: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return (await runHookHere(join(HOOKS_DIR, hookFile), payload, projectPins)) ?? runCoreChild(hookFile, payload);
  }

  switch (target) {
    case "session-start": {
      // An observer: its output is dropped, so it only leaves the source
      // (create, attach or resume) for the first prompt to start the session
      // with, which is where context can reach the model.
      if (!sessionId) return 0;
      try {
        mkdirSync(startedSessions(projectDir), { recursive: true });
        const marker = join(startedSessions(projectDir), `${sessionId}.pending`);
        if (!existsSync(join(startedSessions(projectDir), `${sessionId}.started`))) {
          writeFileSync(marker, process.env.JCODE_HOOK_SOURCE ?? "create", "utf-8");
        }
      } catch {
        // observability only
      }
      return 0;
    }

    case "session-end": {
      if (!sessionId) return 0;
      await runCore("aidlc-session-end.ts", JSON.stringify({ reason: "jcode session closed", session_id: sessionId }));
      try {
        rmSync(join(startedSessions(projectDir), `${sessionId}.started`), { force: true });
        rmSync(join(startedSessions(projectDir), `${sessionId}.pending`), { force: true });
        rmSync(join(startedSessions(projectDir), `${sessionId}.hooked`), { force: true });
      } catch {
        // observability only
      }
      return 0;
    }

    case "record-human-turn": {
      // user_prompt_submit. Only the person's own message counts: a worker's
      // brief, an auto-poke, a swarm message or a background wake is the
      // agent speaking.
      const origin = asRecord(stdinJson.origin);
      if (origin.kind !== "person") return 0;
      const prompt = typeof stdinJson.prompt === "string" ? stdinJson.prompt : "";
      const out: string[] = [];
      // The session's first message starts it: SESSION_STARTED (or _RESUMED)
      // and the workflow context, which an observer hook cannot hand over.
      if (sessionId) {
        const dir = startedSessions(projectDir);
        const started = join(dir, `${sessionId}.started`);
        if (!existsSync(started)) {
          let source = "startup";
          try {
            const pending = join(dir, `${sessionId}.pending`);
            if (existsSync(pending)) {
              source = readFileSync(pending, "utf-8").trim() === "resume" ? "resume" : "startup";
              rmSync(pending, { force: true });
            }
            mkdirSync(dir, { recursive: true });
            writeFileSync(started, source, "utf-8");
          } catch {
            // start anyway
          }
          const start = await runCore(
            "aidlc-session-start.ts",
            JSON.stringify({ hook_event_name: "SessionStart", source, session_id: sessionId }),
          );
          const context = contextText(start.stdout);
          if (context) out.push(context);
        }
      }
      const turn = runCoreChild(
        "aidlc-record-human-turn.ts",
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          ...(sessionId ? { session_id: sessionId } : {}),
          prompt,
        }),
      );
      const note = contextText(turn.stdout);
      if (note) out.push(note);
      if (out.length > 0) process.stdout.write(`${out.join("\n\n")}\n`);
      return 0;
    }

    case "guard-tool-call": {
      // pre_tool. The guards run in order, every one even after a refusal; the
      // call is refused when any member refuses, each refusal once on stderr.
      // The stage rules a swarm spawn carries are attached last.
      const calls = coreCalls(toolName, stdinJson, projectDir);
      const base = {
        hook_event_name: "PreToolUse",
        ...(sessionId ? { session_id: sessionId } : {}),
        cwd: projectDir,
        ...(agentType ? { agent_type: agentType } : {}),
        ...(process.env.JCODE_HOOK_AGENT_ID ? { agent_id: process.env.JCODE_HOOK_AGENT_ID } : {}),
      };
      const guards = [
        "aidlc-state-transition-guard.ts",
        "aidlc-reviewer-scope.ts",
        "aidlc-review-freeze.ts",
        "aidlc-plan-approval-guard.ts",
      ];
      const refusals: string[] = [];
      for (const call of calls) {
        const payload = JSON.stringify({ ...base, ...call });
        for (const guard of guards) {
          const r = await runCore(guard, payload);
          if (r.code === 2 && r.stderr && !refusals.includes(r.stderr)) refusals.push(r.stderr);
        }
      }
      if (refusals.length > 0) {
        process.stderr.write(refusals.join(""));
        return 2;
      }
      if (toolName === "swarm" && stdinJson.action === "spawn" && typeof stdinJson.agent === "string") {
        const promptField = ["initial_message", "prompt", "message"].find((k) => typeof stdinJson[k] === "string") ?? "initial_message";
        const brief = typeof stdinJson[promptField] === "string" ? (stdinJson[promptField] as string) : "";
        const dispatch = {
          ...base,
          tool_name: "Task",
          tool_input: { subagent_type: stdinJson.agent, prompt: brief },
        };
        const planned = await runCore("aidlc-plan-approval-guard.ts", JSON.stringify(dispatch));
        if (planned.code === 2) {
          process.stderr.write(planned.stderr);
          return 2;
        }
        const rules = await runCore("aidlc-deliver-stage-rules.ts", JSON.stringify(dispatch));
        if (rules.code === 2) {
          process.stderr.write(rules.stderr);
          return 2;
        }
        const updated = asRecord(asRecord(parseJson(rules.stdout).hookSpecificOutput).updatedInput);
        if (typeof updated.prompt === "string" && updated.prompt !== brief) {
          process.stdout.write(`${JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: { ...stdinJson, [promptField]: updated.prompt },
            },
          })}\n`);
        }
      }
      return 0;
    }

    case "post-tool": {
      // post_tool_feedback: after a call that succeeded. File writes are audited
      // and run through the sensors; a shell call may have changed the stage
      // graph. Whatever the engine has to say rides back under the tool result.
      const out: string[] = [];
      if (toolName === "bash") {
        const r = await runCore(
          "aidlc-rebuild-stage-graph.ts",
          JSON.stringify({
            hook_event_name: "PostToolUse",
            ...(sessionId ? { session_id: sessionId } : {}),
            cwd: projectDir,
            tool_name: "Bash",
            tool_input: { command: typeof stdinJson.command === "string" ? stdinJson.command : "" },
          }),
        );
        const text = feedbackText(r.stdout);
        if (text) out.push(text);
      } else {
        for (const call of coreCalls(toolName, stdinJson, projectDir)) {
          if (call.tool_name !== "Write" && call.tool_name !== "Edit") continue;
          const payload = JSON.stringify({
            hook_event_name: "PostToolUse",
            ...(sessionId ? { session_id: sessionId } : {}),
            cwd: projectDir,
            ...call,
          });
          for (const hook of ["aidlc-write-audit-log.ts", "aidlc-run-sensors.ts"]) {
            const text = feedbackText((await runCore(hook, payload)).stdout);
            if (text) out.push(text);
          }
        }
      }
      if (out.length > 0) process.stdout.write(`${out.join("\n")}\n`);
      return 0;
    }

    case "continue-workflow": {
      // stop. A delegated worker's own stop is its lead's to judge, not this loop's.
      if (process.env.JCODE_HOOK_SWARM_ID && agentType) return 0;
      const r = runCoreChild(
        "aidlc-continue-workflow.ts",
        JSON.stringify({
          hook_event_name: "Stop",
          ...(sessionId ? { session_id: sessionId } : {}),
          cwd: projectDir,
          stop_hook_active: stdinJson.stop_hook_active === true,
        }),
      );
      if (r.stdout) process.stdout.write(r.stdout);
      return r.code === 2 ? 2 : 0;
    }

    case "log-subagent": {
      // swarm_member_start / swarm_member_end, in the coordinator's context.
      const event = typeof stdinJson.hook_event_name === "string" ? stdinJson.hook_event_name : "SubagentStop";
      await runCore(
        "aidlc-log-subagent.ts",
        JSON.stringify({
          hook_event_name: event,
          ...(sessionId ? { session_id: sessionId } : {}),
          cwd: projectDir,
          agent_type: stdinJson.agent_type,
          agent_id: stdinJson.agent_id,
          last_assistant_message: stdinJson.last_assistant_message,
        }),
      );
      return 0;
    }

    default:
      return 0;
  }
}

if (import.meta.main) {
  process.exit(await run(process.argv[2] ?? "", process.stdin.isTTY ? "" : await Bun.stdin.text(), process.argv.slice(3)));
}
