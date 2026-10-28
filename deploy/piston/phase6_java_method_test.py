"""Run a real multi-file Java method smoke test against a self-hosted Piston.

From the repository root, after installing backend/requirements.txt:
    python deploy/piston/phase6_java_method_test.py --url http://127.0.0.1:2000
"""

import argparse
import asyncio
import json
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.core.config import settings
from app.services.java_method_grader import (
    build_files,
    build_runner_config,
    parse_method_spec,
    parse_runner_result,
    values_equal,
)
from app.services.piston_client import PistonClient, PistonClientError

SOURCE = """public class Calculator {
    public int add(int a, int b) { return a+b; }
    public String greeting() { return "chào 😀"; }
    public long sum(long[] values) { long total=0; for(long value:values) total+=value; return total; }
    public String wrongReturn(int a,int b) { return String.valueOf(a+b); }
}
"""


async def smoke_test(url: str, version: str | None) -> bool:
    cases = [
        ("public int add(int,int)", [2, 3], 5, "ok"),
        ("public String greeting()", [], "chào 😀", "ok"),
        ("public long sum(long[])", [[1, 2, 3]], 6, "ok"),
        ("public int wrongReturn(int,int)", [2, 3], None, "signature_error"),
    ]
    all_passed = True
    async with PistonClient(base_url=url) as piston:
        for case_id, (signature, arguments, expected, status) in enumerate(cases, 1):
            spec = parse_method_spec(signature)
            request_id = secrets.token_hex(16)
            config = build_runner_config(
                spec, "Calculator", case_id, arguments, request_id
            )
            result = await piston.execute(
                language="java",
                version=version,
                files=build_files(SOURCE, "Calculator"),
                args=["Calculator"],
                stdin=json.dumps(config, ensure_ascii=True),
                run_timeout_ms=settings.piston_java_method_run_timeout_ms,
                run_cpu_time_ms=settings.piston_java_method_run_cpu_time_ms,
                run_memory_limit_bytes=settings.piston_java_method_run_memory_limit_bytes,
            )
            try:
                if result.compile and (
                    result.compile.code != 0 or result.compile.signal
                ):
                    raise ValueError("Compilation failed: " + result.compile.stderr)
                if result.run.code != 0 or result.run.signal:
                    raise ValueError("Execution failed: " + result.run.stderr)
                actual = parse_runner_result(result.run.stdout, request_id, case_id)
                passed = actual["status"] == status and (
                    status != "ok"
                    or values_equal(actual["actual"], expected, spec.return_type)
                )
            except ValueError as error:
                passed = False
                print(str(error), file=sys.stderr)
            print(f"{'PASS' if passed else 'FAIL'}: {signature}")
            all_passed = all_passed and passed
    return all_passed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:2000")
    parser.add_argument("--java-version", default=None)
    args = parser.parse_args()
    try:
        return 0 if asyncio.run(smoke_test(args.url, args.java_version)) else 1
    except (PistonClientError, OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
