"""Protocol, scoring and real-JVM regressions for Task 4.

The JVM examples below are trusted test fixtures. Production submissions must
only run through Piston, never through this local test adapter.
"""

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.question import Question, QuestionType
from app.models.submission import Submission, SubmissionStatus
from app.models.test_case import TestCase as Case
from app.services.grading_service import grade_submission
from app.services.java_method_grader import (
    GRADER_DIR,
    RESULT_PREFIX,
    build_files,
    build_runner_config,
    grade_java_method,
    normalize_java_type,
    parse_arguments,
    parse_expected_output,
    parse_method_signature,
    parse_method_spec,
    parse_runner_result,
    values_equal,
)
from app.services.piston_client import (
    PistonClientError,
    PistonExecutionResult,
    PistonStageResult,
)


def execution(stdout="", *, run_code=0, signal=None, compile_code=0):
    return PistonExecutionResult(
        language="java",
        version="17",
        compile=PistonStageResult(
            code=compile_code, stderr="syntax error" if compile_code else ""
        ),
        run=PistonStageResult(stdout=stdout, code=run_code, signal=signal),
    )


def frame(config, actual=None, *, status="ok", error=None, **extra):
    payload = dict(
        version=1,
        request_id=config["request_id"],
        case_id=config["case_id"],
        status=status,
        actual=actual,
        error=error,
    )
    payload.update(extra)
    return RESULT_PREFIX + json.dumps(payload)


def objects(
    signature="public int add(int a, int b)", *, class_name="Sample", cases=None
):
    question = Question(
        id=1,
        exam_id=1,
        question_type=QuestionType.java_class,
        class_name=class_name,
        method_signature=signature,
        max_score=100,
    )
    submission = Submission(
        id=1,
        student_id=1,
        question_id=1,
        language="java",
        source_code=SAMPLE_SOURCE,
        status=SubmissionStatus.running,
        max_score=100,
    )
    cases = cases or [
        Case(
            id=101,
            question_id=1,
            input_data="[2,3]",
            expected_output="5",
            score_weight=1,
            is_hidden=1,
        )
    ]
    return MagicMock(), submission, question, cases


def recorded(db):
    return [call.args[0] for call in db.add.call_args_list]


@pytest.mark.parametrize(
    "signature,expected",
    [
        ("public int add(int a, int b)", ("add", ["int", "int"], "int")),
        ("static java.lang.Integer box(Integer x)", ("box", ["Integer"], "Integer")),
        ("public long sum(long[] values)", ("sum", ["long[]"], "long")),
        ("String[] words(String... words)", ("words", ["String[]"], "String[]")),
    ],
)
def test_parse_signature(signature, expected):
    assert parse_method_signature(signature) == expected


def test_static_mode_is_preserved():
    assert parse_method_spec("public static int add(int,int)").is_static
    assert not parse_method_spec("public int add(int,int)").is_static


@pytest.mark.parametrize(
    "mode,is_static",
    [("STATIC", True), ("INSTANCE", False)],
)
def test_legacy_question_signature_uses_persisted_method_mode(mode, is_static):
    spec = parse_method_spec("add(int, int): int", mode)
    assert spec.name == "add"
    assert spec.parameter_types == ("int", "int")
    assert spec.return_type == "int"
    assert spec.is_static is is_static


@pytest.mark.parametrize(
    "signature",
    [
        None,
        "add",
        "add(int,int)",
        "private int add(int,int)",
        "List<String> words()",
        "int f(int a,)",
        "public public int f()",
    ],
)
def test_invalid_signatures_are_rejected(signature):
    with pytest.raises(ValueError):
        parse_method_spec(signature)


def test_boxed_and_primitive_types_are_distinct():
    assert normalize_java_type("Integer") == "Integer"
    assert normalize_java_type("int") == "int"
    with pytest.raises(ValueError):
        normalize_java_type("UnknownType")


@pytest.mark.parametrize(
    "data,count,expected",
    [
        ("[3,4]", 2, [3, 4]),
        ("3,4", 2, ["3", "4"]),
        ("3 4", 2, ["3", "4"]),
        ("", 0, []),
        ('[null,true,"chào",[1,2]]', 4, [None, True, "chào", [1, 2]]),
        ('["a,b c"]', 1, ["a,b c"]),
        ('[["hello world","a,b"]]', 1, [["hello world", "a,b"]]),
    ],
)
def test_arguments_preserve_types(data, count, expected):
    assert parse_arguments(data, count) == expected


@pytest.mark.parametrize(
    "data,expected",
    [
        ("new int[]{12, 35, 1, 10, 34, 1}", [[12, 35, 1, 10, 34, 1]]),
        ("new int[] {}", [[]]),
    ],
)
def test_java_int_array_arguments_are_supported(data, expected):
    assert parse_arguments(data, 1, ("int[]",)) == expected


@pytest.mark.parametrize(
    "data,count", [("[2]", 2), ("[1,2,3]", 2), ("[broken", 1), ("", 1)]
)
def test_wrong_argument_counts_or_json_are_rejected(data, count):
    with pytest.raises(ValueError):
        parse_arguments(data, count)


def test_malformed_java_int_array_literal_is_rejected():
    with pytest.raises(ValueError, match="integer literals"):
        parse_arguments("new int[]{12, nope}", 1, ("int[]",))


def test_expected_values_and_comparison_are_typed():
    assert parse_expected_output("5", "String") == "5"
    assert parse_expected_output("", "String") == ""
    assert parse_expected_output("  chào  ", "String") == "  chào  "
    assert parse_expected_output("null", "String") is None
    assert parse_expected_output('"null"', "String") == "null"
    assert parse_expected_output("9223372036854775807", "long") == 9223372036854775807
    assert values_equal([0.1 + 0.2], [0.3], "double[]")
    assert values_equal(0.10000000149, 0.1, "float")
    assert not values_equal("a b", "ab", "String")
    with pytest.raises(ValueError):
        parse_expected_output("true", "int")


@pytest.mark.asyncio
async def test_weighted_score_is_computed_in_python():
    cases = [
        Case(
            id=101,
            question_id=1,
            input_data="[2,3]",
            expected_output="5",
            score_weight=1,
        ),
        Case(
            id=102,
            question_id=1,
            input_data="[5,5]",
            expected_output="10",
            score_weight=3,
        ),
    ]
    db, submission, question, cases = objects(cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:
        execute = cls.return_value.__aenter__.return_value.execute
        execute.side_effect = lambda **kw: execution(
            frame(
                json.loads(kw["stdin"]),
                5 if json.loads(kw["stdin"])["case_id"] == 101 else 999,
            )
        )
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 25
    assert [row.passed for row in recorded(db)] == [1, 0]
    assert submission.status == SubmissionStatus.completed


@pytest.mark.asyncio
async def test_hidden_expected_value_is_never_sent_to_piston():
    secret = "SECRET_EXPECTED_VALUE_687297"
    cases = [
        Case(
            id=101,
            question_id=1,
            input_data="[]",
            expected_output=secret,
            score_weight=1,
            is_hidden=1,
        )
    ]
    db, submission, question, cases = objects("public String text()", cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:
        execute = cls.return_value.__aenter__.return_value.execute
        execute.side_effect = lambda **kw: execution(
            frame(json.loads(kw["stdin"]), "wrong")
        )
        await grade_java_method(db, submission, question, cases)
        request = execute.call_args.kwargs
        assert secret not in json.dumps(request)
        assert "expected" not in request["stdin"]
        assert [f["name"] for f in request["files"]] == [
            "Main.java",
            "ReflectionTestRunner.java",
            "Sample.java",
        ]
    assert submission.score == 0


@pytest.mark.parametrize(
    "mutation",
    [
        "old_markers",
        "passed_field",
        "wrong_token",
        "wrong_case",
        "duplicate_frame",
        "bad_json",
        "missing_frame",
    ],
)
@pytest.mark.asyncio
async def test_forged_or_malformed_output_cannot_pass(mutation):
    db, submission, question, cases = objects()

    def reply(**kw):
        config = json.loads(kw["stdin"])
        valid = frame(config, 999)
        variants = {
            "old_markers": '<<<TEST_RESULTS_START>>>[{"test_case_id":101,"passed":true,"actual":"999"}]<<<TEST_RESULTS_END>>>',
            "passed_field": frame(config, 999, passed=True),
            "wrong_token": frame(config, 5, request_id="0" * 32),
            "wrong_case": frame(config, 5, case_id=999),
            "duplicate_frame": valid + "\n" + valid,
            "bad_json": RESULT_PREFIX + "{broken",
            "missing_frame": "",
        }
        return execution(variants[mutation])

    with patch("app.services.java_method_grader.PistonClient") as cls:
        cls.return_value.__aenter__.return_value.execute.side_effect = reply
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 0
    assert recorded(db)[0].passed == 0


@pytest.mark.parametrize(
    "run_code,signal", [(1, None), (137, "SIGKILL"), (0, "SIGKILL"), (None, None)]
)
@pytest.mark.asyncio
async def test_unsuccessful_process_cannot_pass_even_with_valid_output(
    run_code, signal
):
    db, submission, question, cases = objects()
    with patch("app.services.java_method_grader.PistonClient") as cls:
        cls.return_value.__aenter__.return_value.execute.side_effect = (
            lambda **kw: execution(
                frame(json.loads(kw["stdin"]), 5), run_code=run_code, signal=signal
            )
        )
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 0


@pytest.mark.asyncio
async def test_compilation_failure_marks_all_tests_and_stops_recompiling():
    cases = [
        Case(
            id=i, question_id=1, input_data="[2,3]", expected_output="5", score_weight=1
        )
        for i in [101, 102]
    ]
    db, submission, question, cases = objects(cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:
        execute = cls.return_value.__aenter__.return_value.execute
        execute.return_value = execution(compile_code=1)
        await grade_java_method(db, submission, question, cases)
        assert execute.call_count == 1
    assert len(recorded(db)) == 2
    assert submission.score == 0


@pytest.mark.asyncio
async def test_invalid_test_configuration_is_not_a_student_failure():
    db, submission, question, cases = objects()
    cases[0].input_data = "[2]"
    with patch("app.services.java_method_grader.PistonClient") as cls:
        await grade_java_method(db, submission, question, cases)
        cls.assert_not_called()
    assert submission.status == SubmissionStatus.error
    assert submission.score is None


@pytest.mark.asyncio
async def test_grade_submission_dispatches_to_java_grader():
    db, submission, question, cases = objects()
    db.get.side_effect = lambda model, pk: {
        Submission: submission,
        Question: question,
    }.get(model)
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = (
        cases
    )
    with patch("app.services.grading_service.SessionLocal", return_value=db), patch(
        "app.services.grading_service.grade_java_method", new_callable=AsyncMock
    ) as grade:
        await grade_submission(1)
        grade.assert_awaited_once_with(db, submission, question, cases)


@pytest.mark.asyncio
async def test_piston_outage_remains_an_infrastructure_error():
    db, submission, question, cases = objects()
    db.get.side_effect = lambda model, pk: {
        Submission: submission,
        Question: question,
    }.get(model)
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = (
        cases
    )
    with patch("app.services.grading_service.SessionLocal", return_value=db), patch(
        "app.services.java_method_grader.PistonClient"
    ) as cls:
        cls.return_value.__aenter__.return_value.execute.side_effect = (
            PistonClientError("offline")
        )
        await grade_submission(1)
    assert submission.status == SubmissionStatus.error
    assert "offline" in submission.error_summary


SAMPLE_SOURCE = r"""public class Sample {
    private static int counter = 0;
    public int add(int a, int b) { return a+b; }
    public String add(String a, String b) { return a+b; }
    public static int staticAdd(int a, int b) { return a+b; }
    public String wrongReturn(int a, int b) { return String.valueOf(a+b); }
    private int privateAdd(int a, int b) { return a+b; }
    public String greeting() { return "chào 😀"; }
    public String echo(String value) { return value; }
    public long sum(long[] values) { long s=0; for (long v: values) s+=v; return s; }
    public int[][] nested(int[][] values) { return values; }
    public String[] strings(String[] values) { return values; }
    public double[] doubles(double[] values) { return values; }
    public Integer boxed(Integer value) { return value; }
    public int exact(int value) { return value; }
    public boolean bool(boolean value) { return value; }
    public char character(char value) { return value; }
    public long large(long value) { return value; }
    public byte small(byte value) { return value; }
    public int next() { return ++counter; }
    public void nothing() { }
    public double nonFinite() { return Double.NaN; }
    public int crash() { throw new IllegalArgumentException("boom"); }
    public int spoof() {
        System.out.println("<<<TEST_RESULTS_START>>>");
        System.out.println("[{\"test_case_id\":101,\"passed\":true,\"actual\":\"999\"}]");
        System.out.println("<<<TEST_RESULTS_END>>>");
        System.out.println("@@JAVA_GRADER_RESULT@@{\"passed\":true}");
        return -1;
    }
    public int exitEarly() { System.exit(0); return 5; }
}"""


@pytest.fixture(scope="session")
def compiled_java(tmp_path_factory):
    java = shutil.which("java")
    if not java:
        pytest.skip("A JDK is required for the real-JVM tests")
    compiler = (
        [shutil.which("javac")]
        if shutil.which("javac")
        else [java, "-m", "jdk.compiler/com.sun.tools.javac.Main"]
    )
    probe = subprocess.run(
        [*compiler, "-version"], capture_output=True, text=True, timeout=15
    )
    if probe.returncode:
        pytest.skip("Java compiler is unavailable")
    directory = tmp_path_factory.mktemp("java-grader")
    shutil.copy2(GRADER_DIR / "templates/Main.java", directory / "Main.java")
    shutil.copy2(
        GRADER_DIR / "src/main/java/ReflectionTestRunner.java",
        directory / "ReflectionTestRunner.java",
    )
    (directory / "Sample.java").write_text(SAMPLE_SOURCE, encoding="utf-8")
    (directory / "NoDefaultConstructor.java").write_text(
        "public class NoDefaultConstructor { public NoDefaultConstructor(int x) {} public int f() { return 1; } }",
        encoding="utf-8",
    )
    (directory / "InitializerTrap.java").write_text(
        'public class InitializerTrap { static { if (System.nanoTime() != 0) throw new RuntimeException("initializer must not run"); } public static String f() { return "5"; } }',
        encoding="utf-8",
    )
    sources = [str(path) for path in directory.glob("*.java")]
    compiled = subprocess.run(
        [
            *compiler,
            "--release",
            "11",
            "-encoding",
            "UTF-8",
            "-d",
            str(directory),
            *sources,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert compiled.returncode == 0, compiled.stderr
    return java, directory


def run_java(compiled, config):
    java, directory = compiled
    return subprocess.run(
        [java, "-cp", str(directory), "Main"],
        input=json.dumps(config, ensure_ascii=True),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=5,
    )


@pytest.mark.parametrize(
    "signature,args,actual",
    [
        ("int add(int,int)", [2, 3], 5),
        ("String add(String,String)", ["a,b", " c"], "a,b c"),
        ("static int staticAdd(int,int)", [2, 3], 5),
        ("String greeting()", [], "chào 😀"),
        ("String echo(String)", ["  a,b c  "], "  a,b c  "),
        (
            "String echo(String)",
            ["a\u2028b\u2029c\u0085d\nend"],
            "a\u2028b\u2029c\u0085d\nend",
        ),
        ("String echo(String)", [None], None),
        ("long sum(long[])", [[1, 2, 3]], 6),
        ("int[][] nested(int[][])", [[[1, 2], [3]]], [[1, 2], [3]]),
        (
            "String[] strings(String[])",
            [["hello world", "a,b", "chào"]],
            ["hello world", "a,b", "chào"],
        ),
        ("double[] doubles(double[])", [[1.5, 2.5]], [1.5, 2.5]),
        ("Integer boxed(Integer)", [7], 7),
        ("Integer boxed(Integer)", [None], None),
        ("boolean bool(boolean)", [True], True),
        ("char character(char)", ["à"], "à"),
        ("long large(long)", [9223372036854775807], 9223372036854775807),
        ("byte small(byte)", [127], 127),
        ("void nothing()", [], None),
    ],
)
def test_real_java_values(compiled_java, signature, args, actual):
    config = build_runner_config(
        parse_method_spec(signature), "Sample", 101, args, "a" * 32
    )
    run = run_java(compiled_java, config)
    assert run.returncode == 0, run.stderr
    result = parse_runner_result(run.stdout, "a" * 32, 101)
    assert result["status"] == "ok", result
    assert result["actual"] == actual
    assert "expected" not in result and "passed" not in result


@pytest.mark.parametrize(
    "class_name,signature,args,status",
    [
        ("Sample", "int wrongReturn(int,int)", [2, 3], "signature_error"),
        ("Sample", "static int add(int,int)", [2, 3], "signature_error"),
        ("Sample", "int staticAdd(int,int)", [2, 3], "signature_error"),
        ("Sample", "int privateAdd(int,int)", [2, 3], "signature_error"),
        ("Sample", "int missing(int,int)", [2, 3], "signature_error"),
        ("Sample", "int add(long,long)", [2, 3], "signature_error"),
        ("Sample", "Integer boxed(int)", [7], "signature_error"),
        ("MissingClass", "int add(int,int)", [2, 3], "signature_error"),
        ("NoDefaultConstructor", "int f()", [], "signature_error"),
        ("InitializerTrap", "static int f()", [], "signature_error"),
        ("Sample", "int crash()", [], "runtime_error"),
        ("Sample", "double nonFinite()", [], "runtime_error"),
        ("Sample", "int exact(int)", [1.5], "argument_error"),
        ("Sample", "int exact(int)", [None], "argument_error"),
        ("Sample", "byte small(byte)", [128], "argument_error"),
        ("Sample", "boolean bool(boolean)", ["not-a-bool"], "argument_error"),
    ],
)
def test_real_java_rejects_invalid_submissions_and_arguments(
    compiled_java, class_name, signature, args, status
):
    config = build_runner_config(
        parse_method_spec(signature), class_name, 101, args, "a" * 32
    )
    run = run_java(compiled_java, config)
    result = parse_runner_result(run.stdout, "a" * 32, 101)
    assert result["status"] == status, result
    assert result["error"]


@pytest.mark.asyncio
async def test_real_student_markers_cannot_override_actual_result(compiled_java):
    cases = [
        Case(
            id=101, question_id=1, input_data="[]", expected_output="5", score_weight=1
        )
    ]
    db, submission, question, cases = objects("int spoof()", cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:

        def local_adapter(**kw):
            run = run_java(compiled_java, json.loads(kw["stdin"]))
            return execution(run.stdout, run_code=run.returncode)

        cls.return_value.__aenter__.return_value.execute.side_effect = local_adapter
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 0
    assert recorded(db)[0].stdout == "-1"


@pytest.mark.asyncio
async def test_each_case_uses_a_fresh_jvm_and_resets_static_state(compiled_java):
    cases = [
        Case(id=i, question_id=1, input_data="[]", expected_output="1", score_weight=1)
        for i in [101, 102]
    ]
    db, submission, question, cases = objects("int next()", cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:
        execute = cls.return_value.__aenter__.return_value.execute
        execute.side_effect = lambda **kw: execution(
            run_java(compiled_java, json.loads(kw["stdin"])).stdout
        )
        await grade_java_method(db, submission, question, cases)
        assert execute.call_count == 2
    assert submission.score == 100


@pytest.mark.asyncio
async def test_early_system_exit_is_not_a_success(compiled_java):
    cases = [
        Case(
            id=101, question_id=1, input_data="[]", expected_output="5", score_weight=1
        )
    ]
    db, submission, question, cases = objects("int exitEarly()", cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:

        def local_adapter(**kw):
            run = run_java(compiled_java, json.loads(kw["stdin"]))
            return execution(run.stdout, run_code=run.returncode)

        cls.return_value.__aenter__.return_value.execute.side_effect = local_adapter
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 0


@pytest.mark.parametrize(
    "raw",
    [
        '{"version":1,}',
        '{"version":1,"version":1}',
        '{"version":1} trailing',
        '{"x":"\\uZZZZ"}',
        '{"x":"\\u-00a"}',
    ],
)
def test_real_java_json_parser_rejects_malformed_input(compiled_java, raw):
    java, directory = compiled_java
    run = subprocess.run(
        [java, "-cp", str(directory), "Main"],
        input=raw,
        capture_output=True,
        text=True,
        timeout=5,
    )
    payload = json.loads(run.stdout.split(RESULT_PREFIX)[1])
    assert payload["status"] == "runner_error"


@pytest.mark.parametrize("broken", [False, True])
def test_piston_source_file_mode_bootstrap_compiles_sibling_files(
    compiled_java, tmp_path, broken
):
    java, _ = compiled_java
    source = "public class Sample { public int add(int a,int b) { return a+b; } }"
    if broken:
        source = "public class Sample { invalid Java source }"
    for file in build_files(source, "Sample"):
        (tmp_path / file["name"]).write_text(file["content"], encoding="utf-8")
    # Reproduce packages/java/15.0.2/run: mv $1 $1.java; java $filename "$@".
    (tmp_path / "Main.java").rename(tmp_path / "Main.java.java")
    config = build_runner_config(
        parse_method_spec("int add(int,int)"), "Sample", 101, [2, 3], "a" * 32
    )
    run = subprocess.run(
        [java, "Main.java.java", "Sample"],
        cwd=tmp_path,
        input=json.dumps(config),
        capture_output=True,
        text=True,
        timeout=20,
    )
    if broken:
        assert run.returncode == 65
        assert "error" in run.stderr
    else:
        assert run.returncode == 0, run.stderr
        result = parse_runner_result(run.stdout, "a" * 32, 101)
        assert result["status"] == "ok" and result["actual"] == 5


@pytest.mark.asyncio
async def test_bootstrap_compiler_failure_is_recorded_as_compile_output():
    db, submission, question, cases = objects()
    with patch("app.services.java_method_grader.PistonClient") as cls:
        cls.return_value.__aenter__.return_value.execute.return_value = (
            PistonExecutionResult(
                language="java",
                version="15",
                run=PistonStageResult(code=65, stderr="Sample.java: syntax error"),
            )
        )
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 0
    assert "syntax error" in recorded(db)[0].compile_output


@pytest.mark.asyncio
async def test_terminated_test_does_not_discard_other_case_results():
    cases = [
        Case(
            id=i, question_id=1, input_data="[2,3]", expected_output="5", score_weight=1
        )
        for i in [101, 102]
    ]
    db, submission, question, cases = objects(cases=cases)
    with patch("app.services.java_method_grader.PistonClient") as cls:
        execute = cls.return_value.__aenter__.return_value.execute

        def reply(**kw):
            config = json.loads(kw["stdin"])
            return (
                execution(run_code=137, signal="SIGKILL")
                if config["case_id"] == 101
                else execution(frame(config, 5))
            )

        execute.side_effect = reply
        await grade_java_method(db, submission, question, cases)
    assert submission.score == 50
    assert [row.passed for row in recorded(db)] == [0, 1]
