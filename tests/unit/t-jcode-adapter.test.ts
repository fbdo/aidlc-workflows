// t-jcode-adapter: the jcode hook shim's payload conversions and the [hooks]
// table the packager emits for it.
//
// covers: hook:aidlc-record-human-turn

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

  test("registers every wired event through the adapter route", () => {
    for (const event of [
      "session_start",
      "session_end",
      "user_prompt_submit",
      "pre_tool",
      "post_tool_feedback",
      "stop",
      "swarm_member_start",
      "swarm_member_end",
    ]) {
      expect(toml).toContain(`${event} = "aidlc engine adapter jcode `);
    }
  });

  test("keeps timeouts inside jcode's caps", () => {
    expect(toml).toContain("user_prompt_submit_timeout_ms = 30000");
    expect(toml).toContain("pre_tool_timeout_ms = 120000");
  });

  test("the built tree ships the table and the adapter", () => {
    const dist = join(ROOT, "dist", "jcode", ".jcode");
    if (!existsSync(dist)) return;
    expect(readFileSync(join(dist, "config.toml"), "utf-8")).toContain("[hooks]");
    expect(existsSync(join(dist, "hooks", "aidlc-jcode-adapter.ts"))).toBe(true);
  });
});
