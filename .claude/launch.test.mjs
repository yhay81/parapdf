import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { configurations } = JSON.parse(await readFile(new URL("launch.json", import.meta.url)));

test("development servers have distinct ports outside the functional checks", () => {
  assert.deepEqual(configurations.map(({ name }) => name).sort(), [
    "prototype-dev",
    "site-dev",
    "site-preview",
  ]);
  const ports = configurations.map(({ port }) => port);
  assert.equal(new Set(ports).size, ports.length);
  assert.ok(ports.every((port) => port < 4179 || port > 4189));
});

// Build the site before this check so site-preview can serve the production build.
for (const { name, runtimeExecutable, runtimeArgs, port } of configurations) {
  test(`${name} serves the checkout`, async () => {
    const server = spawn(runtimeExecutable, runtimeArgs, {
      cwd: root,
      detached: true,
      stdio: "pipe",
    });
    const exited = once(server, "exit");
    let log = "";
    for (const pipe of [server.stdout, server.stderr])
      pipe.on("data", (chunk) => {
        log += chunk;
      });
    try {
      // Verify the launcher itself claimed its port before requesting it.
      const address = new URL(`http://127.0.0.1:${port}`);
      const deadline = Date.now() + 30_000;
      while (!log.includes(address.host) && Date.now() < deadline && server.exitCode === null) {
        await wait(100);
      }
      assert.ok(log.includes(address.host) && server.exitCode === null, log);
      const response = await fetch(address, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/html/);
    } finally {
      if (server.pid && server.exitCode === null) process.kill(-server.pid, "SIGTERM");
      await exited;
    }
  });
}
