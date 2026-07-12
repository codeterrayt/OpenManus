// src/tools/docker_fs.js
// File and directory management inside Docker containers.
// All operations run via `docker exec` so they work on any running container.
//
// Tools:
//   readFile   – cat a file
//   writeFile  – write/overwrite a file (content passed as string)
//   appendFile – append to a file
//   listDir    – ls -la a path
//   deleteFile – rm -rf a path
//   makeDir    – mkdir -p a path
//   moveFile   – mv src dest
//   copyFile   – cp src dest
//   statFile   – stat a path (exists? size? type?)

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { ensureSandboxRunning } from './docker.js';

const execAsync = promisify(exec);

async function getRunningContainers() {
  try {
    const { stdout } = await execAsync('docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"');
    return stdout.trim();
  } catch (err) {
    return 'Failed to list containers: ' + err.message;
  }
}

const SANDBOX = process.env.SANDBOX_CONTAINER ?? 'openmanus-sandbox';

/** Run `docker exec <container> sh -c <cmd>` and return { stdout, stderr, exitCode } */
async function execInContainer(container, shellCmd, timeoutMs = 15_000) {
  if (container === SANDBOX) {
    try {
      await ensureSandboxRunning();
    } catch (err) {
      console.warn('[DockerFS] Failed to ensure sandbox container is running:', err.message);
    }
  }

  return new Promise((resolve) => {
    const proc = spawn('docker', ['exec', container, 'sh', '-c', shellCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const out = [], err = [];
    proc.stdout.on('data', d => out.push(d));
    proc.stderr.on('data', d => err.push(d));

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      err.push(Buffer.from('\n[Timeout]\n'));
    }, timeoutMs);

    proc.on('close', async (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf-8').trimEnd();
      const stderr = Buffer.concat(err).toString('utf-8').trimEnd();

      const missingContainer = code !== 0 && (
        stderr.includes('No such container') || 
        stderr.includes('not running') || 
        stderr.includes('is not running') ||
        stderr.includes('Could not locate')
      );

      if (missingContainer) {
        const runningList = await getRunningContainers();
        resolve({
          stdout,
          stderr: `${stderr}\n\n[System Notification]: Container "${container}" was not found or is not running.\nHere are the currently running docker containers on the host:\n${runningList}\n\nPlease identify the container you created/intended to use and invoke the tool again with the correct container name, or create the container if it does not exist.`,
          exitCode: code ?? 0,
        });
      } else {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      }
    });

    proc.on('error', err2 => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: `spawn error: ${err2.message}`, exitCode: 1 });
    });
  });
}

/** Write content to a file via heredoc — handles multi-line/special chars */
function writeCmd(path, content) {
  // Base64 encode content to avoid heredoc escaping issues
  const normalized = typeof content === 'string' ? content.replace(/\r\n/g, '\n') : content;
  const b64 = Buffer.from(normalized, 'utf-8').toString('base64');
  return `echo ${b64} | base64 -d > ${path}`;
}

// ─── Exported tool functions ──────────────────────────────────────────────────

export async function readFile({ container = SANDBOX, path }) {
  if (!path) return { error: 'path is required' };
  const result = await execInContainer(container, `cat "${path}"`);
  return { ...result, path, container };
}

export async function writeFile({ container = SANDBOX, path, content }) {
  if (!path)    return { error: 'path is required' };
  if (content == null) return { error: 'content is required' };
  // Ensure parent dir exists
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (dir) await execInContainer(container, `mkdir -p "${dir}"`);
  const result = await execInContainer(container, writeCmd(path, content));
  return { ...result, path, container, note: result.exitCode === 0 ? `File written: ${path}` : 'Write failed' };
}

export async function appendFile({ container = SANDBOX, path, content }) {
  if (!path)    return { error: 'path is required' };
  if (content == null) return { error: 'content is required' };
  const normalized = typeof content === 'string' ? content.replace(/\r\n/g, '\n') : content;
  const b64 = Buffer.from(normalized, 'utf-8').toString('base64');
  const result = await execInContainer(container, `echo ${b64} | base64 -d >> "${path}"`);
  return { ...result, path, container };
}

export async function listDir({ container = SANDBOX, path = '/workspace' }) {
  const result = await execInContainer(container, `ls -la "${path}" 2>&1 && echo "---" && du -sh "${path}" 2>/dev/null`);
  return { ...result, path, container };
}

export async function deleteFile({ container = SANDBOX, path }) {
  if (!path) return { error: 'path is required' };
  const result = await execInContainer(container, `rm -rf "${path}"`);
  return { ...result, path, container, note: result.exitCode === 0 ? `Deleted: ${path}` : 'Delete failed' };
}

export async function makeDir({ container = SANDBOX, path }) {
  if (!path) return { error: 'path is required' };
  const result = await execInContainer(container, `mkdir -p "${path}"`);
  return { ...result, path, container };
}

export async function moveFile({ container = SANDBOX, src, dest }) {
  if (!src || !dest) return { error: 'src and dest are required' };
  const result = await execInContainer(container, `mv "${src}" "${dest}"`);
  return { ...result, src, dest, container };
}

export async function copyFile({ container = SANDBOX, src, dest }) {
  if (!src || !dest) return { error: 'src and dest are required' };
  const result = await execInContainer(container, `cp -r "${src}" "${dest}"`);
  return { ...result, src, dest, container };
}

export async function statFile({ container = SANDBOX, path }) {
  if (!path) return { error: 'path is required' };
  const result = await execInContainer(container, `stat "${path}" 2>&1; echo "exists=$?"`);
  return { ...result, path, container };
}

export async function findWorkspaceFiles(container = SANDBOX) {
  const cmd = `find /workspace -maxdepth 3 -type f -not -path '*/.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/__pycache__/*' 2>/dev/null`;
  const result = await execInContainer(container, cmd);
  if (result.exitCode !== 0) {
    return [];
  }
  const excludes = ['server.stdout', 'server.stderr', 'server.pid', 'script.py', 'script.js', 'script.sh'];
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('/workspace/'))
    .map(line => line.replace('/workspace/', ''))
    .filter(file => !excludes.includes(file));
}
