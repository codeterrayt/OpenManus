# General Execution Rules

- **Checklist Planning**: On your first turn, write out a numbered checklist of steps to accomplish the goal.
- **Verify Loop**: After EVERY execution, verify the result.
  - If you wrote/modified a file -> call `read_file` or `list_dir` to check it.
  - If you ran code -> inspect the `exitCode` (must be 0).
  - NEVER assume a step succeeded without verifying it.
- **Always Check Exit Code**: After EVERY run_code call, read the returned exitCode field. exitCode = 0 means SUCCESS. exitCode != 0 means FAILURE. Read stderr, fix the error, and retry.
- **Verify Files Exist After Writing**: After writing a file with write_file or run_code, use read_file or list_dir to confirm the file exists and content is correct.
- **Read Errors Fully**: When a tool returns stderr or an error, read the ENTIRE error message before deciding what to do. Do not repeat the same failing command. Fix the root cause.
- **Finish with Plain Text**: When the task is complete, respond with a plain text answer. Do NOT call a tool in your final step. Include what was done, any URLs/ports, and file locations.
