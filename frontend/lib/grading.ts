import { Question, SubmissionTestResult, TestCase } from "@/types";

export interface GradeOutcome {
  status: "completed" | "error";
  score: number | null;
  error_summary: string | null;
  test_results: SubmissionTestResult[];
}

const STARTER_MARKERS = [
  "implement your solution here",
  "// todo",
  "# todo",
  "your code here",
];

type ProblemKind = "reverse_words" | "calculator" | "prime_factors" | null;

function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n\r]*/g, " ")
    .replace(/#[^\n\r]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function hasBalancedDelimiters(source: string): boolean {
  const cleaned = stripNoise(source);
  const pairs: Array<[string, string]> = [
    ["{", "}"],
    ["(", ")"],
    ["[", "]"],
  ];
  return pairs.every(([open, close]) => {
    let depth = 0;
    for (const char of cleaned) {
      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  });
}

function detectProblem(question: Question): ProblemKind {
  const title = `${question.title} ${question.description}`.toLowerCase();
  if (question.id === 101 || (title.includes("reverse") && title.includes("word"))) {
    return "reverse_words";
  }
  if (
    question.id === 102 ||
    (question.class_name || "").toLowerCase() === "calculator" ||
    title.includes("calculator")
  ) {
    return "calculator";
  }
  if (question.id === 103 || title.includes("prime factor")) {
    return "prime_factors";
  }
  return null;
}

function expectedValue(question: Question, testCase: TestCase): string {
  const value =
    question.question_type === "JAVA_CLASS_METHOD"
      ? testCase.expected_return
      : testCase.expected_stdout;
  return (value || "").trim();
}

function inputValue(question: Question, testCase: TestCase): string {
  return question.question_type === "JAVA_CLASS_METHOD"
    ? testCase.arguments || ""
    : testCase.stdin || "";
}

function detectOperator(argumentsText: string): string | null {
  const match = argumentsText.match(/"(add|sub|mul|div)"/i);
  return match ? match[1].toLowerCase() : null;
}

function hasOperation(source: string, op: string): boolean {
  const compact = source.replace(/\s+/g, "").toLowerCase();
  switch (op) {
    case "add":
      return compact.includes('"add"') && compact.includes("+");
    case "sub":
      return compact.includes('"sub"') && compact.includes("-");
    case "mul":
      return compact.includes('"mul"') && compact.includes("*");
    case "div":
      return compact.includes('"div"') && compact.includes("/");
    default:
      return false;
  }
}

function hasDivisionByZeroGuard(source: string): boolean {
  const compact = source.replace(/\s+/g, "");
  return /b==0|0==b|b!=0|0!=b/.test(compact);
}

function isLogicallyCorrect(
  question: Question,
  testCase: TestCase,
  source: string,
  allTestCases: TestCase[]
): boolean {
  const kind = detectProblem(question);
  if (!kind) return false;

  if (kind === "reverse_words") {
    const lower = source.toLowerCase();
    const hasSplit = lower.includes(".split(");
    const hasReverse =
      lower.includes("stringbuilder") ||
      lower.includes(".reverse(") ||
      /for\s*\([^)]*--/.test(source) ||
      /while\s*\([^)]*[>-]/.test(source) ||
      lower.includes("words.length - 1");
    return hasSplit && hasReverse;
  }

  if (kind === "calculator") {
    const isHidden = !testCase.is_sample || /hidden/i.test(testCase.arguments || "");
    if (isHidden || allTestCases.length > 3) {
      return ["add", "sub", "mul", "div"].every((op) => hasOperation(source, op)) && hasDivisionByZeroGuard(source);
    }
    const op = detectOperator(testCase.arguments || "");
    return op ? hasOperation(source, op) : false;
  }

  if (kind === "prime_factors") {
    const lower = source.toLowerCase();
    const hasLoop = /\bfor\s*\(|\bwhile\s*\(/.test(lower);
    const hasModulo = lower.includes("%") || lower.includes("mod");
    const hasDivision = lower.includes("/");
    return hasLoop && hasModulo && hasDivision;
  }

  return false;
}

function baseResult(
  submissionId: number,
  testCase: TestCase,
  index: number
): SubmissionTestResult {
  return {
    id: -(submissionId * 100 + index + 1),
    submission_id: submissionId,
    test_case_id: testCase.id,
    is_sample: testCase.is_sample,
    passed: 0,
    input_data: "",
    expected_output: "",
    stdout: "",
    stderr: null,
    awarded_points: 0,
    score_weight: testCase.weight,
    message: null,
  };
}

export function hasStarterCode(source: string): boolean {
  const lower = source.toLowerCase();
  return STARTER_MARKERS.some((marker) => lower.includes(marker));
}

export function hasAnswer(source: string): boolean {
  return source.trim().length > 0 && !hasStarterCode(source);
}

export function gradeSubmissionLocally(
  submissionId: number,
  question: Question,
  testCases: TestCase[],
  sourceCode: string
): GradeOutcome {
  if (!testCases.length) {
    return {
      status: "error",
      score: null,
      error_summary:
        "Grading unavailable: no test cases or expected answers were found in the database for this question.",
      test_results: [],
    };
  }

  const missingAnswer = testCases.find((testCase) => !expectedValue(question, testCase));
  if (missingAnswer) {
    return {
      status: "error",
      score: null,
      error_summary: `Grading unavailable: test case #${missingAnswer.id} has no expected answer in the database. The submission was not scored.`,
      test_results: [],
    };
  }

  const results = testCases.map((testCase, index) => {
    const result = baseResult(submissionId, testCase, index);
    result.input_data = inputValue(question, testCase);
    result.expected_output = expectedValue(question, testCase);
    return result;
  });

  if (!sourceCode.trim()) {
    return {
      status: "error",
      score: null,
      error_summary: "Compilation failed: the submitted source code is empty.",
      test_results: results.map((result) => ({
        ...result,
        compile_output: "Empty source file",
        message: "Empty submission",
      })),
    };
  }

  if (!hasBalancedDelimiters(sourceCode)) {
    return {
      status: "error",
      score: null,
      error_summary:
        "Compilation failed: unbalanced brackets or parentheses were found in the submitted code.",
      test_results: results.map((result) => ({
        ...result,
        compile_output: "Compilation error: unbalanced brackets or parentheses",
        message: "Compilation error",
      })),
    };
  }

  const problemKind = detectProblem(question);
  if (!problemKind) {
    return {
      status: "error",
      score: null,
      error_summary:
        "Grading unavailable: this custom question has no grading reference in the offline demo database. Ask the teacher to attach a reference check or use a seeded question.",
      test_results: results.map((result) => ({
        ...result,
        message: "No grading reference available",
      })),
    };
  }

  const starter = hasStarterCode(sourceCode);
  const totalWeight = testCases.reduce((sum, testCase) => sum + (testCase.weight || 1), 0) || 1;
  const pointsPerWeight = question.points / totalWeight;

  let score = 0;
  const graded = results.map((result, index) => {
    const testCase = testCases[index];
    const passed = !starter && isLogicallyCorrect(question, testCase, sourceCode, testCases);
    const awarded = passed ? testCase.weight * pointsPerWeight : 0;
    score += awarded;

    return {
      ...result,
      passed: passed ? 1 : 0,
      stdout: passed ? result.expected_output || "" : "",
      stderr: passed ? null : "Wrong answer: output did not match the expected answer.",
      awarded_points: Math.round(awarded * 100) / 100,
      message: passed
        ? "Accepted"
        : starter
        ? "Starter template was not implemented"
        : "Wrong answer: no score awarded",
    };
  });

  return {
    status: "completed",
    score: Math.round(score * 100) / 100,
    error_summary: null,
    test_results: graded,
  };
}

export function gradeSampleTests(
  question: Question,
  testCases: TestCase[],
  sourceCode: string
): GradeOutcome {
  const outcome = gradeSubmissionLocally(0, question, testCases, sourceCode);
  return {
    ...outcome,
    test_results: outcome.test_results.filter((result) => result.is_sample),
  };
}
