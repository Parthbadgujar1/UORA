/**
 * Single-process-group launcher for Hostinger "single app / single root"
 * deployment.
 *
 * Hostinger's Node.js app UI only supports one root directory, one build
 * command and one start command per app. This repo has two separate
 * Node apps (backend Express API + frontend Next.js site). This script
 * runs both under a single "start" command:
 *
 *   - The backend API listens on an INTERNAL-only port (BACKEND_PORT,
 *     default 5000) that is never exposed publicly by Hostinger.
 *   - The frontend Next.js server listens on the PUBLIC port Hostinger
 *     assigns (process.env.PORT), and its built-in rewrite
 *     ("/api/:path*" -> BACKEND_URL) proxies browser calls to the
 *     backend over localhost.
 *
 * IMPORTANT: the two processes are supervised INDEPENDENTLY. If the
 * backend crashes (e.g. a database connection problem), it is restarted
 * on its own with a short backoff -- it does NOT take the frontend down,
 * so visitors keep getting pages/assets even while the backend is
 * recovering. Same in reverse. This process only exits (letting
 * Hostinger's own supervisor restart it) if a child fails repeatedly in
 * a tight loop, which usually means a real config problem worth surfacing
 * in the platform's crash/restart logs.
 */

const { spawn } = require("child_process");
const path = require("path");

const BACKEND_PORT = process.env.BACKEND_PORT || "5000";
const PUBLIC_PORT = process.env.PORT || "3000";

const RESTART_DELAY_MS = 3000;
const CRASH_LOOP_WINDOW_MS = 60000;
const CRASH_LOOP_THRESHOLD = 8; // exits within the window before we give up

function log(prefix, chunk) {
  chunk
    .toString()
    .split("\n")
    .filter(Boolean)
    .forEach((line) => console.log(`[${prefix}] ${line}`));
}

function supervise(name, spawnFn) {
  let recentExits = [];

  function start() {
    console.log(`[supervisor] starting ${name}...`);
    const child = spawnFn();
    child.stdout.on("data", (d) => log(name, d));
    child.stderr.on("data", (d) => log(name, d));

    child.on("exit", (code, signal) => {
      console.error(
        `[supervisor] ${name} exited (code=${code} signal=${signal})`
      );

      const now = Date.now();
      recentExits = recentExits.filter((t) => now - t < CRASH_LOOP_WINDOW_MS);
      recentExits.push(now);

      if (recentExits.length >= CRASH_LOOP_THRESHOLD) {
        console.error(
          `[supervisor] ${name} crashed ${recentExits.length} times in the ` +
            `last ${CRASH_LOOP_WINDOW_MS / 1000}s -- this is a real config ` +
            `problem (check DATABASE_URL / env vars / logs above), not a ` +
            `transient blip. Exiting so the platform can flag/restart the app.`
        );
        process.exit(1);
        return;
      }

      setTimeout(start, RESTART_DELAY_MS);
    });
  }

  start();
}

supervise("backend", () =>
  spawn("node", ["dist/server.js"], {
    cwd: path.join(__dirname, "backend"),
    env: { ...process.env, PORT: BACKEND_PORT },
  })
);

supervise("frontend", () =>
  spawn("npx", ["next", "start", "-p", PUBLIC_PORT], {
    cwd: path.join(__dirname, "frontend"),
    env: {
      ...process.env,
      PORT: PUBLIC_PORT,
      BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    },
    shell: process.platform === "win32",
  })
);
