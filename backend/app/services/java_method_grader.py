"""Grade Java methods inside Piston; keep every expected value in this process."""

import json
import math
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models.question import Question
from app.models.submission import Submission, SubmissionStatus, SubmissionTestResult
from app.models.test_case import TestCase
from app.services.local_runner import LocalRunner, LocalRunnerError

RESULT_PREFIX = "@@JAVA_GRADER_RESULT@@"
PROTOCOL_VERSION = 1
GRADER_DIR = Path(__file__).resolve().parents[3] / "java-grader"
RUNNER_PATH = GRADER_DIR / "src/main/java/ReflectionTestRunner.java"
MAIN_PATH = GRADER_DIR / "templates/Main.java"
_IDENTIFIER = r"[A-Za-z_$][A-Za-z0-9_$]*"
_TYPE = r"[A-Za-z_$][A-Za-z0-9_$.]*(?:\s*\[\s*\])*"
_DECLARATION = re.compile(
    rf"^(?P<modifiers>(?:(?:public|static|final|synchronized|strictfp)\s+)*)"
    rf"(?P<return>{_TYPE})\s+(?P<name>{_IDENTIFIER})\s*\((?P<params>.*)\)\s*;?$"
)
_LEGACY_DECLARATION = re.compile(
    rf"^(?P<name>{_IDENTIFIER})\s*\((?P<params>.*)\)\s*:\s*(?P<return>{_TYPE})$"
)
_BASE_TYPES = {
    "byte",
    "short",
    "int",
    "long",
    "float",
    "double",
    "boolean",
    "char",
    "Byte",
    "Short",
    "Integer",
    "Long",
    "Float",
    "Double",
    "Boolean",
    "Character",
    "String",
    "void",
}
_PRIMITIVES = {"byte", "short", "int", "long", "float", "double", "boolean", "char"}
_INTEGER_RANGES = {
    "byte": (-128, 127),
    "short": (-32768, 32767),
    "int": (-(2**31), 2**31 - 1),
    "long": (-(2**63), 2**63 - 1),
}
_UNBOX = {
    "Byte": "byte",
    "Short": "short",
    "Integer": "int",
    "Long": "long",
    "Float": "float",
    "Double": "double",
    "Boolean": "boolean",
    "Character": "char",
}


@dataclass(frozen=True)
class MethodSpec:
    name: str
    parameter_types: tuple[str, ...]
    return_type: str
    is_static: bool


def normalize_java_type(value: str, *, allow_void: bool = False) -> str:
    value = re.sub(r"\s*\[\s*\]", "[]", value.strip())
    dimensions = 0
    while value.endswith("[]"):
        dimensions += 1
        value = value[:-2]
    if value.startswith("java.lang."):
        value = value[len("java.lang.") :]
    if value not in _BASE_TYPES or (value == "void" and (not allow_void or dimensions)):
        raise ValueError(f"Unsupported Java type: {value}")
    return value + "[]" * dimensions


def parse_method_spec(
    signature: str | None, method_mode: str | None = None
) -> MethodSpec:
    """Parse a Java declaration or the legacy UI signature plus its mode field."""
    text = (signature or "").strip()
    match = _DECLARATION.fullmatch(text)
    legacy_match = None if match else _LEGACY_DECLARATION.fullmatch(text)
    if not match and not legacy_match:
        raise ValueError(
            "Use a full method signature or name(types): returnType, "
            "e.g. public static int add(int a, int b)"
        )
    if legacy_match:
        mode = (method_mode or "STATIC").upper()
        if mode not in {"STATIC", "INSTANCE"}:
            raise ValueError("Method mode must be STATIC or INSTANCE")
        raw_parameters = legacy_match["params"].strip()
        parameters = []
        if raw_parameters:
            for parameter in raw_parameters.split(","):
                parameters.append(normalize_java_type(parameter.strip()))
        return MethodSpec(
            name=legacy_match["name"],
            parameter_types=tuple(parameters),
            return_type=normalize_java_type(
                legacy_match["return"], allow_void=True
            ),
            is_static=mode == "STATIC",
        )

    modifiers = match["modifiers"].split()
    if len(modifiers) != len(set(modifiers)):
        raise ValueError("Duplicate method modifier")
    parameters: list[str] = []
    raw_parameters = match["params"].strip()
    if raw_parameters:
        pieces = raw_parameters.split(",")
        for index, parameter in enumerate(pieces):
            parameter = re.sub(r"^final\s+", "", parameter.strip())
            if "..." in parameter:
                if index != len(pieces) - 1:
                    raise ValueError("Only the last parameter may use varargs")
                parameter = parameter.replace("...", "[] ")
            parsed = re.fullmatch(rf"(?P<type>{_TYPE})(?:\s+{_IDENTIFIER})?", parameter)
            if not parsed:
                raise ValueError(
                    "Unsupported parameter declaration; generics are not supported"
                )
            parameters.append(normalize_java_type(parsed["type"]))
    return MethodSpec(
        name=match["name"],
        parameter_types=tuple(parameters),
        return_type=normalize_java_type(match["return"], allow_void=True),
        is_static="static" in modifiers,
    )


def parse_method_signature(
    signature: str | None, method_mode: str | None = None
) -> tuple[str, list[str], str]:
    spec = parse_method_spec(signature, method_mode)
    return spec.name, list(spec.parameter_types), spec.return_type


def _reject_constant(value: str) -> None:
    raise ValueError(f"Invalid JSON number: {value}")


def parse_arguments(
    input_data: str | None,
    expected_count: int,
    parameter_types: tuple[str, ...] | None = None,
) -> list[Any]:
    """Prefer a JSON argument list; preserve Unicode, null, booleans and nested arrays."""
    text = (input_data or "").strip()
    if not text:
        values: list[Any] = []
    elif text.startswith("["):
        values = json.loads(text, parse_constant=_reject_constant)
        if not isinstance(values, list):
            raise ValueError("Arguments must be a JSON array")
    elif (
        expected_count == 1
        and parameter_types == ("int[]",)
        and (match := re.fullmatch(r"new\s+int\s*\[\s*\]\s*\{(.*)\}", text, re.DOTALL))
    ):
        elements = match.group(1).strip()
        if not elements:
            values = [[]]
        else:
            raw_values = [value.strip() for value in elements.split(",")]
            if any(not re.fullmatch(r"[+-]?\d+", value) for value in raw_values):
                raise ValueError("int[] arguments must contain integer literals")
            values = [[int(value) for value in raw_values]]
    elif expected_count == 1:
        # Legacy single arguments may contain spaces/commas. JSON is recommended.
        values = [input_data]
    elif "," in text:
        values = [part.strip() for part in text.split(",")]
    else:
        values = text.split()
    if len(values) != expected_count:
        raise ValueError(f"Expected {expected_count} arguments, received {len(values)}")
    return values


def _validate_value(value: Any, java_type: str) -> None:
    """Validate typed expected values and typed runner results, without coercion."""
    if value is None:
        if java_type in _PRIMITIVES:
            raise ValueError("null is not valid for a primitive return type")
        return
    if java_type == "void":
        raise ValueError("A void method must have a null expected value")
    if java_type.endswith("[]"):
        if not isinstance(value, list):
            raise ValueError("Expected an array value")
        for item in value:
            _validate_value(item, java_type[:-2])
        return
    base = _UNBOX.get(java_type, java_type)
    if base in _INTEGER_RANGES:
        lo, hi = _INTEGER_RANGES[base]
        if type(value) is not int or not lo <= value <= hi:
            raise ValueError(f"Expected a {base} value in range")
    elif base in {"float", "double"}:
        try:
            valid = type(value) in {int, float} and math.isfinite(value)
        except OverflowError:
            valid = False
        if not valid:
            raise ValueError("Expected a finite number")
    elif base == "boolean":
        if type(value) is not bool:
            raise ValueError("Expected a boolean value")
    elif base in {"String", "char"}:
        if not isinstance(value, str):
            raise ValueError("Expected a string value")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("Unpaired Unicode surrogate in string value") from None
        if base == "char" and len(value.encode("utf-16-le")) != 2:
            raise ValueError("A Java char must contain one UTF-16 code unit")


def parse_expected_output(text: str | None, java_type: str) -> Any:
    raw = text or ""
    try:
        value = json.loads(raw, parse_constant=_reject_constant)
    except (json.JSONDecodeError, ValueError):
        if java_type in {"String", "char", "Character"}:
            value = raw
        elif java_type == "void" and not raw.strip():
            value = None
        else:
            raise ValueError(
                "Expected output must be valid JSON for the declared return type"
            ) from None
    if (
        java_type in {"String", "char", "Character"}
        and value is not None
        and not isinstance(value, str)
    ):
        value = raw
    _validate_value(value, java_type)
    return value


def values_equal(actual: Any, expected: Any, java_type: str) -> bool:
    if actual is None or expected is None:
        return actual is None and expected is None
    if java_type.endswith("[]"):
        return len(actual) == len(expected) and all(
            values_equal(a, e, java_type[:-2]) for a, e in zip(actual, expected)
        )
    if _UNBOX.get(java_type, java_type) in {"float", "double"}:
        tolerance = 1e-6 if _UNBOX.get(java_type, java_type) == "float" else 1e-9
        return math.isclose(actual, expected, rel_tol=tolerance, abs_tol=tolerance)
    return type(actual) is type(expected) and actual == expected


def load_runner_source() -> str:
    return RUNNER_PATH.read_text(encoding="utf-8")


def build_files(source_code: str, class_name: str) -> list[dict[str, str]]:
    # The first file is Piston's entry point. No test data is put in source files.
    return [
        {"name": "Main.java", "content": MAIN_PATH.read_text(encoding="utf-8")},
        {"name": "ReflectionTestRunner.java", "content": load_runner_source()},
        {"name": f"{class_name}.java", "content": source_code},
    ]


def build_runner_config(
    spec: MethodSpec,
    class_name: str,
    case_id: int,
    arguments: list[Any],
    request_id: str,
) -> dict[str, Any]:
    return {
        "version": PROTOCOL_VERSION,
        "request_id": request_id,
        "case_id": case_id,
        "class_name": class_name,
        "method": {
            "name": spec.name,
            "parameter_types": list(spec.parameter_types),
            "return_type": spec.return_type,
            "static": spec.is_static,
        },
        "args": arguments,
    }


def parse_runner_result(stdout: str, request_id: str, case_id: int) -> dict[str, Any]:
    # Only LF separates protocol frames; Unicode line separators may be string data.
    frames = [
        line[len(RESULT_PREFIX) :]
        for line in stdout.split("\n")
        if line.startswith(RESULT_PREFIX)
    ]
    if len(frames) != 1:
        raise ValueError("Expected exactly one grader result frame")
    result = json.loads(frames[0], parse_constant=_reject_constant)
    required = {"version", "request_id", "case_id", "status", "actual", "error"}
    if not isinstance(result, dict) or set(result) != required:
        raise ValueError("Invalid grader result schema")
    if type(result["version"]) is not int or result["version"] != PROTOCOL_VERSION:
        raise ValueError("Unsupported grader protocol")
    if (
        result["request_id"] != request_id
        or type(result["case_id"]) is not int
        or result["case_id"] != case_id
    ):
        raise ValueError("Grader result does not match this test")
    if result["status"] not in {
        "ok",
        "signature_error",
        "runtime_error",
        "argument_error",
        "runner_error",
    }:
        raise ValueError("Invalid grader result status")
    if result["status"] == "ok":
        if result["error"] is not None:
            raise ValueError("Successful result contains an error")
    elif not isinstance(result["error"], str) or not result["error"]:
        raise ValueError("Failed result must contain an error")
    return result


async def grade_java_method(
    db: Session, submission: Submission, question: Question, test_cases: list[TestCase]
) -> None:
    try:
        class_name = (question.class_name or "").strip()
        if not re.fullmatch(_IDENTIFIER, class_name) or class_name in {
            "Main",
            "ReflectionTestRunner",
        }:
            raise ValueError(
                "Configure a simple class_name other than Main or ReflectionTestRunner"
            )
        if (submission.language or "").casefold() != "java":
            raise ValueError("Java class/method questions require the java language")
        spec = parse_method_spec(question.method_signature, question.method_mode)
        if not test_cases:
            raise ValueError("No test cases configured")
        prepared = [
            (
                tc,
                parse_arguments(
                    tc.input_data, len(spec.parameter_types), spec.parameter_types
                ),
                parse_expected_output(tc.expected_output, spec.return_type),
            )
            for tc in test_cases
        ]
        if any(
            not math.isfinite(tc.score_weight) or tc.score_weight <= 0
            for tc in test_cases
        ):
            raise ValueError("Test weights must be finite and positive")
        files = build_files(submission.source_code, class_name)
    except (ValueError, TypeError) as exc:
        submission.status = SubmissionStatus.error
        submission.score = None
        submission.error_summary = f"Invalid Java grading configuration: {exc}"
        db.commit()
        return

    earned_weight = 0.0
    compile_error: str | None = None
    async with LocalRunner() as runner:
        for tc, arguments, expected in prepared:
            if compile_error is not None:
                _record_test_result(
                    db, submission, tc, passed=False, compile_output=compile_error
                )
                continue
            request_id = secrets.token_hex(16)
            config = build_runner_config(spec, class_name, tc.id, arguments, request_id)
            execution = await runner.execute(
                language="java",
                files=files,
                # No args: Main.java uses already-compiled classes (LocalRunner compiles
                # all .java files before running). With args, Main.java tries to recompile
                # using JavaCompiler which is not available in all JDK distributions.
                args=None,
                stdin=json.dumps(config, ensure_ascii=True, allow_nan=False),
                run_timeout_ms=15000,
                run_cpu_time_ms=15000,
                run_memory_limit_bytes=536870912,
            )
            if execution.compile and (
                execution.compile.code != 0 or execution.compile.signal
            ):
                compile_error = (
                    execution.compile.stderr
                    or execution.compile.output
                    or "Compilation failed"
                )
                _record_test_result(
                    db, submission, tc, passed=False, compile_output=compile_error
                )
                continue
            if execution.run.code == 65 and not execution.run.signal:
                # Main.java's JavaCompiler stage runs inside Piston's run stage.
                compile_error = execution.run.stderr or "Compilation failed"
                _record_test_result(
                    db, submission, tc, passed=False, compile_output=compile_error
                )
                continue
            if (
                execution.run.code == 70
                and "[java-grader bootstrap]" in execution.run.stderr
            ):
                raise LocalRunnerError(
                                    "Java grader bootstrap failed; install a full JDK 11+ runtime"
                )
            if execution.run.code != 0 or execution.run.signal:
                error = (
                    "Execution timed out or was terminated"
                    if execution.run.signal
                    else "Java process exited unsuccessfully"
                )
                _record_test_result(
                    db,
                    submission,
                    tc,
                    passed=False,
                    stderr=error,
                    exit_code=execution.run.code,
                )
                continue
            try:
                result = parse_runner_result(execution.run.stdout, request_id, tc.id)
                if result["status"] != "ok":
                    _record_test_result(
                        db,
                        submission,
                        tc,
                        passed=False,
                        stderr=result["error"],
                        exit_code=0,
                    )
                    continue
                actual = result["actual"]
                _validate_value(actual, spec.return_type)
                passed = values_equal(actual, expected, spec.return_type)
                _record_test_result(
                    db,
                    submission,
                    tc,
                    passed=passed,
                    stdout=json.dumps(actual, ensure_ascii=False, allow_nan=False),
                    exit_code=0,
                )
                if passed:
                    earned_weight += tc.score_weight
            except (ValueError, TypeError, KeyError, OverflowError):
                # Never log raw output: it may contain hidden input or student data.
                _record_test_result(
                    db,
                    submission,
                    tc,
                    passed=False,
                    stderr="Invalid or incomplete Java grader output",
                    exit_code=0,
                )

    submission.status = SubmissionStatus.completed
    submission.score = round(
        earned_weight / sum(tc.score_weight for tc in test_cases) * question.max_score,
        2,
    )
    submission.error_summary = None
    submission.graded_at = datetime.now(timezone.utc)
    db.commit()


def _record_test_result(
    db: Session,
    submission: Submission,
    test_case: TestCase,
    *,
    passed: bool,
    stdout: str = "",
    stderr: str = "",
    compile_output: str = "",
    exit_code: int | None = None,
) -> None:
    db.add(
        SubmissionTestResult(
            submission_id=submission.id,
            test_case_id=test_case.id,
            passed=int(passed),
            stdout=stdout,
            stderr=stderr,
            compile_output=compile_output,
            exit_code=exit_code,
        )
    )
