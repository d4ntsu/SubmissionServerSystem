"""Phase 1 validation: submit a Java program through the Judge0 API.

Runs a synchronous submission against the local Judge0 instance and reports
the compile/run result. Used to verify the sandbox can compile and execute
Java (language id 62) end to end.

Usage:
    python phase1_java_test.py [judge0_url]
"""
import json
import sys
import urllib.request

JUDGE0_URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:2358").rstrip("/")

JAVA_SOURCE = """import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}
"""

FIELDS = "stdout,stderr,compile_output,message,status,time,memory"


def submit(source, stdin, language_id=62):
    payload = json.dumps({
        "source_code": source,
        "language_id": language_id,
        "stdin": stdin,
    }).encode()
    req = urllib.request.Request(
        f"{JUDGE0_URL}/submissions?base64_encoded=false&wait=true&fields={FIELDS}",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def main():
    print(f"Judge0 URL: {JUDGE0_URL}")
    with urllib.request.urlopen(f"{JUDGE0_URL}/about", timeout=15) as r:
        print("Version:", json.loads(r.read())["version"])

    result = submit(JAVA_SOURCE, "3 4\n")
    status = result.get("status", {})
    print("\n--- Java submission (language_id=62, stdin='3 4') ---")
    print("status:", status.get("id"), status.get("description"))
    print("stdout:", repr(result.get("stdout")))
    print("stderr:", repr(result.get("stderr")))
    print("compile_output:", repr(result.get("compile_output")))
    print("time:", result.get("time"), "s  memory:", result.get("memory"), "KB")

    ok = (
        status.get("id") == 3
        and (result.get("stdout") or "").strip() == "7"
    )
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
