import pytest

from app.models.question import Question
from app.models.test_case import TestCase
from app.services.java_method_grader import build_method_harness


def test_builds_static_java_method_harness_and_uses_test_case_arguments():
    question = Question(
        class_name="Calculator",
        method_signature="evaluateExpression(String, int, int): int",
        method_mode="STATIC",
    )
    test_case = TestCase(
        input_data='"add", 10, 25',
        expected_output="35",
    )

    student_file, harness, stdin = build_method_harness(question, test_case)

    assert student_file == "Calculator.java"
    assert 'getDeclaredMethod(\n            "evaluateExpression"' in harness
    assert "String.class, int.class, int.class" in harness
    assert "Modifier.isStatic(method.getModifiers())" in harness
    assert "reader.readLine()" in harness
    assert '"YWRk"' not in harness
    assert stdin == "YWRk\nMTA=\nMjU=\n"


def test_builds_instance_method_harness():
    question = Question(
        class_name="Counter",
        method_signature="increment(int): int",
        method_mode="INSTANCE",
    )
    test_case = TestCase(input_data="4", expected_output="5")

    _, harness, _ = build_method_harness(question, test_case)

    assert "targetClass.getDeclaredConstructor()" in harness
    assert "Modifier.isStatic(method.getModifiers())" in harness
    assert "false" in harness


@pytest.mark.parametrize(
    ("signature", "arguments", "error"),
    [
        ("sum(int, int): int", "1", "Expected 2 method argument"),
        ("sum(int): int", "not-a-number", "must be a valid int"),
        ("sum(List<String>): int", "1", "Unsupported Java method type"),
    ],
)
def test_rejects_invalid_method_contracts(signature, arguments, error):
    question = Question(
        class_name="Calculator",
        method_signature=signature,
        method_mode="STATIC",
    )
    test_case = TestCase(input_data=arguments, expected_output="1")

    with pytest.raises(ValueError, match=error):
        build_method_harness(question, test_case)
