"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import {
  buildExamResult,
  ExamQuestionScore,
  ExamResultStatus,
  formatScore,
} from "@/lib/exam-results";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ListChecks,
  Loader2,
  Lock,
  XCircle,
} from "lucide-react";

function resultStatusMeta(status: ExamResultStatus) {
  switch (status) {
    case "passed":
      return {
        label: "PASSED",
        className: "bg-green-600 text-white border-green-600",
        Icon: CheckCircle2,
      };
    case "partial":
      return {
        label: "PARTIAL",
        className: "bg-orange-500 text-white border-orange-500",
        Icon: ListChecks,
      };
    case "grading":
      return {
        label: "GRADING",
        className: "bg-amber-100 text-amber-800 border-amber-200",
        Icon: Loader2,
      };
    case "error":
      return {
        label: "ERROR",
        className: "bg-red-100 text-red-700 border-red-200",
        Icon: AlertTriangle,
      };
    case "hidden":
      return {
        label: "HIDDEN",
        className: "bg-slate-200 text-slate-600 border-slate-200",
        Icon: Lock,
      };
    case "not_submitted":
      return {
        label: "NOT SUBMITTED",
        className: "bg-slate-100 text-slate-600 border-slate-200",
        Icon: Clock,
      };
    default:
      return {
        label: "NOT PASSED",
        className: "bg-red-600 text-white border-red-600",
        Icon: XCircle,
      };
  }
}

function questionStatusMeta(question: ExamQuestionScore) {
  if (!question.visible) {
    return {
      label: "HIDDEN",
      className: "bg-slate-100 text-slate-600 border-slate-200",
      Icon: Lock,
      barClassName: "bg-slate-300",
    };
  }

  if (question.status === "not_submitted") {
    return {
      label: "NOT SUBMITTED",
      className: "bg-slate-100 text-slate-600 border-slate-200",
      Icon: Clock,
      barClassName: "bg-slate-200",
    };
  }

  if (question.status === "queued" || question.status === "running") {
    return {
      label: "GRADING",
      className: "bg-amber-100 text-amber-800 border-amber-200",
      Icon: Loader2,
      barClassName: "bg-amber-400",
    };
  }

  if (question.status === "error") {
    return {
      label: "ERROR",
      className: "bg-red-100 text-red-700 border-red-200",
      Icon: AlertTriangle,
      barClassName: "bg-red-500",
    };
  }

  const score = question.score ?? 0;
  if (question.points > 0 && score >= question.points) {
    return {
      label: "ACCEPTED",
      className: "bg-green-600 text-white border-green-600",
      Icon: CheckCircle2,
      barClassName: "bg-emerald-500",
    };
  }

  if (score > 0) {
    return {
      label: "PARTIAL",
      className: "bg-orange-500 text-white border-orange-500",
      Icon: ListChecks,
      barClassName: "bg-orange-500",
    };
  }

  return {
    label: "FAILED",
    className: "bg-red-600 text-white border-red-600",
    Icon: XCircle,
    barClassName: "bg-red-500",
  };
}

export default function ExamResultPage() {
  const params = useParams();
  const examId = Number(params?.id);
  const { user, isTeacher } = useAuth();
  const { submissions, exams, questions } = useSocket();

  const exam = exams.find((item) => item.id === examId);
  const examQuestions = questions[examId] || [];

  const mySubmissions = useMemo(
    () =>
      submissions.filter(
        (submission) =>
          submission.student_id === user?.id && submission.exam_id === examId
      ),
    [submissions, user?.id, examId]
  );

  const result = useMemo(
    () => buildExamResult(examId, exam, examQuestions, mySubmissions, isTeacher),
    [examId, exam, examQuestions, mySubmissions, isTeacher]
  );

  const resultMeta = resultStatusMeta(result.status);
  const percentage =
    result.totalPoints > 0
      ? Math.round((result.totalScore / result.totalPoints) * 100)
      : 0;
  const submittedAt = result.lastSubmittedAt
    ? new Date(result.lastSubmittedAt).toLocaleString()
    : "Not submitted yet";

  if (!Number.isFinite(examId) || (!exam && mySubmissions.length === 0)) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-8 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
            <h1 className="text-sm font-bold text-slate-800">Test result not found</h1>
            <p className="text-xs text-slate-500">
              This test result does not exist or belongs to another student.
            </p>
            <Link
              href="/student/submissions"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-600 hover:underline"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to My Test Results
            </Link>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AppLayout>
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/dashboard" className="hover:text-orange-600 transition-colors">
                Examinations
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link href="/student/submissions" className="hover:text-orange-600 transition-colors">
                My Results
              </Link>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">Test #{result.examId}</li>
          </ol>
        </nav>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                OFFICIAL TEST RESULT
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                {result.examTitle}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                {result.questionCount} question{result.questionCount === 1 ? "" : "s"} in this test
                <span className="mx-1.5">•</span>
                {submittedAt}
              </p>
            </div>

            <div className="w-full lg:w-auto bg-slate-50 border border-slate-200 rounded-lg px-5 py-3 lg:text-right font-mono">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Overall Test Score
              </span>
              <div className="text-2xl font-black text-slate-900">
                {result.status === "hidden" ? (
                  <span className="text-base font-bold text-slate-500 flex items-center gap-1.5 lg:justify-end">
                    <Lock className="w-4 h-4" /> Hidden
                  </span>
                ) : (
                  <>
                    {formatScore(result.totalScore)}
                    <span className="text-sm font-semibold text-slate-400 font-sans">
                      {" "}
                      / {formatScore(result.totalPoints)} pts
                    </span>
                  </>
                )}
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {result.status === "grading" ? "Grading in progress" : `${percentage}%`}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded border font-bold text-[10px] uppercase tracking-wider shadow-xs ${resultMeta.className}`}
              >
                <resultMeta.Icon
                  className={`w-3.5 h-3.5 ${
                    result.status === "grading" ? "animate-spin" : ""
                  }`}
                />
                {resultMeta.label}
              </span>
              <span className="text-xs text-slate-600 font-medium">
                {result.fullyCorrectCount}/{result.questionCount} questions fully correct
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Inspect a question below to see its test-case level score breakdown.
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                Questions
              </span>
              <span className="text-lg font-black text-slate-800 font-mono">
                {result.submittedCount}/{result.questionCount}
              </span>
              <span className="block text-[10px] text-slate-500">submitted</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                Fully Correct
              </span>
              <span className="text-lg font-black text-emerald-700 font-mono">
                {result.fullyCorrectCount}
              </span>
              <span className="block text-[10px] text-slate-500">questions</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                Tests Passed
              </span>
              <span className="text-lg font-black text-slate-800 font-mono">
                {result.passedTests}/{result.totalTests}
              </span>
              <span className="block text-[10px] text-slate-500">test cases</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                Pending
              </span>
              <span className="text-lg font-black text-slate-800 font-mono">
                {result.pendingCount}
              </span>
              <span className="block text-[10px] text-slate-500">
                {result.errorCount > 0
                  ? `${result.errorCount} error${result.errorCount === 1 ? "" : "s"}`
                  : "queued or running"}
              </span>
            </div>
          </div>

          {result.submittedCount === 0 && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <span>
                No submission has been recorded for this test yet. Question scores will appear after
                a confirmed test submission.
              </span>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide font-mono">
                Question Scores
              </h2>
              <span className="text-[11px] text-slate-400 font-mono">
                {formatScore(result.totalScore)} of {formatScore(result.totalPoints)} points awarded
              </span>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {result.questions.length === 0 && (
                <div className="p-4 text-xs text-slate-500">
                  No questions have been added to this test yet.
                </div>
              )}
              {result.questions.map((question, index) => {
                const meta = questionStatusMeta(question);
                const questionPercentage =
                  question.points > 0 && question.score !== null
                    ? Math.min(100, Math.max(0, (question.score / question.points) * 100))
                    : 0;
                const scoreLabel = !question.visible
                  ? "Hidden"
                  : question.status === "not_submitted"
                  ? `0 / ${formatScore(question.points)}`
                  : question.score === null
                  ? "Grading..."
                  : `${formatScore(question.score)} / ${formatScore(question.points)}`;

                return (
                  <div
                    key={question.questionId}
                    className="p-4 bg-white hover:bg-slate-50/50 transition-colors space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white text-[10px] font-bold font-mono">
                          Q{index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {question.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider font-mono ${meta.className}`}
                            >
                              <meta.Icon
                                className={`w-3 h-3 ${
                                  question.status === "queued" || question.status === "running"
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                              {meta.label}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {question.visible
                                ? `${question.passedTests}/${question.totalTests} test cases passed`
                                : "Score withheld by instructor"}
                            </span>
                            {question.submission?.language && (
                              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                                {question.submission.language}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 self-end sm:self-center shrink-0">
                        <div className="text-right font-mono">
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">
                            Question Score
                          </span>
                          <span className="text-sm font-black text-slate-800">{scoreLabel}</span>
                        </div>
                        {question.submission ? (
                          <Link
                            href={`/student/submissions/${question.submission.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-orange-500 hover:text-white text-slate-700 font-bold text-[11px] rounded transition-colors"
                          >
                            Inspect Question
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        ) : (
                          <span className="px-3 py-1.5 rounded bg-slate-50 border border-slate-200 text-slate-400 font-bold text-[11px]">
                            No submission
                          </span>
                        )}
                      </div>
                    </div>

                    {question.visible && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${meta.barClassName}`}
                          style={{ width: `${questionPercentage}%` }}
                        />
                      </div>
                    )}

                    {question.status === "error" && question.submission?.error_summary && (
                      <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                        {question.submission.error_summary}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <Link
              href="/student/submissions"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to My Test Results
            </Link>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
