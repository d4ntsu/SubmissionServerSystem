"""Smoke-test Java execution through a local Piston API.

Usage:
    python phase1_java_test.py
    python phase1_java_test.py --url http://127.0.0.1:2000
    python phase1_java_test.py --java-version 21.0.1
"""

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

JAVA_SOURCE = """import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int a = scanner.nextInt();
        int b = scanner.nextInt();
        System.out.println(a + b);
    }
}
"""


def request_json(url: str, payload: dict | None = None) -> object:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="GET" if data is None else "POST",
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test Java through Piston.")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:2000",
        help="Piston API base URL (default: %(default)s)",
    )
    parser.add_argument(
        "--java-version",
        help="Java runtime version to test; defaults to the first installed Java runtime",
    )
    args = parser.parse_args()
    base_url = args.url.rstrip("/")

    print(f"Piston URL: {base_url}")
    try:
        runtimes = request_json(f"{base_url}/api/v2/runtimes")
        if not isinstance(runtimes, list):
            raise ValueError("Piston runtimes response is not a JSON array")

        java_runtimes = [
            runtime
            for runtime in runtimes
            if isinstance(runtime, dict) and runtime.get("language") == "java"
        ]
        if not java_runtimes:
            print("No Java runtime is installed in Piston.", file=sys.stderr)
            print("Install one with Piston's package manager, then retry.")
            return 1

        versions = [runtime.get("version") for runtime in java_runtimes]
        version = args.java_version or versions[0]
        if version not in versions:
            print(
                f"Java version {version!r} is not installed. Available: "
                + ", ".join(str(item) for item in versions),
                file=sys.stderr,
            )
            return 1

        print(f"Java runtime: {version}")
        result = request_json(
            f"{base_url}/api/v2/execute",
            {
                "language": "java",
                "version": version,
                "files": [{"name": "Main.java", "content": JAVA_SOURCE}],
                "stdin": "3 4\n",
            },
        )
        if not isinstance(result, dict):
            raise ValueError("Piston execute response is not a JSON object")

        compile_result = result.get("compile") or {}
        run_result = result.get("run") or {}
        stdout = run_result.get("stdout")
        stderr = run_result.get("stderr")
        compile_stderr = compile_result.get("stderr")
        exit_code = run_result.get("code")

        print(f"Exit code: {exit_code}")
        print(f"stdout: {stdout!r}")
        if compile_stderr:
            print(f"compile stderr: {compile_stderr}")
        if stderr:
            print(f"stderr: {stderr}")

        passed = exit_code == 0 and (stdout or "").strip() == "7"
        print(f"\nRESULT: {'PASS' if passed else 'FAIL'}")
        return 0 if passed else 1
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
