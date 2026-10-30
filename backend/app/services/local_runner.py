"""Compile and run student code directly on the host using subprocess.

Replaces the Piston Docker-based execution service with local process execution.
Java code is compiled with javac then run with java; Python code is run directly.
All execution happens in isolated temporary directories that are cleaned up after
each run.
"""

import asyncio
import logging
import os
import subprocess
import tempfile
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO

logger = logging.getLogger(__name__)

# Default resource limits (mirror the old Piston defaults)
DEFAULT_COMPILE_TIMEOUT_SECONDS = 10.0
DEFAULT_RUN_TIMEOUT_SECONDS = 3.0
DEFAULT_JAVA_METHOD_RUN_TIMEOUT_SECONDS = 15.0


class LocalRunnerError(RuntimeError):
    """Raised when local execution fails."""


@dataclass
class StageResult:
    """Mirrors the shape of the old PistonStageResult for minimal consumer changes."""

    stdout: str = ""
    stderr: str = ""
    output: str = ""
    code: int | None = None
    signal: str | None = None


@dataclass
class ExecutionResult:
    """Mirrors the shape of the old PistonExecutionResult."""

    language: str = ""
    version: str = ""
    run: StageResult = field(default_factory=StageResult)
    compile: StageResult | None = None


class LocalRunner:
    """Compile and run code on the local machine in a temporary directory.

    Usage::

        async with LocalRunner() as runner:
            result = await runner.execute(
                language="java",
                files=[{"name": "Main.java", "content": "class Main { ... }"}],
                stdin="input data",
            )
    """

    def __init__(self) -> None:
        self._work_dir: Path | None = None

    async def __aenter__(self) -> "LocalRunner":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        self.cleanup()

    def cleanup(self) -> None:
        """Remove the temporary working directory if one was created."""
        if self._work_dir is not None:
            try:
                import shutil

                shutil.rmtree(self._work_dir, ignore_errors=True)
            except Exception:
                logger.warning("Failed to clean up temp dir %s", self._work_dir)
            self._work_dir = None

    async def execute(
        self,
        *,
        language: str,
        files: list[dict],
        stdin: str = "",
        args: list[str] | None = None,
        version: str | None = None,
        run_timeout_ms: int | None = None,
        run_cpu_time_ms: int | None = None,
        run_memory_limit_bytes: int | None = None,
    ) -> ExecutionResult:
        """Compile and run code, returning an ExecutionResult.

        Parameters
        ----------
        language : str
            ``"java"`` or ``"python"`` (case-insensitive).
        files : list[dict]
            Each dict must have ``"name"`` and ``"content"`` keys.
        stdin : str
            Standard input to pass to the program.
        args : list[str] | None
            Command-line arguments (only used for Java method grading).
        version : str | None
            Ignored; kept for API compatibility.
        run_timeout_ms : int | None
            Timeout for the run stage in milliseconds.
        run_cpu_time_ms : int | None
            Ignored; kept for API compatibility.
        run_memory_limit_bytes : int | None
            Ignored; kept for API compatibility.
        """
        lang = language.casefold().strip()

        if not files:
            raise ValueError("At least one source file is required")

        # Create a fresh temp directory
        self._work_dir = Path(tempfile.mkdtemp(prefix="local_runner_"))

        # Write all source files
        for file_entry in files:
            name = file_entry.get("name", "")
            content = file_entry.get("content", "")
            if not name or ".." in name or "/" in name or "\\" in name:
                raise ValueError(f"Invalid source file name: {name!r}")
            file_path = self._work_dir / name
            file_path.write_text(content, encoding="utf-8")

        run_timeout = (
            run_timeout_ms / 1000.0
            if run_timeout_ms is not None
            else DEFAULT_RUN_TIMEOUT_SECONDS
        )

        try:
            if lang == "java":
                return await self._execute_java(
                    args=args, stdin=stdin, run_timeout=run_timeout
                )
            elif lang == "python":
                return await self._execute_python(
                    stdin=stdin, run_timeout=run_timeout
                )
            elif lang == "plaintext":
                # Objective questions don't need execution
                return ExecutionResult(
                    language=language,
                    version="",
                    run=StageResult(stdout="", stderr="", output="", code=0),
                )
            else:
                raise LocalRunnerError(f"Unsupported language: {language!r}")
        except LocalRunnerError:
            raise
        except Exception as exc:
            raise LocalRunnerError(f"Execution failed: {exc}") from exc

    async def _execute_java(
        self,
        args: list[str] | None,
        stdin: str,
        run_timeout: float,
    ) -> ExecutionResult:
        """Compile all .java files, then run the main class."""
        # --- Compile ---
        java_files = list(self._work_dir.glob("*.java"))
        if not java_files:
            raise LocalRunnerError("No Java source files to compile")

        compile_result = await self._run_process(
            ["javac"] + [str(f) for f in java_files],
            timeout=DEFAULT_COMPILE_TIMEOUT_SECONDS,
        )

        compile_stage = StageResult(
            stdout=compile_result.stdout,
            stderr=compile_result.stderr,
            output=compile_result.stdout or compile_result.stderr,
            code=compile_result.exit_code,
        )

        if compile_result.exit_code != 0:
            return ExecutionResult(
                language="java",
                version="",
                run=StageResult(code=None, stdout="", stderr="", output=""),
                compile=compile_stage,
            )

        # --- Run ---
        # Determine the main class: if args[0] is provided, use it; otherwise
        # look for a class with a main method (prefer Main.java).
        main_class = args[0] if args else self._find_main_class()

        if main_class is None:
            # No explicit main class and no Main.java — try running the first file's class
            main_class = java_files[0].stem

        run_args = ["java", "-cp", str(self._work_dir), main_class]
        if args and len(args) > 1:
            run_args.extend(args[1:])

        run_result = await self._run_process(
            run_args, stdin=stdin, timeout=run_timeout
        )

        run_stage = StageResult(
            stdout=run_result.stdout,
            stderr=run_result.stderr,
            output=run_result.stdout or run_result.stderr,
            code=run_result.exit_code,
            signal="timed-out" if run_result.timed_out else None,
        )

        return ExecutionResult(
            language="java",
            version="",
            run=run_stage,
            compile=compile_stage,
        )

    async def _execute_python(
        self,
        stdin: str,
        run_timeout: float,
    ) -> ExecutionResult:
        """Run the first .py file with python."""
        py_files = list(self._work_dir.glob("*.py"))
        if not py_files:
            raise LocalRunnerError("No Python source files to run")

        run_result = await self._run_process(
            ["python", str(py_files[0])],
            stdin=stdin,
            timeout=run_timeout,
        )

        run_stage = StageResult(
            stdout=run_result.stdout,
            stderr=run_result.stderr,
            output=run_result.stdout or run_result.stderr,
            code=run_result.exit_code,
            signal="timed-out" if run_result.timed_out else None,
        )

        return ExecutionResult(
            language="python",
            version="",
            run=run_stage,
        )

    def _find_main_class(self) -> str | None:
        """Heuristic: return 'Main' if Main.java exists, else None."""
        main_java = self._work_dir / "Main.java"
        if main_java.exists():
            return "Main"
        return None

    @staticmethod
    async def _run_process(
        cmd: list[str],
        stdin: str = "",
        timeout: float = DEFAULT_RUN_TIMEOUT_SECONDS,
    ) -> subprocess.CompletedProcess:
        """Run a subprocess with a timeout and capture output."""
        try:
            proc = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: subprocess.run(
                        cmd,
                        input=stdin,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        creationflags=subprocess.CREATE_NO_WINDOW
                        if os.name == "nt"
                        else 0,
                    ),
                ),
                timeout=timeout + 2.0,  # extra buffer for asyncio wrapper
            )
            return _ProcessResult(
                stdout=proc.stdout,
                stderr=proc.stderr,
                exit_code=proc.returncode,
                timed_out=False,
            )
        except subprocess.TimeoutExpired:
            return _ProcessResult(
                stdout="",
                stderr="Execution timed out",
                exit_code=None,
                timed_out=True,
            )
        except asyncio.TimeoutError:
            return _ProcessResult(
                stdout="",
                stderr="Execution timed out",
                exit_code=None,
                timed_out=True,
            )
        except FileNotFoundError as exc:
            raise LocalRunnerError(
                f"{exc.filename} was not found. Make sure Java/Python is installed "
                f"and available in the system PATH."
            ) from exc
        except OSError as exc:
            raise LocalRunnerError(
                f"Could not launch process: {exc}"
            ) from exc


@dataclass
class _ProcessResult:
    stdout: str
    stderr: str
    exit_code: int | None
    timed_out: bool