from types import TracebackType
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.core.config import settings


class PistonClientError(RuntimeError):
    """Raised when Piston cannot execute a request or returns an invalid response."""


class PistonRuntime(BaseModel):
    language: str
    version: str
    aliases: list[str] = Field(default_factory=list)
    runtime: str | None = None


class PistonFile(BaseModel):
    name: str = Field(min_length=1, max_length=255, pattern=r"^[^/\\]+$")
    content: str
    encoding: Literal["base64", "hex", "utf8"] = "utf8"

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        if name in {".", ".."}:
            raise ValueError("Piston file names must be simple file names")
        return name


class PistonStageResult(BaseModel):
    stdout: str = ""
    stderr: str = ""
    output: str = ""
    code: int | None = None
    signal: str | None = None


class PistonExecutionResult(BaseModel):
    language: str
    version: str
    run: PistonStageResult
    compile: PistonStageResult | None = None


class PistonClient:
    def __init__(
        self,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=(base_url or settings.piston_base_url).rstrip("/"),
            timeout=timeout_seconds or settings.piston_request_timeout_seconds,
            transport=transport,
        )

    async def __aenter__(self) -> "PistonClient":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    async def get_runtimes(self) -> list[PistonRuntime]:
        payload = await self._get_json("/api/v2/runtimes")
        if not isinstance(payload, list):
            raise PistonClientError("Piston runtimes response must be a JSON array")
        try:
            return [PistonRuntime.model_validate(runtime) for runtime in payload]
        except ValidationError as exc:
            raise PistonClientError("Piston returned an invalid runtime list") from exc

    async def execute(
        self,
        *,
        language: str,
        files: list[PistonFile | dict[str, Any]],
        stdin: str = "",
        args: list[str] | None = None,
        version: str | None = None,
        run_timeout_ms: int | None = None,
        run_cpu_time_ms: int | None = None,
        run_memory_limit_bytes: int | None = None,
    ) -> PistonExecutionResult:
        if not files:
            raise ValueError("At least one source file is required")
        for name, value in (
            ("run_timeout_ms", run_timeout_ms),
            ("run_cpu_time_ms", run_cpu_time_ms),
            ("run_memory_limit_bytes", run_memory_limit_bytes),
        ):
            if value is not None and (type(value) is not int or value <= 0):
                raise ValueError(f"{name} must be a positive integer")
        try:
            file_payloads = [
                PistonFile.model_validate(file).model_dump(exclude_unset=True)
                for file in files
            ]
        except ValidationError as exc:
            raise ValueError(f"Invalid Piston source file: {exc}") from exc

        runtimes = await self.get_runtimes()
        runtime = next(
            (
                item
                for item in runtimes
                if language.casefold()
                in {item.language.casefold(), *(alias.casefold() for alias in item.aliases)}
                and (version is None or item.version == version)
            ),
            None,
        )
        if runtime is None:
            qualifier = f" version {version}" if version else ""
            raise PistonClientError(
                f"No installed Piston runtime matches {language!r}{qualifier}"
            )

        payload: dict[str, object] = {
            "language": runtime.language,
            "version": runtime.version,
            "files": file_payloads,
            "stdin": stdin,
            "compile_timeout": settings.piston_compile_timeout_ms,
            "run_timeout": run_timeout_ms if run_timeout_ms is not None else settings.piston_run_timeout_ms,
            "compile_memory_limit": settings.piston_compile_memory_limit_bytes,
            "run_memory_limit": run_memory_limit_bytes if run_memory_limit_bytes is not None else settings.piston_run_memory_limit_bytes,
        }
        if run_cpu_time_ms is not None:
            payload["run_cpu_time"] = run_cpu_time_ms
        if args:
            payload["args"] = args

        response_payload = await self._post_json("/api/v2/execute", payload)
        try:
            return PistonExecutionResult.model_validate(response_payload)
        except ValidationError as exc:
            raise PistonClientError("Piston returned an invalid execution result") from exc

    async def _get_json(self, path: str) -> object:
        try:
            response = await self._http.get(path)
        except httpx.RequestError as exc:
            raise PistonClientError(f"Could not reach Piston: {exc}") from exc
        return self._decode_response(response)

    async def _post_json(self, path: str, payload: dict[str, object]) -> object:
        try:
            response = await self._http.post(path, json=payload)
        except httpx.RequestError as exc:
            raise PistonClientError(f"Could not reach Piston: {exc}") from exc
        return self._decode_response(response)

    @staticmethod
    def _decode_response(response: httpx.Response) -> object:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            try:
                detail = response.json().get("message", response.text)
            except (ValueError, AttributeError):
                detail = response.text
            raise PistonClientError(
                f"Piston returned HTTP {response.status_code}: {detail}"
            ) from exc

        try:
            return response.json()
        except ValueError as exc:
            raise PistonClientError("Piston returned invalid JSON") from exc
