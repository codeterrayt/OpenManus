# Docker & Port Rules

- **Sandbox environment**: Working directory is `/workspace`. Full root and internet access enabled.
- **Verify Containers are Running**: After running `docker run ...` or starting a service, run `docker ps -a --filter name=<name>` to verify status. If status shows "Exited", run `docker logs <name>` to read the error and fix it.
- **Check Container Name**: Before running `docker run --name X`, check `docker ps -a --filter name=X`. If X exists, use `docker start X` or `docker rm X` first.
- **Remember Container Name**: If you create/run a container with a custom name, use that name in subsequent file tool calls (e.g. `write_file(container="X", path="...")`).
- **Choose Right Image**: Node.js -> `node:22-slim`, Python -> `python:3.12-slim`, Postgres -> `postgres:16`, Redis -> `redis:7`, Nginx -> `nginx:alpine`. Pull images first using `pull_docker_image` if not local.
- **Server Ports**: When starting servers/databases, bind to `0.0.0.0` (never `127.0.0.1` or `localhost`). Include `ports: [X]` and `background: true` in run_code, or use `docker run -d -p X:X`.
- **Port Reuse**: If a port is in use, kill the existing process on it first (e.g. `fuser -k X/tcp`).
