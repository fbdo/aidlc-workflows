// harness/jcode/onboarding.fills.ts - jcode's onboarding-doc fills.
// The packager fills core/templates/onboarding-harness.md into
// dist/jcode/.jcode/prompt-overlay.md, which jcode reads into every new session.
// The root AGENTS.md stays neutral, identical to the other sharing harnesses.

import type { OnboardingFills } from "../../scripts/onboarding.ts";

const fills: OnboardingFills = {
  invoke: "/aidlc",
  slots: {
    title_block: `# AI-DLC on jcode

This project uses AI-DLC (AI-Driven Development Life Cycle) for structured development, running on the **jcode harness**. The workspace shell ships in \`.jcode/\` (no setup command); describe what you want to build and it sets up the workflow for you. Run \`/aidlc\` followed by a scope or project description to begin (a bare \`/aidlc\` only loads the skill, so add your request on the same line). Run \`/aidlc --doctor\` to validate your setup, \`/aidlc --version\` to print the framework version, \`/aidlc --stage <slug>\` to jump to a specific stage, \`/aidlc --phase <name>\` to jump to a phase, \`/aidlc --depth <level>\` to override depth, \`/aidlc --test-strategy <level>\` to override test volume, and \`/aidlc --review <class>\` to cap stage reviews (adversarial, advisory, none). Run \`/aidlc compose "<task>"\` to get a plan tailored to that task.

Your project's name, notes and rules go in \`aidlc/spaces/default/memory/project.md\`. Every AI tool in this project reads it.`,

    prereq_bullets: `- **jcode with AI-DLC support**: \`jcode version --json\` lists \`hook_capabilities\`; AI-DLC needs \`project_hooks\`, \`project_trust\`, \`user_prompt_submit\`, \`prompt_origin\`, \`stop\`, \`swarm_identity\`, \`swarm_member_events\`, \`agent_definitions\` and \`skill_precedence_jcode\` (\`/aidlc --doctor\` checks them).
- **Trust this project once**: jcode runs a project's hooks only after you approve them. In this folder run \`jcode trust show\` to review what AI-DLC registers in \`.jcode/config.toml\`, then \`jcode trust grant\` (add \`--scope hooks\` or \`--scope agents\` to approve one part). Editing that file asks for approval again.
- **bun**: Required for the CLI tools and hook scripts (tracking progress, writing the decision log, deciding what runs next). Install via \`curl -fsSL https://bun.sh/install | bash\`. \`bun\` must be on your PATH for the shells jcode spawns.
- **Model/provider**: the shipped agent definitions pin no model. Your jcode configuration supplies the provider and default model; the personas ask for the coordinator's model (\`model: inherit\`), and the reviewers add a medium reasoning effort.
- **Auto-poke**: AI-DLC's stop hook keeps the forwarding loop going, so run \`/poke off\` in this project.`,

    prereq_bullets_tail: "",

    agents_note: `On jcode each expert role is an agent definition (\`.jcode/agents/aidlc-<role>-agent.md\`); the \`/aidlc\` session takes on those roles itself for most stages and hands work off through the \`swarm\` tool's \`spawn\` action (with \`agent\` naming the persona) for the delegated stages (2.1, 3.5), reviewer passes and Construction fan-out.`,

    structure_extra: "",

    sections_before_resumption: `## What's different on this harness

This is the same AI-DLC core that ships to every harness: the same ordered steps, the same approval gates, and the same written record of what was decided, rendered onto jcode. On jcode:

- Approval gates and questions render as **numbered prose options** (no structured-question widget); the questions FILE with \`[Answer]:\` tags remains the source of truth.
- Hooks are registered in the project's \`.jcode/config.toml\` and run only after \`jcode trust grant\`. They ride the AIDLC adapter (\`.jcode/hooks/aidlc-jcode-adapter.ts\`).
- The AI-DLC method (\`aidlc/spaces/<space>/memory/*.md\`) reaches each step through the engine itself: jcode has no include syntax for it.
- There is **no statusline**; use \`/aidlc --status\` and the progress lines at gates.
- Construction fan-out uses the \`swarm\` tool (\`spawn\` per unit with \`working_dir\` set to the unit's worktree, then \`await_members\`); \`AIDLC_USE_SWARM=1\` is a loud no-op.
- **MCP servers**: none ship (configure your own in \`.jcode/mcp.json\` if needed).
- A workflow's \`aidlc/\` workspace tree is harness-neutral: a project can move between harness installs (supported but untested - keep the trees in sync via the framework's packaging if you do this).

The jcode-specific guide (install, what differs, verification) is \`docs/guide/harnesses/jcode.md\`.
`,

    sections_after_resumption: "",
  },
};

export default fills;
