import { Exam, Question, TestCase } from "@/types";
import { gradeSubmissionLocally } from "./grading";

export interface VerificationCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface QuestionVerification {
  questionId: number;
  title: string;
  points: number;
  passed: boolean;
  score: number | null;
  checks: VerificationCheck[];
  errorSummary: string | null;
}

export interface ExamVerification {
  examId: number;
  examTitle: string;
  checkedAt: string;
  passed: boolean;
  totalScore: number | null;
  totalPoints: number;
  resultStatus: "ready" | "needs_fixes" | "no_questions";
  questions: QuestionVerification[];
}

export interface ExamVerificationSummary {
  examId: number;
  checkedAt: string;
  passed: boolean;
}

const DEMO_REFERENCE_SOLUTION = `import java.util.Scanner;

public class Solution {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        String[] words = scanner.nextLine().split(" ");
        StringBuilder reversed = new StringBuilder();
        for (int i = words.length - 1; i >= 0; i--) {
            reversed.append(words[i]);
        }
        int value = 100;
        for (int factor = 2; factor <= value; factor++) {
            while (value % factor == 0) {
                value = value / factor;
            }
        }
        System.out.println(reversed.toString());
    }

    public static int evaluateExpression(String op, int a, int b) {
        if (op.equals("add")) return a + b;
        if (op.equals("sub")) return a - b;
        if (op.equals("mul")) return a * b;
        if (op.equals("div")) return b == 0 ? -1 : a / b;
        return 0;
    }
}`;

const JAVA_METHOD_TYPES = new Set([
  "boolean",
  "byte",
  "short",
  "int",
  "long",
  "float",
  "double",
  "char",
  "String",
  "Boolean",
  "Byte",
  "Short",
  "Integer",
  "Long",
  "Float",
  "Double",
  "Character",
]);
const JAVA_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const JAVA_METHOD_TYPE = /^([A-Za-z_$][A-Za-z0-9_$.]*)(?:\s*\[\s*\])*$/;

function isSupportedJavaMethodType(type: string, allowVoid = false): boolean {
  const match = JAVA_METHOD_TYPE.exec(type.trim());
  if (!match) return false;
  const baseType = match[1].replace(/^java\.lang\./, "");
  const isArray = /\[/.test(type);
  if (baseType === "void") return allowVoid && !isArray;
  return JAVA_METHOD_TYPES.has(baseType);
}

function methodArgumentCount(argumentsText: string): number | null {
  if (!argumentsText.trim()) return 0;
  let count = 1;
  let insideQuotes = false;
  let quoteCharacter = "";
  let escaped = false;
  const delimiters: string[] = [];
  for (let index = 0; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];
    if (insideQuotes) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quoteCharacter) {
        insideQuotes = false;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      insideQuotes = true;
      quoteCharacter = character;
    } else if (character === "(" || character === "[" || character === "{") {
      delimiters.push(character);
    } else if (character === ")" || character === "]" || character === "}") {
      const expectedOpening =
        character === ")" ? "(" : character === "]" ? "[" : "{";
      if (delimiters.pop() !== expectedOpening) return null;
    } else if (character === "," && delimiters.length === 0) {
      count += 1;
    }
  }
  return insideQuotes || delimiters.length > 0 ? null : count;
}

function expectedAnswer(question: Question, testCase: TestCase): string {
  const value =
    question.question_type === "JAVA_CLASS_METHOD"
      ? testCase.expected_return
      : testCase.expected_stdout;
  return (value || "").trim();
}

function hasGradingContract(question: Question): boolean {
  if (question.question_type === "STDIN_STDOUT") {
    return question.language === "java" || question.language === "python";
  }
  if (
    question.question_type === "JAVA_CLASS_METHOD" &&
    question.language === "java" &&
    question.class_name &&
    JAVA_IDENTIFIER.test(question.class_name) &&
    question.method_name &&
    JAVA_IDENTIFIER.test(question.method_name) &&
    question.return_type?.trim() &&
    (question.method_mode === "STATIC" || question.method_mode === "INSTANCE") &&
    question.parameter_types !== undefined
  ) {
    const parameterTypes = question.parameter_types
      ? question.parameter_types.split(",").map((type) => type.trim())
      : [];
    return (
      isSupportedJavaMethodType(question.return_type, true) &&
      parameterTypes.every((type) => isSupportedJavaMethodType(type))
    );
  }
  return false;
}

export function buildExamVerification(
  exam: Exam | undefined,
  examId: number,
  examQuestions: Question[],
  testCasesByQuestion: Record<number, TestCase[]>,
  backendGradingAvailable: boolean
): ExamVerification {
  const checkedAt = new Date().toISOString();
  const examTitle = exam?.title || `Examination #${examId}`;
  let localDemoScore = 0;
  let localDemoGradingAvailable = true;

  const questions = examQuestions.map((question): QuestionVerification => {
    const cases = testCasesByQuestion[question.id] || [];
    const missingAnswers = cases.filter((testCase) => !expectedAnswer(question, testCase));
    const invalidWeights = cases.filter(
      (testCase) => !Number.isFinite(testCase.weight) || testCase.weight <= 0
    );
    const methodArgumentsValid =
      question.question_type !== "JAVA_CLASS_METHOD" ||
      cases.every(
        (testCase) =>
          methodArgumentCount(testCase.arguments || "") ===
          (question.parameter_types
            ? question.parameter_types.split(",").filter((type) => type.trim()).length
            : 0)
      );
    const localOutcome = backendGradingAvailable
      ? null
      : gradeSubmissionLocally(
          900000 + question.id,
          question,
          cases,
          DEMO_REFERENCE_SOLUTION
        );
    const localQuestionSupported = localOutcome?.status === "completed";
    if (localQuestionSupported && localOutcome.score !== null) {
      localDemoScore += localOutcome.score;
    } else if (!backendGradingAvailable) {
      localDemoGradingAvailable = false;
    }

    const gradingAvailable = backendGradingAvailable
      ? hasGradingContract(question)
      : localQuestionSupported;

    const checks: VerificationCheck[] = [
      {
        label: "Test cases configured",
        passed: cases.length > 0,
        detail:
          cases.length > 0
            ? `${cases.length} test case${cases.length === 1 ? "" : "s"} found`
            : "Add at least one test case to this question",
      },
      {
        label: "Expected answers stored",
        passed: cases.length > 0 && missingAnswers.length === 0,
        detail:
          cases.length === 0
            ? "Add at least one test case with an expected answer"
            : missingAnswers.length > 0
              ? `${missingAnswers.length} test case${missingAnswers.length === 1 ? "" : "s"} missing an expected answer`
              : "Every test case has an expected answer",
      },
      {
        label: "Grading configuration recognized",
        passed: gradingAvailable,
        detail: backendGradingAvailable
          ? gradingAvailable
            ? question.question_type === "JAVA_CLASS_METHOD"
              ? "Backend Java method grader and method contract are configured"
              : "Backend stdin/stdout grader is available"
            : "The question type or Java method contract is not supported"
          : gradingAvailable
            ? "This seeded question is supported by the offline demo grader"
            : "Custom questions require the backend grading service; sign in with a backend account",
      },
      {
        label: "Score weights valid",
        passed: cases.length > 0 && invalidWeights.length === 0 && question.points > 0,
        detail:
          cases.length === 0
            ? "Add test cases with positive score weights"
            : question.points <= 0
              ? "Set a positive total score for this question"
              : invalidWeights.length > 0
              ? `${invalidWeights.length} test case${invalidWeights.length === 1 ? "" : "s"} must have a positive score weight`
              : "Every test case has a positive score weight",
      },
      {
        label: "Method arguments match signature",
        passed:
          question.question_type !== "JAVA_CLASS_METHOD" ||
          (cases.length > 0 && methodArgumentsValid),
        detail:
          question.question_type !== "JAVA_CLASS_METHOD"
            ? "Not required for stdin/stdout questions"
            : cases.length === 0
              ? "Add method test cases matching the configured parameter count"
              : methodArgumentsValid
                ? "Every test case has the configured number of arguments"
                : "A test case has malformed arguments or the wrong number of values",
      },
    ];

    return {
      questionId: question.id,
      title: question.title,
      points: question.points,
      passed: checks.every((check) => check.passed),
      score:
        localOutcome?.status === "completed" ? localOutcome.score : null,
      checks,
      errorSummary:
        localOutcome?.status === "error" ? localOutcome.error_summary : null,
    };
  });

  const passed = questions.length > 0 && questions.every((question) => question.passed);
  return {
    examId,
    examTitle,
    checkedAt,
    passed,
    totalScore:
      !backendGradingAvailable && localDemoGradingAvailable
        ? localDemoScore
        : null,
    totalPoints: examQuestions.reduce((sum, question) => sum + question.points, 0),
    resultStatus:
      questions.length === 0 ? "no_questions" : passed ? "ready" : "needs_fixes",
    questions,
  };
}
