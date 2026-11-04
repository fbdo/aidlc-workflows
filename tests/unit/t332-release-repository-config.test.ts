// t332: the release repository is a persisted machine-config key. It resolves
// env, then machine config, then default, and it drives both the download URL
// and the attestation trust root, so `aidlc update` stays on a fork with no
// environment variable. install-apply persists the repository the installer used.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { releaseSourceCheck } from "../../core/tools/aidlc-doctor.ts";
import {
  machineConfigPath,
  readMachineConfig,
  resolvedReleaseRepository,
  writeMachineConfig,
} from "../../core/tools/aidlc-machine-config.ts";
import {
  resolvePreviewVersion,
  verifyReleaseProvenance,
  type ReleaseManifest,
} from "../../core/tools/aidlc-release.ts";

const REPO_ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const DISPATCHER = join(REPO_ROOT, "core", "tools", "aidlc.ts");
const KEYS = [
  "AIDLC_INSTALL_ROOT",
  "AIDLC_BIN_DIR",
  "AIDLC_RELEASE_REPOSITORY",
  "AIDLC_RELEASE_BASE_URL",
  "AIDLC_RELEASE_API_URL",
  "AIDLC_OFFLINE",
  "AIDLC_GH_BIN",
] as const;

let machine: string;
let saved: Record<string, string | undefined>;

function setConfig(...args: string[]) {
  return spawnSync(process.execPath, [DISPATCHER, "system", "config", "global", ...args], {
    env: { ...process.env, AIDLC_INSTALL_ROOT: machine, AIDLC_BIN_DIR: join(machine, "bin") },
    encoding: "utf-8",
  });
}

// In-process writes keep the settings cache honest; the CLI subprocess is
// covered by the first test.
function saveRepository(repository: string) {
  writeMachineConfig({ ...readMachineConfig(), "release-repository": repository });
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  machine = mkdtempSync(join(tmpdir(), "aidlc-t332-"));
  for (const key of KEYS) delete process.env[key];
  process.env.AIDLC_INSTALL_ROOT = machine;
  process.env.AIDLC_BIN_DIR = join(machine, "bin");
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(machine, { recursive: true, force: true });
});

describe("release repository machine config", () => {
  test("the key is set, read, validated and cleared like other machine keys", () => {
    expect(setConfig("set", "release-repository", "fbdo/aidlc-workflows").status).toBe(0);
    expect(JSON.parse(readFileSync(machineConfigPath(), "utf-8"))["release-repository"]).toBe(
      "fbdo/aidlc-workflows",
    );
    expect(setConfig("set", "release-repository", "not a repo").status).not.toBe(0);
    expect(setConfig("clear", "release-repository").status).toBe(0);
    expect(JSON.parse(readFileSync(machineConfigPath(), "utf-8"))["release-repository"]).toBeUndefined();
  });

  test("precedence is environment, machine config, default", () => {
    expect(resolvedReleaseRepository()).toEqual({
      repository: "awslabs/aidlc-workflows",
      source: "default",
    });
    saveRepository("fbdo/aidlc-workflows");
    expect(resolvedReleaseRepository()).toEqual({
      repository: "fbdo/aidlc-workflows",
      source: "machine config",
    });
    process.env.AIDLC_RELEASE_REPOSITORY = "other/fork";
    expect(resolvedReleaseRepository()).toEqual({
      repository: "other/fork",
      source: "environment",
    });
  });

  test("update resolves the fork from machine config with no environment variable", async () => {
    saveRepository("fbdo/aidlc-workflows");
    const fetched: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      fetched.push(String(input));
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch);
    try {
      await resolvePreviewVersion().catch(() => undefined);
    } finally {
      spy.mockRestore();
    }
    expect(fetched[0]).toContain("https://api.github.com/repos/fbdo/aidlc-workflows/releases");
    expect(fetched.join("\n")).not.toContain("awslabs");
  });

  test("attestation trust root follows the machine config repository", () => {
    saveRepository("fbdo/aidlc-workflows");
    const release = join(machine, "release");
    mkdirSync(release);
    writeFileSync(join(release, "checksums.txt"), "x\n");
    writeFileSync(join(release, "aidlc-release.intoto.jsonl"), "bundle\n");
    const log = join(machine, "gh.log");
    const gh = join(machine, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        'if [ "$3" = --help ]; then echo "--signer-workflow --source-ref --source-digest"; exit 0; fi',
        `echo "$@" > "${log}"`,
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    process.env.AIDLC_GH_BIN = gh;
    const outcome = verifyReleaseProvenance(release, { version: "2.11.3" } as ReleaseManifest);
    expect(outcome).toBe("verified");
    const args = readFileSync(log, "utf-8");
    expect(args).toContain("--repo fbdo/aidlc-workflows");
    expect(args).toContain("--signer-workflow fbdo/aidlc-workflows/.github/workflows/release.yml");
  });

  test("doctor names a non-default release source and stays quiet for the default", () => {
    expect(releaseSourceCheck()).toBeNull();
    saveRepository("fbdo/aidlc-workflows");
    expect(releaseSourceCheck()?.label).toBe(
      "Release source: fbdo/aidlc-workflows (machine config)",
    );
  });

  test("install-apply refuses an invalid repository and saves nothing", () => {
    const result = spawnSync(process.execPath, [
      DISPATCHER, "system", "lifecycle", "install-apply",
      "--from", join(machine, "missing"), "--version", "2.11.3",
      "--release-repository", "bad repo", "--quiet",
    ], { env: { ...process.env }, encoding: "utf-8" });
    expect(result.status).not.toBe(0);
    expect(readMachineConfig()["release-repository"]).toBeUndefined();
  });

  test("installers pass the chosen repository to install-apply", () => {
    const sh = readFileSync(join(REPO_ROOT, "scripts", "install.sh"), "utf-8");
    const ps1 = readFileSync(join(REPO_ROOT, "scripts", "install.ps1"), "utf-8");
    expect(sh).toContain('--release-repository "$AIDLC_RELEASE_REPOSITORY"');
    expect(ps1).toContain("'--release-repository'");
  });
});
