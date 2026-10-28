import base64
import csv
import io
import math
import re
from dataclasses import dataclass

from app.models.question import Question
from app.models.test_case import TestCase


_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
_SUPPORTED_TYPES = {
    "boolean": ("boolean.class", "boolean"),
    "byte": ("byte.class", "byte"),
    "short": ("short.class", "short"),
    "int": ("int.class", "int"),
    "long": ("long.class", "long"),
    "float": ("float.class", "float"),
    "double": ("double.class", "double"),
    "char": ("char.class", "char"),
    "String": ("String.class", "String"),
    "Boolean": ("Boolean.class", "Boolean"),
    "Byte": ("Byte.class", "Byte"),
    "Short": ("Short.class", "Short"),
    "Integer": ("Integer.class", "Integer"),
    "Long": ("Long.class", "Long"),
    "Float": ("Float.class", "Float"),
    "Double": ("Double.class", "Double"),
    "Character": ("Character.class", "Character"),
}
_NUMBER_PATTERNS = {
    "byte": re.compile(r"^[+-]?\d+$"),
    "short": re.compile(r"^[+-]?\d+$"),
    "int": re.compile(r"^[+-]?\d+$"),
    "long": re.compile(r"^[+-]?\d+$"),
    "float": re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$"),
    "double": re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$"),
}
_WRAPPER_TYPES = {
    "Boolean": "boolean",
    "Byte": "byte",
    "Short": "short",
    "Integer": "int",
    "Long": "long",
    "Float": "float",
    "Double": "double",
    "Character": "char",
}


@dataclass(frozen=True)
class JavaMethodContract:
    method_name: str
    parameter_types: tuple[str, ...]
    return_type: str


def parse_method_contract(question: Question) -> JavaMethodContract:
    class_name = question.class_name or ""
    signature = question.method_signature or ""
    if not _IDENTIFIER.fullmatch(class_name):
        raise ValueError("The required Java class name must be a simple class identifier")

    match = re.fullmatch(
        r"\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\((.*)\)\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*",
        signature,
    )
    if not match:
        raise ValueError(
            "The Java method signature must use the format methodName(type, ...): returnType"
        )

    method_name, parameters_text, return_type = match.groups()
    parameter_types = tuple(
        item.strip() for item in parameters_text.split(",") if item.strip()
    )
    if parameters_text.strip() and len(parameter_types) != len(
        [item for item in parameters_text.split(",")]
    ):
        raise ValueError("The Java method signature contains an empty parameter type")

    unsupported_types = [
        type_name
        for type_name in (*parameter_types, return_type)
        if type_name not in _SUPPORTED_TYPES
    ]
    if unsupported_types:
        raise ValueError(
            "Unsupported Java method type(s): "
            + ", ".join(sorted(set(unsupported_types)))
            + ". Supported types are primitives and their wrappers, plus String."
        )

    return JavaMethodContract(method_name, parameter_types, return_type)


def _parse_arguments(arguments: str, contract: JavaMethodContract) -> list[str]:
    if not arguments.strip():
        values: list[str] = []
    else:
        try:
            rows = list(
                csv.reader(io.StringIO(arguments), skipinitialspace=True, strict=True)
            )
        except csv.Error as exc:
            raise ValueError(f"Invalid method arguments: {exc}") from exc
        if len(rows) != 1:
            raise ValueError("Method arguments must be a single comma-separated row")
        values = rows[0]

    if len(values) != len(contract.parameter_types):
        raise ValueError(
            f"Expected {len(contract.parameter_types)} method argument(s), received {len(values)}"
        )

    for index, (value, type_name) in enumerate(zip(values, contract.parameter_types), start=1):
        primitive_type = _WRAPPER_TYPES.get(type_name, type_name)
        if primitive_type == "boolean":
            if value.strip().lower() not in {"true", "false"}:
                raise ValueError(f"Argument {index} must be true or false")
        elif primitive_type == "char":
            if len(value) != 1:
                raise ValueError(f"Argument {index} must be a single character")
        elif primitive_type in _NUMBER_PATTERNS:
            normalized = value.strip()
            if not _NUMBER_PATTERNS[primitive_type].fullmatch(normalized):
                raise ValueError(f"Argument {index} must be a valid {type_name}")
            if primitive_type in {"float", "double"} and not math.isfinite(float(normalized)):
                raise ValueError(f"Argument {index} must be a finite {type_name}")
            values[index - 1] = normalized
        else:
            values[index - 1] = value
    return values


def build_method_harness(
    question: Question, test_case: TestCase
) -> tuple[str, str, str]:
    contract = parse_method_contract(question)
    class_name = question.class_name or ""
    values = _parse_arguments(test_case.input_data or "", contract)
    encoded_values = [
        base64.b64encode(value.encode("utf-8")).decode("ascii") for value in values
    ]

    parameter_classes = ", ".join(
        _SUPPORTED_TYPES[type_name][0] for type_name in contract.parameter_types
    )
    parameter_classes_array = (
        f"new Class<?>[]{{{parameter_classes}}}" if parameter_classes else "new Class<?>[0]"
    )
    invocation_arguments = ", ".join(
        f"parseArg(encodedArguments[{index}], \"{_SUPPORTED_TYPES[type_name][1]}\")"
        for index, type_name in enumerate(contract.parameter_types)
    )
    argument_array = (
        f"new Object[]{{{invocation_arguments}}}" if invocation_arguments else "new Object[0]"
    )
    return_type = _SUPPORTED_TYPES[contract.return_type][0]
    mode = (question.method_mode or "STATIC").upper()
    if mode not in {"STATIC", "INSTANCE"}:
        raise ValueError("Method mode must be STATIC or INSTANCE")
    encoded_stdin = "".join(f"{value}\n" for value in encoded_values)

    harness = f"""import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class Main {{
    private static Object parseArg(String encoded, String type) {{
        String value = new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
        switch (type) {{
            case "boolean": case "Boolean": return Boolean.valueOf(value);
            case "byte": case "Byte": return Byte.valueOf(value);
            case "short": case "Short": return Short.valueOf(value);
            case "int": case "Integer": return Integer.valueOf(value);
            case "long": case "Long": return Long.valueOf(value);
            case "float": case "Float": return Float.valueOf(value);
            case "double": case "Double": return Double.valueOf(value);
            case "char": case "Character": return value.charAt(0);
            default: return value;
        }}
    }}

    public static void main(String[] args) throws Exception {{
        Class<?> targetClass = Class.forName("{class_name}");
        Method method = targetClass.getDeclaredMethod(
            "{contract.method_name}", {parameter_classes_array});
        if (method.getReturnType() != {return_type}) {{
            throw new IllegalArgumentException("Method return type does not match the question contract");
        }}
        boolean isStatic = Modifier.isStatic(method.getModifiers());
        if (isStatic != {str(mode == "STATIC").lower()}) {{
            throw new IllegalArgumentException("Method static/instance mode does not match the question contract");
        }}
        method.setAccessible(true);
        Object target = null;
        if (!isStatic) {{
            java.lang.reflect.Constructor<?> constructor = targetClass.getDeclaredConstructor();
            constructor.setAccessible(true);
            target = constructor.newInstance();
        }}
        BufferedReader reader = new BufferedReader(
            new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String[] encodedArguments = new String[{len(encoded_values)}];
        for (int i = 0; i < encodedArguments.length; i++) {{
            encodedArguments[i] = reader.readLine();
            if (encodedArguments[i] == null) {{
                throw new IllegalArgumentException("Missing method argument input");
            }}
        }}
        Object result = method.invoke(target, {argument_array});
        if (result != null) System.out.print(result.toString());
    }}
}}
"""
    return f"{class_name}.java", harness, encoded_stdin
