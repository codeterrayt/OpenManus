// src/tools/docker.js
// Phase 3 — Docker Execution Sandbox
//
// Spins up an ephemeral container, writes the script to stdin via a tar stream,
// executes it, captures stdout + stderr, then destroys the container — all within
// the configured timeout window.

import Dockerode  from 'dockerode';
import tarStream  from 'tar-stream';
import { config } from '../config.js';

// ─── Docker client ────────────────────────────────────────────────────────────
const dockerOptions = config.docker.host
  ? (() => {
      // e.g. "tcp://localhost:2375"
      const url = new URL(config.docker.host);
      return { host: url.hostname, port: Number(url.port) };
    })()
  : {}; // empty → use platform default socket

const docker = new Dockerode(dockerOptions);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds an in-memory tar archive containing a single file.
 * Dockerode's putArchive requires a tar stream to copy files into a container.
 *
 * @param {string} filename  - e.g. "script.py"
 * @param {string} content   - the script source code
 * @returns {Promise<Buffer>}
 */
async function buildTar(filename, content) {
  return new Promise((resolve, reject) => {
    const pack = tarStream.pack();
    const buf  = content instanceof Buffer ? content : Buffer.from(content, 'utf-8');

    pack.entry({ name: filename, size: buf.length }, buf, (err) => {
      if (err) return reject(err);
      pack.finalize();
    });

    const chunks = [];
    pack.on('data',  (d) => chunks.push(d));
    pack.on('end',   ()  => resolve(Buffer.concat(chunks)));
    pack.on('error', reject);
  });
}

/**
 * Drains a Docker multiplexed stream (as returned by container.attach / exec.start)
 * and returns { stdout, stderr } strings.
 *
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function drainStream(stream) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];

    docker.modem.demuxStream(stream, {
      write: (chunk) => stdout.push(chunk),
    }, {
      write: (chunk) => stderr.push(chunk),
    });

    stream.on('end',   () => resolve({
      stdout: Buffer.concat(stdout).toString('utf-8').trimEnd(),
      stderr: Buffer.concat(stderr).toString('utf-8').trimEnd(),
    }));
    stream.on('error', reject);
  });
}

/**
 * Verifies if a Docker image exists locally. If not, pulls it from the registry.
 *
 * @param {string} imageName
 * @returns {Promise<void>}
 */
async function ensureImage(imageName) {
  try {
    await docker.getImage(imageName).inspect();
    console.log(`[Docker] Image "${imageName}" is present locally.`);
  } catch (err) {
    if (err.statusCode === 404) {
      console.log(`[Docker] Image "${imageName}" not found locally. Pulling image...`);
      await new Promise((resolve, reject) => {
        docker.pull(imageName, (pullErr, stream) => {
          if (pullErr) return reject(pullErr);
          docker.modem.followProgress(stream, onFinished);
          function onFinished(finishedErr, output) {
            if (finishedErr) return reject(finishedErr);
            console.log(`[Docker] Successfully pulled image "${imageName}"`);
            resolve(output);
          }
        });
      });
    } else {
      throw err;
    }
  }
}

let activeContainer = null;
let activeLang      = null;
let activeImage     = null;
let activePorts     = [];

export const SANDBOX_CONTAINER_NAME = process.env.SANDBOX_CONTAINER ?? 'openmanus-sandbox';

/**
 * Stop and force-remove the active persistent container.
 * Resets the active workspace status.
 */
export async function cleanupSandbox() {
  if (activeContainer) {
    console.log('[Docker] Cleaning up active persistent sandbox container...');
    try {
      await activeContainer.remove({ force: true });
      console.log('[Docker] Active sandbox container removed');
    } catch (err) {
      console.warn('[Docker] Error removing sandbox container during cleanup:', err.message);
    } finally {
      activeContainer = null;
      activeLang      = null;
      activeImage     = null;
      activePorts     = [];
    }
  }
}

// ─── Pull image tool ──────────────────────────────────────────────────────────

/**
 * Pulls a Docker image from a registry with live progress output.
 *
 * @param {string} imageName - e.g. "node:22-slim", "postgres:16", "ubuntu:24.04"
 * @returns {Promise<{ success: boolean, image: string, message: string }>}
 */
export async function pullImage(imageName) {
  // Check if already present
  try {
    await docker.getImage(imageName).inspect();
    const msg = `Image "${imageName}" is already present locally — no pull needed.`;
    console.log(`[Docker] ${msg}`);
    return { success: true, image: imageName, message: msg };
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  console.log(`[Docker] Pulling image "${imageName}" from registry...`);

  return new Promise((resolve, reject) => {
    docker.pull(imageName, (pullErr, stream) => {
      if (pullErr) return reject(pullErr);

      let lastStatus = '';
      docker.modem.followProgress(
        stream,
        (finishedErr) => {
          if (finishedErr) {
            console.error(`[Docker] Pull failed: ${finishedErr.message}`);
            return reject(finishedErr);
          }
          const msg = `Image "${imageName}" pulled successfully.`;
          console.log(`[Docker] ${msg}`);
          resolve({ success: true, image: imageName, message: msg });
        },
        (event) => {
          // Log progress without spamming every layer line
          const status = event.status ?? '';
          if (status !== lastStatus) {
            console.log(`[Docker] ${status}${event.id ? ` (${event.id})` : ''}`);
            lastStatus = status;
          }
        }
      );
    });
  });
}

// ─── Public run tool ──────────────────────────────────────────────────────────


/**
 * Executes a script inside a persistent Docker container sandbox.
 * Keeps the container alive throughout the session to persist installed libraries
 * and generated workspace assets.
 *
 * @param {object} params
 * @param {string}   params.code     - The script source code to run
 * @param {"python"|"javascript"|"bash"} params.lang - Runtime language
 * @param {string}   [params.image]  - Override the default Docker image
 * @param {number[]} [params.ports]  - Host ports to expose from the container (e.g. [3000, 8080])
 *
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, accessUrls?: string[] }>}
 */
/**
 * Ensures that the persistent sandbox container is created, configured, and running.
 * Recreates the container if there is an image mismatch or host network mismatch.
 *
 * @param {string} [lang="python"] - The language configuration to use for the image
 * @param {string} [image] - Optional override image
 * @returns {Promise<Dockerode.Container>}
 */
export async function ensureSandboxRunning(lang = 'python', image = null) {
  const langKey = lang === 'javascript' ? 'node' : lang;
  const defaultImageForLang = config.docker.images[langKey];
  const targetImage = image || defaultImageForLang || (lang === 'javascript' ? 'node:22-slim' : 'python:3.12-slim');

  if (activeContainer && activeImage === targetImage) {
    return activeContainer;
  }

  let existingImage = null;
  try {
    const existingContainer = docker.getContainer(SANDBOX_CONTAINER_NAME);
    const info = await existingContainer.inspect();
    existingImage = info.Config.Image;
  } catch (err) {
    // Ignore 404
  }
  
  let resolvedImage = image;
  if (!resolvedImage) {
    if (existingImage) {
      // If we have an existing image, keep using it unless a switch between node and python is requested
      const isExistingPython = existingImage.includes('python');
      const isExistingNode = existingImage.includes('node');
      
      if (lang === 'python' && isExistingNode) {
        resolvedImage = defaultImageForLang ?? 'python:3.12-slim';
      } else if (lang === 'javascript' && isExistingPython) {
        resolvedImage = defaultImageForLang ?? 'node:22-slim';
      } else {
        resolvedImage = existingImage;
      }
    } else {
      resolvedImage = defaultImageForLang ?? config.docker.images['python'] ?? 'python:3.12-slim';
    }
  }

  // If image override changes, clean up old container to reboot with the new image base
  if (activeContainer && activeImage !== resolvedImage) {
    console.log(`[Docker] Sandbox reconfiguration needed (image changed from ${activeImage} to ${resolvedImage}). Replacing sandbox container.`);
    await cleanupSandbox();
  }

  // If activeContainer is null, check if it already exists in the Docker daemon
  if (!activeContainer) {
    try {
      const existingContainer = docker.getContainer(SANDBOX_CONTAINER_NAME);
      const info = await existingContainer.inspect();
      
      const imageMatches = info.Config.Image === resolvedImage;
      const isHostNetwork = info.HostConfig?.NetworkMode === 'host';

      if (imageMatches && isHostNetwork) {
        console.log(`[Docker] Existing persistent sandbox container found and matches host configuration.`);
        activeContainer = existingContainer;
        activeLang = lang;
        activeImage = resolvedImage;

        if (!info.State.Running) {
          console.log(`[Docker] Sandbox container is stopped. Starting it...`);
          await activeContainer.start();
        }
      } else {
        console.log(`[Docker] Existing sandbox container found but configuration mismatch (image match: ${imageMatches}, host network match: ${isHostNetwork}). Removing it.`);
        await existingContainer.remove({ force: true });
      }
    } catch (err) {
      if (err.statusCode !== 404) {
        console.warn(`[Docker] Error checking existing sandbox container:`, err.message);
      }
    }
  }

  // Boot persistent container if it doesn't exist
  if (!activeContainer) {
    console.log(`[Docker] Starting persistent sandbox | image=${resolvedImage} lang=${lang} network=host`);
    await ensureImage(resolvedImage);

    activeContainer = await docker.createContainer({
      name:         SANDBOX_CONTAINER_NAME,
      Image:        resolvedImage,
      Cmd:          ['tail', '-f', '/dev/null'], // Keep container running
      WorkingDir:   '/workspace',
      NetworkDisabled: false,                   // Outbound network enabled
      HostConfig: {
        AutoRemove:  false,
        NetworkMode: 'host',                    // Host network mode always
        Binds: [
          'openmanus-workspace:/workspace',
          '/var/run/docker.sock:/var/run/docker.sock' // Docker-in-Docker
        ],
        Memory:      512 * 1024 * 1024,         // 512 MB RAM cap
        CpuQuota:    80_000,                    // 80% CPU limit
        PidsLimit:   128,
      },
    });

    await activeContainer.start();
    activeLang  = lang;
    activeImage = resolvedImage;
    console.log('[Docker] Container started on host network.');
  }

  return activeContainer;
}

/**
 * Executes a script inside a persistent Docker container sandbox.
 * Keeps the container alive throughout the session to persist installed libraries
 * and generated workspace assets.
 *
 * @param {object} params
 * @param {string}   params.code     - The script source code to run
 * @param {"python"|"javascript"|"bash"} params.lang - Runtime language
 * @param {string}   [params.image]  - Override the default Docker image
 * @param {number[]} [params.ports]  - Host ports to expose from the container (e.g. [3000, 8080])
 *
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, accessUrls?: string[] }>}
 */
export async function runInSandbox({ code, lang = 'python', image, ports = [], background = false }) {
  // Determine filename + run command
  const isNode   = lang === 'javascript';
  const isBash   = lang === 'bash';
  const filename = isNode ? 'script.js' : (isBash ? 'script.sh' : 'script.py');
  
  let cmd = isNode
    ? ['node', `/workspace/${filename}`]
    : (isBash ? ['bash', `/workspace/${filename}`] : ['python', `/workspace/${filename}`]);

  const stdoutMarker = '__BACKGROUND_RUN_STDOUT_MARKER__';
  const stderrMarker = '__BACKGROUND_RUN_STDERR_MARKER__';

  if (background) {
    const runCmd = isNode
      ? `node /workspace/${filename}`
      : (isBash ? `bash /workspace/${filename}` : `python -u /workspace/${filename}`);
    
    const stdoutFile = `/workspace/server.stdout`;
    const stderrFile = `/workspace/server.stderr`;
    const pidFile = `/workspace/server.pid`;
    
    const wrapper = `nohup ${runCmd} > ${stdoutFile} 2> ${stderrFile} & pid=$! && echo $pid > ${pidFile} && sleep 1.5 && if kill -0 $pid 2>/dev/null; then echo "STATUS: RUNNING"; exit_code=0; else wait $pid; exit_code=$?; echo "STATUS: EXITED Code $exit_code"; fi && echo "${stdoutMarker}" && cat ${stdoutFile} && echo "${stderrMarker}" && cat ${stderrFile} && exit $exit_code`;
    
    cmd = ['bash', '-c', wrapper];
  }

  await ensureSandboxRunning(lang, image);

  if (ports.length) {
    activePorts = Array.from(new Set([...activePorts, ...ports]));
    console.log(`[Docker] Services should listen on port(s): ${activePorts.join(', ')}`);
  }

  const container = activeContainer;

  try {
    // 1. Copy script into container
    const normalizedCode = typeof code === 'string' ? code.replace(/\r\n/g, '\n') : code;
    const archive = await buildTar(filename, normalizedCode);
    await container.putArchive(archive, { path: '/workspace' });

    // 2. Create exec instance
    const exec = await container.exec({
      Cmd:          cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    // 3. Start exec and attach streams
    const stream = await exec.start({ hijack: true, stdin: false });

    // 4. Drain streams with timeout watchdog
    let killed = false;
    const timeoutHandle = setTimeout(async () => {
      console.warn('[Docker] Exec execution timed out — aborting stream');
      killed = true;
      try { stream.destroy(); } catch (_) {}
    }, config.docker.timeoutMs);

    const { stdout: rawStdout, stderr: rawStderr } = await drainStream(stream);
    clearTimeout(timeoutHandle);

    if (killed) {
      return { 
        stdout: rawStdout, 
        stderr: `${rawStderr}\n[TimeoutError]: Execution timed out after ${config.docker.timeoutMs / 1000}s`, 
        exitCode: -1 
      };
    }

    // 5. Inspect exit code
    const inspectInfo = await exec.inspect();
    let exitCode      = inspectInfo.ExitCode ?? 0;

    let stdout = rawStdout;
    let stderr = rawStderr;

    if (background) {
      const stdoutIndex = rawStdout.indexOf(stdoutMarker);
      const stderrIndex = rawStdout.indexOf(stderrMarker);

      if (stdoutIndex !== -1 && stderrIndex !== -1) {
        const statusLine = rawStdout.substring(0, stdoutIndex).trim();
        
        let stdoutStart = stdoutIndex + stdoutMarker.length;
        if (rawStdout[stdoutStart] === '\n') stdoutStart += 1;
        else if (rawStdout[stdoutStart] === '\r' && rawStdout[stdoutStart + 1] === '\n') stdoutStart += 2;

        let stderrStart = stderrIndex + stderrMarker.length;
        if (rawStdout[stderrStart] === '\n') stderrStart += 1;
        else if (rawStdout[stderrStart] === '\r' && rawStdout[stderrStart + 1] === '\n') stderrStart += 2;

        stdout = rawStdout.substring(stdoutStart, stderrIndex).trimEnd();
        stderr = rawStdout.substring(stderrStart).trimEnd();

        if (statusLine.includes('STATUS: RUNNING')) {
          exitCode = 0;
        } else {
          const codeMatch = statusLine.match(/STATUS: EXITED Code (\d+)/);
          if (codeMatch) {
            exitCode = parseInt(codeMatch[1], 10);
          }
        }
      }
    }

    console.log(`[Docker] Exec exited | code=${exitCode} stdout_len=${stdout.length} stderr_len=${stderr.length}`);

    const accessUrls = activePorts.map(p => `http://localhost:${p}`);
    return { stdout, stderr, exitCode, ...(accessUrls.length ? { accessUrls } : {}) };
  } catch (err) {
    console.error('[Docker] Exec error:', err.message);
    throw err;
  }
}
