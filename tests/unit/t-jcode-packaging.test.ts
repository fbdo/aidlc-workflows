// t-jcode-packaging: dist/jcode determinism + shell shape.
//
// covers: file:harness/jcode/manifest.ts, file:core/tools/aidlc-tiers.ts
//
// WHAT. Five contracts:
//   (1) `bun scripts/package.ts jcode --check` produces byte-identical clean builds.
//   (2) Core parity: every .ts under dist/jcode/.jcode/{tools,hooks}/ differs from
//       its dist/claude twin only at the declared projection token.
//   (3) The jcode-native surfaces are shaped for jcode's scanners: skills in
//       .jcode/skills (the orchestrator, a stage runner, the session skills), the
//       14 personas as agent definitions with the jcode tier flavour, the native
//       onboarding in .jcode/prompt-overlay.md, a neutral root AGENTS.md.
//   (4) The orchestrator skill speaks jcode (swarm spawn with `agent`, trust, no
//       Cursor or Claude words), and the protocol modules ship only the jcode
//       binding subsection.
//   (5) The tier table projects `model: inherit` for every tier, with a medium
//       effort only on the balanced (reviewer) tier.

import { describe, expect, test, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../harness/fixtures.ts";
import {
  NATIVE_FIXTURE_SETUP_TIMEOUT_MS,
  remainingOperationTimeoutMs,
} from "../harness/test-budget.ts";
import { projectTier } from "../../core/tools/aidlc-tiers.ts";

setDefaultTimeout(NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

const PACKAGE_SCRIPT = join(REPO_ROOT, "scripts", "package.ts");
const CLAUDE_SRC = join(REPO_ROOT, "dist", "claude", ".claude");
const JCODE_ROOT = join(REPO_ROOT, "dist", "jcode");
const ENGINE = join(JCODE_ROOT, ".jcode");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function frontmatter(path: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf-8"));
  if (!match) throw new Error(`${path}: no frontmatter`);
  return match[1];
}

describe("t-jcode-packaging dist/jcode determinism + shell shape", () => {
  test("1: jcode package generation is deterministic", () => {
    const r = spawnSync("bun", [PACKAGE_SCRIPT, "jcode", "--check"], {
      timeout: remainingOperationTimeoutMs(NATIVE_FIXTURE_SETUP_TIMEOUT_MS),
      encoding: "utf-8",
      cwd: REPO_ROOT,
    });
    if (r.status !== 0) console.error(r.stderr);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("deterministic across two independent build(s) for jcode");
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("2: packaged .ts files differ only at declared projection tokens", () => {
    const divergent: string[] = [];
    for (const sub of ["tools", "hooks"]) {
      const dstDir = join(ENGINE, sub);
      for (const file of walk(dstDir)) {
        if (!file.endsWith(".ts")) continue;
        const rel = file.slice(dstDir.length + 1);
        // Authored adapters have no Claude twin.
        if (rel === "aidlc-jcode-adapter.ts") continue;
        const src = join(CLAUDE_SRC, sub, rel);
        const jcode = readFileSync(file, "utf-8").replaceAll(
          "bun .jcode/tools/aidlc.ts",
          "bun .claude/tools/aidlc.ts",
        );
        if (jcode !== readFileSync(src, "utf-8")) divergent.push(`${sub}/${rel}`);
      }
    }
    expect(divergent).toEqual([]);
  });

  test("3: skills, agent definitions and onboarding land where jcode reads them", () => {
    const skills = readdirSync(join(ENGINE, "skills"));
    for (const name of [
      "aidlc",
      "aidlc-bugfix",
      "aidlc-code-generation",
      "aidlc-session-cost",
      "aidlc-replay",
      "aidlc-outcomes-pack",
      "aidlc-knowledge",
    ]) {
      expect(skills, name).toContain(name);
      expect(existsSync(join(ENGINE, "skills", name, "SKILL.md")), name).toBe(true);
    }
    const agents = readdirSync(join(ENGINE, "agents")).filter((f) => f.endsWith("-agent.md"));
    expect(agents.length).toBe(14);
    for (const file of agents) {
      const fm = frontmatter(join(ENGINE, "agents", file));
      expect(fm, file).toMatch(/^name: aidlc-[a-z-]+-agent$/m);
      expect(fm, file).toMatch(/^description:/m);
      expect(fm, file).toMatch(/^model: inherit$/m);
      expect(fm, file).not.toMatch(/^tier:/m);
    }
    const overlay = readFileSync(join(ENGINE, "prompt-overlay.md"), "utf-8");
    expect(overlay).toContain("jcode trust grant");
    expect(overlay).toContain("# AI-DLC on jcode");
    const root = readFileSync(join(JCODE_ROOT, "AGENTS.md"), "utf-8");
    expect(root).not.toContain("jcode trust grant");
    expect(readFileSync(join(JCODE_ROOT, ".gitignore"), "utf-8")).toContain("aidlc/active-memory/");
    const harness = JSON.parse(readFileSync(join(ENGINE, "tools", "data", "harness.json"), "utf-8"));
    expect(harness.name).toBe("jcode");
    expect(harness.harnessDir).toBe(".jcode");
  });

  test("4: the orchestrator skill and protocol modules are jcode's own", () => {
    const skill = readFileSync(join(ENGINE, "skills", "aidlc", "SKILL.md"), "utf-8");
    expect(skill).toContain("(jcode harness)");
    expect(skill).toContain("`swarm` tool");
    expect(skill).toContain(".jcode/agents/");
    expect(skill).not.toMatch(/cursor/i);
    expect(skill).not.toContain("AskUserQuestion");
    expect(skill).toContain("bun .jcode/tools/aidlc.ts engine orchestrate next $ARGUMENTS");
    for (const module of ["construction", "ensemble", "reviewer", "swarm"]) {
      const text = readFileSync(
        join(ENGINE, "aidlc-common", "protocols", `stage-protocol-${module}.md`),
        "utf-8",
      );
      expect(text, module).toContain("### jcode");
      for (const other of ["### Claude Code", "### Kiro CLI", "### Codex CLI", "### Cursor", "### opencode"]) {
        expect(text, `${module} ${other}`).not.toContain(other);
      }
    }
    const swarm = readFileSync(
      join(ENGINE, "aidlc-common", "protocols", "stage-protocol-swarm.md"),
      "utf-8",
    );
    expect(swarm).toContain("`working_dir` set to that unit's worktree");
    expect(swarm).toContain("`await_members`");
  });

  test("5: the tier table projects inherit everywhere, medium effort on reviewers", () => {
    expect(projectTier("judgment", "jcode")).toEqual({ model: "inherit", effort: null });
    expect(projectTier("templated", "jcode")).toEqual({ model: "inherit", effort: null });
    expect(projectTier("balanced", "jcode")).toEqual({ model: "inherit", effort: "medium" });
    for (const reviewer of ["aidlc-architecture-reviewer-agent", "aidlc-product-lead-agent"]) {
      expect(frontmatter(join(ENGINE, "agents", `${reviewer}.md`))).toMatch(/^effort: medium$/m);
    }
    expect(frontmatter(join(ENGINE, "agents", "aidlc-architect-agent.md"))).not.toMatch(/^effort:/m);
  });
});
