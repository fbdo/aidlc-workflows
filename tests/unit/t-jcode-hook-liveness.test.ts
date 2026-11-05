// t-jcode-hook-liveness: the engine says once when jcode's project hooks have
// not fired for the chat driving it, and stays silent with a marker or outside jcode.
//
// covers: function:jcodeHooksNotRunningLine, function:jcodeHookedMarker, hook:aidlc-jcode-adapter

import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { collectDoctorReport } from "../../core/tools/aidlc-utility.ts";
import { jcodeHookedMarker, jcodeHooksNotRunningLine } from "../../core/tools/aidlc-record-core.ts";

const DIST_JCODE = join(import.meta.dir, "..", "..", "dist", "jcode");
const SID = "01jcode-session-abc";
const saved = process.env.JCODE_SESSION_ID;
const dirs: string[] = [];
afterEach(() => {
  if (saved === undefined) delete process.env.JCODE_SESSION_ID;
  else process.env.JCODE_SESSION_ID = saved;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function project(): string {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/t-jcode-live-`));
  dirs.push(dir);
  return dir;
}

describe("jcode hook liveness line", () => {
  test("under jcode with no marker: one line naming the fix", () => {
    const dir = project();
    process.env.JCODE_SESSION_ID = SID;
    const line = jcodeHooksNotRunningLine(dir);
    expect(line).toContain(`Open jcode in ${dir}`);
    expect(line).not.toContain("\n");
  });

  test("with the marker: nothing", () => {
    const dir = project();
    process.env.JCODE_SESSION_ID = SID;
    const marker = jcodeHookedMarker(dir, SID);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "");
    expect(jcodeHooksNotRunningLine(dir)).toBeNull();
  });

  test("outside jcode: nothing", () => {
    delete process.env.JCODE_SESSION_ID;
    expect(jcodeHooksNotRunningLine(project())).toBeNull();
  });
});

describe("jcode hook liveness wiring", () => {
  test("doctor warns when the hooked marker is missing and drops the row once it exists", async () => {
    const dir = project();
    mkdirSync(`${dir}/.jcode`, { recursive: true });
    writeFileSync(`${dir}/.jcode/config.toml`, '[hooks]\nsession_start = "aidlc engine adapter jcode session-start"\n');
    process.env.JCODE_SESSION_ID = SID;
    const prev = process.env.AIDLC_HARNESS_DIR;
    process.env.AIDLC_HARNESS_DIR = ".jcode";
    try {
      const row = async () =>
        (await collectDoctorReport(dir)).checks.find((c) => c.label.includes("jcode hooks have not fired"));
      const missing = await row();
      expect(missing?.pass).toBe(false);
      expect(missing?.severity).toBe("warn");
      const marker = jcodeHookedMarker(dir, SID);
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, "");
      expect(await row()).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.AIDLC_HARNESS_DIR;
      else process.env.AIDLC_HARNESS_DIR = prev;
    }
  }, 60_000);

  test.skipIf(!existsSync(DIST_JCODE))("orchestrate next carries the line under jcode, and not with the marker or outside jcode", () => {
    const dir = project();
    cpSync(DIST_JCODE, dir, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: dir });
    const notices = (env: Record<string, string>): string[] => {
      const child: Record<string, string | undefined> = { ...process.env, AIDLC_PROJECT_DIR: dir, ...env };
      delete child.JCODE_SESSION_ID;
      Object.assign(child, env);
      const r = spawnSync("bun", [`${dir}/.jcode/tools/aidlc-orchestrate.ts`, "next"], { cwd: dir, env: child, encoding: "utf-8" });
      return (JSON.parse(r.stdout) as { change_notices?: string[] }).change_notices ?? [];
    };
    expect(notices({ JCODE_SESSION_ID: SID }).join("\n")).toContain(`Open jcode in ${dir}`);
    expect(notices({}).join("\n")).not.toContain("hooks are not running");
    const marker = jcodeHookedMarker(dir, SID);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "");
    expect(notices({ JCODE_SESSION_ID: SID }).join("\n")).not.toContain("hooks are not running");
  }, 120_000);
});
