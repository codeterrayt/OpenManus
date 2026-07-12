// src/tools/docker_cli.js
// Full Docker CLI access — runs any `docker` command directly on the host.
//
// The agent can do EVERYTHING docker supports:
//   docker run, build, compose, exec, network, volume, logs, inspect, ps, ...
//
// Output is streamed and returned as { stdout, stderr, exitCode }.

import { spawn } from 'child_process';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes (pulls/builds can take a while)

/**
 * Run any Docker CLI command on the host.
 *
 * @param {string}   command     - The docker sub-command + args, e.g. "ps -a" or "run -d -p 3000:3000 nginx"
 * @param {number}   [timeoutMs] - Optional timeout override in ms
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export async function runDockerCli(command, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // Split command string into argv safely (handles quoted strings naively — enough for LLM use)
  const args = parseArgs(command);

  console.log(`[DockerCLI] docker ${args.join(' ')}`);

  return new Promise((resolve) => {
    const proc = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];

    proc.stdout.on('data', (d) => {
      process.stdout.write(`[DockerCLI] ${d}`);
      stdout.push(d);
    });

    proc.stderr.on('data', (d) => {
      process.stderr.write(`[DockerCLI] ${d}`);
      stderr.push(d);
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      stderr.push(Buffer.from(`\n[Timeout] docker command timed out after ${timeoutMs / 1000}s\n`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf-8').trimEnd(),
        stderr: Buffer.concat(stderr).toString('utf-8').trimEnd(),
        exitCode: code ?? 0,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: `Failed to spawn docker: ${err.message}\nMake sure Docker Desktop is running and "docker" is on PATH.`,
        exitCode: 1,
      });
    });
  });
}

/**
 * Minimal shell-like argument parser.
 * Handles: plain tokens, "quoted strings", 'single quotes'.
 */
function parseArgs(command) {
  const args = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (inDouble) {
      if (ch === '"') { inDouble = false; }
      else { current += ch; }
    } else if (inSingle) {
      if (ch === "'") { inSingle = false; }
      else { current += ch; }
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }

  if (current) args.push(current);
  return args;
}
