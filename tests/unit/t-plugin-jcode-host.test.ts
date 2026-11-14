// covers: function:discoverPluginInventory function:hostListsPlugins
//
// Plugin tooling recognises jcode: a .jcode workspace is the jcode host, it
// lists no plugins itself, and reading its inventory writes nothing under .claude/.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPluginInventory, hostListsPlugins } from "../../core/tools/aidlc-plugin.ts";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("plugin tooling on jcode", () => {
  test("a .jcode workspace is the jcode host and writes nothing under .claude", () => {
    dir = mkdtempSync(join(tmpdir(), "aidlc-jcode-"));
    mkdirSync(join(dir, ".jcode"), { recursive: true });
    const inventory = discoverPluginInventory(".jcode", dir);
    expect(inventory.harness).toBe("jcode");
    expect(inventory.capability).toBe("current-root-only");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  test("jcode is a non-listing host", () => {
    expect(hostListsPlugins("jcode")).toBe(false);
  });
});
