// harness/jcode/manifest.ts - the jcode distribution row.
//
// Projects the harness-neutral core/ tree into dist/jcode/.jcode/. jcode reads
// only specific files under .jcode/ (skills/, agents/, hooks via config.toml,
// prompt-overlay.md), so the engine directories (tools/, aidlc-common/,
// knowledge/, sensors/, scopes/, hooks/) are inert data to jcode and share the
// directory safely. Like Cursor, jcode consumes the standard projection with no
// emit.ts.
//
// jcode specifics (docs/HOOKS.md and docs/AGENT_DEFINITIONS.md in jcode):
//   - skills: .jcode/skills/<name>/SKILL.md, invoked as /<name> <text>. The
//     generated stage runners land there via the standard runner-gen step. The
//     .jcode directory outranks .agents/ and .claude/ for a skill of the same
//     name (skill_precedence_jcode), so a project that also has a Claude
//     install still gets this one.
//   - agents: the 14 core persona .md files in .jcode/agents/ ARE jcode agent
//     definitions (name and description frontmatter, model/effort/disallowedTools
//     as operator policy once the person trusts the project's agents). The swarm
//     tool's `agent` property targets them by name.
//   - instructions: jcode reads the root AGENTS.md and .jcode/prompt-overlay.md
//     into every new session. There is no @-import, so the method reaches a step
//     through the engine's own delivery, as on Codex.
//   - hooks: a project's [hooks] table in .jcode/config.toml, run only after the
//     person trusts the project (`jcode trust grant`).
import type { HarnessManifest } from "../../scripts/manifest-types.ts";
import onboardingFills from "./onboarding.fills.ts";

const manifest: HarnessManifest = {
  name: "jcode",
  productName: "jcode",
  configNextStep: "open jcode in this project, run `jcode trust grant` once, then run `/aidlc --doctor`",
  harnessDir: ".jcode",
  orchestratorSkillPath: ".jcode/skills/aidlc/SKILL.md",
  tierFlavor: "jcode",
  rootIntegrations: [
    {
      path: ".gitignore",
      policy: "managed-block",
      marker: "gitignore",
      shared: "union",
    },
    {
      path: "AGENTS.md",
      policy: "managed-block",
      marker: "agents",
      shared: "identical",
    },
  ],

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "aidlc-common", dst: "aidlc-common" },
    { src: "knowledge", dst: "knowledge" },
    { src: "sensors", dst: "sensors" },
    { src: "scopes", dst: "scopes" },
    { src: "agents", dst: "agents" },
    { src: "hooks", dst: "hooks" },
    { src: "skills/aidlc-session-cost", dst: "skills/aidlc-session-cost" },
    { src: "skills/aidlc-replay", dst: "skills/aidlc-replay" },
    { src: "skills/aidlc-outcomes-pack", dst: "skills/aidlc-outcomes-pack" },
    { src: "skills/aidlc-knowledge", dst: "skills/aidlc-knowledge" },
  ],

  harnessFiles: [
    { src: "skills/aidlc/SKILL.md", dst: "skills/aidlc/SKILL.md" },
    { src: "skills/aidlc/question-rendering.md", dst: "skills/aidlc/question-rendering.md" },
    { src: "skills/aidlc/composer.md", dst: "skills/aidlc/composer.md" },
    { src: "skills/aidlc/tables.md", dst: "skills/aidlc/tables.md" },
    { src: "dot-gitignore", dst: ".gitignore", projectRoot: true },
  ],

  // The root AGENTS.md stays neutral and identical to the other sharing
  // harnesses; the jcode setup lands in .jcode/prompt-overlay.md, which jcode
  // reads into every new session.
  onboarding: { dst: "AGENTS.md", projectRoot: true, harnessDst: "prompt-overlay.md", fills: onboardingFills },

  rulesRename: null,

  // Runners are explicit-only: a stage runner changes state and must not be
  // picked up by the model on its own.
  runnerFrontmatterAdditions: ["disable-model-invocation: true"],

  emit: null,

  // jcode has no plugin store: the projection uses the uniform store layout
  // without a host catalogue.
  plugin: { manifestDir: ".jcode-plugin", kind: "store", hostCatalogue: false },
};

export default manifest;
