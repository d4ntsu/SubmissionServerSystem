import json

import httpx
import pytest

from app.services.piston_client import PistonClient, PistonClientError


@pytest.mark.asyncio
async def test_execute_uses_installed_java_runtime_and_limits():
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/v2/runtimes":
            return httpx.Response(
                200,
                json=[{"language": "java", "version": "15.0.2", "aliases": ["java"]}],
            )
        return httpx.Response(
            200,
            json={
                "language": "java",
                "version": "15.0.2",
                "compile": {"code": 0, "stdout": "", "stderr": "", "output": ""},
                "run": {
                    "code": 0,
                    "signal": None,
                    "stdout": "7\n",
                    "stderr": "",
                    "output": "7\n",
                },
            },
        )

    async with PistonClient(
        base_url="http://piston.test",
        transport=httpx.MockTransport(handler),
    ) as client:
        result = await client.execute(
            language="java",
            files=[{"name": "Main.java", "content": "class Main {}"}],
            stdin="3 4\n",
        )

    assert result.run.code == 0
    assert result.run.stdout == "7\n"
    execution_request = requests[1]
    payload = json.loads(execution_request.content)
    assert execution_request.url.path == "/api/v2/execute"
    assert payload["version"] == "15.0.2"
    assert payload["compile_timeout"] > 0
    assert payload["run_timeout"] > 0
    assert payload["compile_memory_limit"] > 0
    assert payload["run_memory_limit"] > 0


@pytest.mark.asyncio
async def test_execute_fails_when_runtime_is_not_installed():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    async with PistonClient(
        base_url="http://piston.test",
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(PistonClientError, match="No installed Piston runtime"):
            await client.execute(
                language="java",
                files=[{"name": "Main.java", "content": "class Main {}"}],
            )


@pytest.mark.asyncio
async def test_piston_http_errors_are_reported():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "temporarily unavailable"})

    async with PistonClient(
        base_url="http://piston.test",
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(PistonClientError, match="temporarily unavailable"):
            await client.get_runtimes()


@pytest.mark.asyncio
async def test_execute_rejects_paths_in_source_file_names():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[{"language": "java", "version": "15.0.2", "aliases": []}],
        )

    async with PistonClient(
        base_url="http://piston.test",
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(ValueError, match="Invalid Piston source file"):
            await client.execute(
                language="java",
                files=[{"name": "../Main.java", "content": "class Main {}"}],
            )


@pytest.mark.asyncio
async def test_execute_can_set_limits_for_source_mode_java_compilation():
    requests = []

    async def handler(request):
        requests.append(request)
        if request.url.path == "/api/v2/runtimes":
            return httpx.Response(
                200, json=[{"language": "java", "version": "15.0.2", "aliases": []}]
            )
        return httpx.Response(
            200,
            json={
                "language": "java",
                "version": "15.0.2",
                "run": {"code": 0, "stdout": ""},
            },
        )

    async with PistonClient(
        base_url="http://piston.test", transport=httpx.MockTransport(handler)
    ) as client:
        await client.execute(
            language="java",
            files=[{"name": "Main.java", "content": "class Main {}"}],
            args=["Sample"],
            run_timeout_ms=15000,
            run_memory_limit_bytes=536870912,
        )
    payload = json.loads(requests[-1].content)
    assert payload["run_timeout"] == 15000
    assert payload["run_memory_limit"] == 536870912
    assert payload["args"] == ["Sample"]


@pytest.mark.parametrize(
    "override",
    [{"run_timeout_ms": 0}, {"run_timeout_ms": True}, {"run_memory_limit_bytes": -1}],
)
@pytest.mark.asyncio
async def test_invalid_limit_overrides_are_rejected(override):
    async with PistonClient(
        base_url="http://piston.test",
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
    ) as client:
        with pytest.raises(ValueError, match="positive integer"):
            await client.execute(
                language="java",
                files=[{"name": "Main.java", "content": "class Main {}"}],
                **override
            )
