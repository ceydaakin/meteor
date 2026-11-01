const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../list_package_changes.sh");

// Runs the script with a fake `gh` first on PATH that records each call and
// fails, so no test reaches GitHub.
function run(t, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "list-package-changes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = path.join(dir, "gh-calls");
  fs.writeFileSync(
    path.join(dir, "gh"),
    `#!/bin/bash\necho "$*" >> "${calls}"\nexit 1\n`,
    { mode: 0o755 }
  );
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    ghCalled: fs.existsSync(calls),
  };
}

for (const [args, option] of [
  [["--output"], "--output"],
  [["--exclude-author"], "--exclude-author"],
  [["--output", "--exclude-author", "bot"], "--output"],
  [["--exclude-author", "--output", "out.json"], "--exclude-author"],
]) {
  test(`rejects ${args.join(" ")} before contacting GitHub`, (t) => {
    const { status, output, ghCalled } = run(t, args);
    assert.notEqual(status, 0);
    assert.match(output, new RegExp(`${option} requires a value`));
    assert.doesNotMatch(output, /unbound variable/);
    assert.equal(ghCalled, false);
  });
}

test("accepts options with values and goes on to the gh checks", (t) => {
  const { output, ghCalled } = run(t, [
    "--output",
    "out.json",
    "--exclude-author",
    "bot",
  ]);
  assert.doesNotMatch(output, /requires a value|Unknown option/);
  assert.equal(ghCalled, true);
});
