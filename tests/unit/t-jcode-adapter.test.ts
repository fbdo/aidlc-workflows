// t-jcode-adapter: the jcode hook shim's payload conversions and the [hooks]
// table the packager emits for it.
//
// covers: hook:aidlc-record-human-turn

import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitConfigToml } from "../../harness/jcode/emit.ts";

const ROOT = join(import.meta.dir, "..", "..");

// The authored adapter imports siblings that exist only in the emitted tree,
// so the tests load it from dist/jcode, which `bun scripts/package.ts` builds.
const adapterPath = join(ROOT, "dist", "jcode", ".jcode", "hooks", "aidlc-jcode-adapter.ts");
type Call = { tool_name: string; tool_input: Record<string, unknown> };
type Adapter = { coreCalls: (tool: string, input: Record<string, unknown>, dir: string) => Call[] };
const adapter = (existsSync(adapterPath) ? await import(adapterPath) : null) as Adapter | null;
const coreCalls = (tool: string, input: Record<string, unknown>): Call[] => adapter?.coreCalls(tool, input, "/p") ?? [];

describe.skipIf(!existsSync(adapterPath))("jcode adapter conversions", () => {
  test("bash maps to Claude's Bash", () => {
    expect(coreCalls("bash", { command: "ls" })).toEqual([{ tool_name: "Bash", tool_input: { command: "ls" } }]);
  });

  test("a write is one Write, an edit one Edit, relative paths kept", () => {
    expect(coreCalls("write", { file_path: "/p/a.md" })).toEqual([{ tool_name: "Write", tool_input: { file_path: "/p/a.md" } }]);
    expect(coreCalls("edit", { file_path: "/p/b.md" })).toEqual([{ tool_name: "Edit", tool_input: { file_path: "/p/b.md" } }]);
  });

  test("apply_patch fans out per file, deletes and moves count as edits", () => {
    const patch = "*** Begin Patch\n*** Add File: n.md\n+x\n*** Update File: u.md\n*** Delete File: d.md\n*** End Patch";
    expect(coreCalls("apply_patch", { patch_text: patch })).toEqual([
      { tool_name: "Write", tool_input: { file_path: "/p/n.md" } },
      { tool_name: "Edit", tool_input: { file_path: "/p/u.md" } },
      { tool_name: "Edit", tool_input: { file_path: "/p/d.md" } },
    ]);
  });

  test("other tools are left alone", () => {
    expect(coreCalls("swarm", { action: "status" })).toEqual([]);
  });
});

describe("jcode hooks table", () => {
  const toml = emitConfigToml((s) => s.replace("{{INVOKE}}", "aidlc"), "jcode", "engine");
  const hooks = (Bun.TOML.parse(toml) as { hooks: Record<string, unknown> }).hooks;

  test("registers every wired event through the adapter route", () => {
    expect(hooks).toMatchObject({
      session_start: "aidlc engine adapter jcode session-start",
      session_end: "aidlc engine adapter jcode session-end",
      user_prompt_submit: "aidlc engine adapter jcode record-human-turn",
      pre_tool: "aidlc engine adapter jcode guard-tool-call",
      post_tool_feedback: "aidlc engine adapter jcode post-tool",
      stop: "aidlc engine adapter jcode continue-workflow",
      swarm_member_start: "aidlc engine adapter jcode log-subagent",
      swarm_member_end: "aidlc engine adapter jcode log-subagent",
    });
  });

  test("keeps timeouts inside jcode's caps", () => {
    expect(hooks.user_prompt_submit_timeout_ms).toBe(30000);
    for (const key of ["pre_tool_timeout_ms", "post_tool_feedback_timeout_ms", "stop_timeout_ms"]) {
      expect(hooks[key]).toBe(120000);
    }
  });
});

describe.skipIf(!existsSync(adapterPath))("jcode post-tool feedback", () => {
  test("a write's sensor result reaches post_tool_feedback stdout", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aidlc-jcode-post-"));
    try {
      cpSync(join(ROOT, "dist", "jcode", ".jcode"), join(tmp, ".jcode"), { recursive: true });
      const hooks = join(tmp, ".jcode", "hooks");
      writeFileSync(join(hooks, "aidlc-run-sensors.ts"),
        'export async function run(): Promise<number> {\n' +
        '  process.stdout.write(JSON.stringify({ systemMessage: "sensor: missing section" }));\n' +
        '  return 0;\n}\n');
      writeFileSync(join(hooks, "aidlc-write-audit-log.ts"), "export async function run(): Promise<number> { return 0; }\n");
      const script = `const m = await import(${JSON.stringify(join(hooks, "aidlc-jcode-adapter.ts"))});` +
        `process.exitCode = await m.run("post-tool", ${JSON.stringify(JSON.stringify({ file_path: "a.md", content: "x" }))});`;
      const r = Bun.spawnSync([process.execPath, "-e", script], {
        cwd: tmp,
        env: { ...process.env, JCODE_PROJECT_DIR: tmp, JCODE_HOOK_TOOL_NAME: "write", AIDLC_HARNESS_DIR: ".jcode" },
      });
      expect(r.stdout.toString()).toContain("sensor: missing section");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
