import { Exam, Question, Submission, TestCase } from "@/types";
import { buildExamResult, ExamResultStatus, formatScore } from "./exam-results";
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
  totalScore: number;
  totalPoints: number;
  resultStatus: ExamResultStatus | "no_questions";
  questions: QuestionVerification[];
}

export interface ExamVerificationSummary {
  examId: number;
  checkedAt: string;
  passed: boolean;
}

const REFERENCE_SOLUTION = `import java.util.Scanner;

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
        if (op.equals("add")) {
            return a + b;
        }
        if (op.equals("sub")) {
            return a - b;
        }
        if (op.equals("mul")) {
            return a * b;
        }
        if (op.equals("div")) {
            if (b == 0) {
                return -1;
            }
            return a / b;
        }
        return 0;
    }
}`;

function expectedAnswer(question: Question, testCase: TestCase): string {
  const value =
    question.question_type === "JAVA_CLASS_METHOD"
      ? testCase.expected_return
      : testCase.expected_stdout;
  return (value || "").trim();
}

export function buildExamVerification(
  exam: Exam | undefined,
  examId: number,
  examQuestions: Question[],
  testCasesByQuestion: Record<number, TestCase[]>
): ExamVerification {
  const checkedAt = new Date().toISOString();
  const examTitle = exam?.title || `Examination #${examId}`;

  const questions: QuestionVerification[] = examQuestions.map((question) => {
    const cases = testCasesByQuestion[question.id] || [];
    const missingAnswers = cases.filter(
      (testCase) => !expectedAnswer(question, testCase)
    );
    const outcome = gradeSubmissionLocally(
      900000 + question.id,
      question,
      cases,
      REFERENCE_SOLUTION
    );
    const fullScoreReached =
      outcome.status === "completed" &&
      outcome.score !== null &&
      outcome.score >= question.points - 0.001;

    const checks: VerificationCheck[] = [
      {
        label: "Test cases configured",
        passed: cases.length > 0,
        detail:
          cases.length > 0
            ? `${cases.length} test case${cases.length === 1 ? "" : "s"} found`
            : "No test cases are attached to this question",
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
        label: "Grading reference recognized",
        passed: outcome.status !== "error",
        detail:
          outcome.status === "error"
            ? outcome.error_summary || "The grader rejected this question"
            : "Reference solution was accepted by the grader",
      },
      {
        label: "Full score reachable",
        passed: fullScoreReached,
        detail:
          outcome.status === "completed"
            ? `${formatScore(outcome.score)} / ${formatScore(question.points)} points on the reference run`
            : "A reference run could not produce a full score",
      },
    ];

    return {
      questionId: question.id,
      title: question.title,
      points: question.points,
      passed: checks.every((check) => check.passed),
      score: outcome.status === "completed" ? outcome.score : null,
      checks,
      errorSummary: outcome.status === "error" ? outcome.error_summary : null,
    };
  });

  const syntheticSubmissions: Submission[] = examQuestions.map((question) => {
    const cases = testCasesByQuestion[question.id] || [];
    const outcome = gradeSubmissionLocally(
      900000 + question.id,
      question,
      cases,
      REFERENCE_SOLUTION
    );
    return {
      id: 900000 + question.id,
      student_id: 0,
      student_name: "Verification Run",
      student_username: "verification",
      question_id: question.id,
      question_title: question.title,
      exam_id: examId,
      exam_title: examTitle,
      language: question.language,
      source_code: REFERENCE_SOLUTION,
      status: outcome.status,
      score: outcome.score,
      max_score: question.points,
      submitted_at: checkedAt,
      graded_at: checkedAt,
      test_results: outcome.test_results,
      error_summary: outcome.error_summary,
    };
  });

  const projectedResult = buildExamResult(
    examId,
    exam,
    examQuestions,
    syntheticSubmissions,
    false
  );

  return {
    examId,
    examTitle,
    checkedAt,
    passed: questions.length > 0 && questions.every((question) => question.passed),
    totalScore: projectedResult.totalScore,
    totalPoints: projectedResult.totalPoints,
    resultStatus: questions.length === 0 ? "no_questions" : projectedResult.status,
    questions,
  };
}
