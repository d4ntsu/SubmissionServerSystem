import { Exam, Question, Submission } from "@/types";

export type ExamResultStatus =
  | "not_submitted"
  | "grading"
  | "error"
  | "passed"
  | "partial"
  | "failed"
  | "hidden";

export interface ExamQuestionScore {
  questionId: number;
  question?: Question;
  title: string;
  points: number;
  submission: Submission | null;
  visible: boolean;
  status: "not_submitted" | Submission["status"];
  score: number | null;
  passedTests: number;
  totalTests: number;
}

export interface ExamResult {
  examId: number;
  examTitle: string;
  exam?: Exam;
  questions: ExamQuestionScore[];
  totalScore: number;
  totalPoints: number;
  submittedCount: number;
  questionCount: number;
  passedTests: number;
  totalTests: number;
  fullyCorrectCount: number;
  pendingCount: number;
  errorCount: number;
  hiddenCount: number;
  lastSubmittedAt: string | null;
  status: ExamResultStatus;
}

function submittedTime(submission: Submission): number {
  const time = new Date(submission.submitted_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestSubmissionsByQuestion(submissions: Submission[]): Map<number, Submission> {
  const latest = new Map<number, Submission>();

  submissions.forEach((submission) => {
    const previous = latest.get(submission.question_id);
    if (
      !previous ||
      submittedTime(submission) > submittedTime(previous) ||
      (submittedTime(submission) === submittedTime(previous) && submission.id > previous.id)
    ) {
      latest.set(submission.question_id, submission);
    }
  });

  return latest;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Pending";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function buildExamResult(
  examId: number,
  exam: Exam | undefined,
  examQuestions: Question[] | undefined,
  submissions: Submission[],
  isTeacher = false
): ExamResult {
  const examSubmissions = submissions.filter((submission) => submission.exam_id === examId);
  const latestByQuestion = latestSubmissionsByQuestion(examSubmissions);

  const baseQuestions = examQuestions || [];
  const extraQuestionIds = Array.from(latestByQuestion.keys())
    .filter((questionId) => !baseQuestions.some((question) => question.id === questionId))
    .sort((a, b) => a - b);

  const questions: ExamQuestionScore[] = [
    ...baseQuestions.map((question) => ({ question, questionId: question.id })),
    ...extraQuestionIds.map((questionId) => ({ question: undefined, questionId })),
  ].map(({ question, questionId }) => {
    const submission = latestByQuestion.get(questionId) || null;
    const visible = isTeacher || question?.show_result_to_student !== false;
    const passedTests = submission?.test_results?.filter((result) => result.passed === 1).length || 0;
    const totalTests = submission?.test_results?.length || 0;

    return {
      questionId,
      question,
      title: question?.title || submission?.question_title || `Question #${questionId}`,
      points: question?.points ?? submission?.max_score ?? 0,
      submission,
      visible,
      status: submission ? submission.status : "not_submitted",
      score: submission?.score ?? null,
      passedTests,
      totalTests,
    };
  });

  const visibleQuestions = questions.filter((question) => question.visible);
  const hiddenCount = questions.length - visibleQuestions.length;
  const submittedCount = questions.filter((question) => question.submission).length;
  const completedVisible = visibleQuestions.filter((question) => question.status === "completed");
  const pendingCount = questions.filter(
    (question) => question.status === "queued" || question.status === "running"
  ).length;
  const errorCount = questions.filter((question) => question.status === "error").length;
  const totalPoints = visibleQuestions.reduce((sum, question) => sum + question.points, 0);
  const totalScore = completedVisible.reduce(
    (sum, question) => sum + (typeof question.score === "number" ? question.score : 0),
    0
  );
  const passedTests = questions.reduce((sum, question) => sum + question.passedTests, 0);
  const totalTests = questions.reduce((sum, question) => sum + question.totalTests, 0);
  const fullyCorrectCount = completedVisible.filter(
    (question) => question.points > 0 && (question.score ?? 0) >= question.points
  ).length;

  const lastSubmittedTime = examSubmissions.reduce(
    (latest, submission) => Math.max(latest, submittedTime(submission)),
    0
  );

  const allVisibleCompleted =
    visibleQuestions.length > 0 &&
    visibleQuestions.every((question) => question.status === "completed");

  let status: ExamResultStatus;
  if (submittedCount === 0) {
    status = "not_submitted";
  } else if (questions.length > 0 && hiddenCount === questions.length) {
    status = "hidden";
  } else if (pendingCount > 0) {
    status = "grading";
  } else if (errorCount > 0 && completedVisible.length === 0) {
    status = "error";
  } else if (
    allVisibleCompleted &&
    totalPoints > 0 &&
    totalScore >= totalPoints - 0.001
  ) {
    status = "passed";
  } else if (totalScore > 0) {
    status = "partial";
  } else {
    status = "failed";
  }

  return {
    examId,
    examTitle:
      exam?.title ||
      examSubmissions[0]?.exam_title ||
      `Examination #${examId}`,
    exam,
    questions,
    totalScore,
    totalPoints,
    submittedCount,
    questionCount: questions.length,
    passedTests,
    totalTests,
    fullyCorrectCount,
    pendingCount,
    errorCount,
    hiddenCount,
    lastSubmittedAt:
      lastSubmittedTime > 0 ? new Date(lastSubmittedTime).toISOString() : null,
    status,
  };
}

export function buildExamResults(
  submissions: Submission[],
  exams: Exam[],
  questionsByExam: Record<number, Question[]>,
  isTeacher = false
): ExamResult[] {
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const examIds = new Set<number>();

  submissions.forEach((submission) => {
    if (typeof submission.exam_id === "number") examIds.add(submission.exam_id);
  });

  return Array.from(examIds)
    .map((examId) =>
      buildExamResult(
        examId,
        examById.get(examId),
        questionsByExam[examId],
        submissions,
        isTeacher
      )
    )
    .sort((a, b) => {
      const aTime = a.lastSubmittedAt ? new Date(a.lastSubmittedAt).getTime() : 0;
      const bTime = b.lastSubmittedAt ? new Date(b.lastSubmittedAt).getTime() : 0;
      return bTime - aTime;
    });
}
