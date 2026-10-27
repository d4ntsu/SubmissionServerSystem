"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import {
  buildExamResults,
  ExamResultStatus,
  formatScore,
} from "@/lib/exam-results";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Search,
  AlertTriangle,
  Loader2,
  Lock,
  ListChecks,
} from "lucide-react";

const statusMeta: Record<
  ExamResultStatus,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  passed: {
    label: "PASSED",
    className: "bg-green-600 text-white border-green-600",
    Icon: CheckCircle2,
  },
  partial: {
    label: "PARTIAL",
    className: "bg-orange-500 text-white border-orange-500",
    Icon: ListChecks,
  },
  failed: {
    label: "NOT PASSED",
    className: "bg-red-600 text-white border-red-600",
    Icon: XCircle,
  },
  grading: {
    label: "GRADING",
    className: "bg-amber-100 text-amber-800 border-amber-200",
    Icon: Loader2,
  },
  error: {
    label: "ERROR",
    className: "bg-red-100 text-red-700 border-red-200",
    Icon: AlertTriangle,
  },
  hidden: {
    label: "HIDDEN",
    className: "bg-slate-200 text-slate-600 border-slate-200",
    Icon: Lock,
  },
  not_submitted: {
    label: "NOT SUBMITTED",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    Icon: Clock,
  },
};

export default function SubmissionsHistoryPage() {
  const { user, isTeacher } = useAuth();
  const { submissions, exams, questions } = useSocket();
  const [searchTerm, setSearchTerm] = useState("");
  const [examFilter, setExamFilter] = useState<number | null>(null);

  useEffect(() => {
    const examId = Number(new URLSearchParams(window.location.search).get("exam_id"));
    if (Number.isFinite(examId) && examId > 0) {
      setExamFilter(examId);
    }
  }, []);

  const mySubmissions = useMemo(
    () => submissions.filter((submission) => submission.student_id === user?.id),
    [submissions, user?.id]
  );

  const results = useMemo(
    () => buildExamResults(mySubmissions, exams, questions, isTeacher),
    [mySubmissions, exams, questions, isTeacher]
  );

  const filteredResults = results.filter((result) => {
    const matchesSearch =
      result.examTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      result.examId.toString().includes(searchTerm);
    const matchesExam = examFilter === null || result.examId === examFilter;
    return matchesSearch && matchesExam;
  });

  const filteredExamTitle =
    examFilter !== null
      ? results.find((result) => result.examId === examFilter)?.examTitle ||
        exams.find((exam) => exam.id === examFilter)?.title ||
        `Examination #${examFilter}`
      : null;

  return (
    <ProtectedRoute>
      <AppLayout>
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/dashboard" className="hover:text-orange-600 transition-colors">
                Portal
              </Link>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">My Results</li>
          </ol>
        </nav>

        {filteredExamTitle && (
          <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
            <span>
              Showing the test result for <strong>{filteredExamTitle}</strong>.
            </span>
            <button
              onClick={() => {
                setExamFilter(null);
                window.history.replaceState(null, "", "/student/submissions");
              }}
              className="self-start sm:self-auto font-bold underline underline-offset-2 hover:text-emerald-900"
            >
              View all results
            </button>
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                ACADEMIC RECORDS
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                My Test Results
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Open a test result to inspect the score earned by each question and its test cases.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search test title..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {filteredResults.map((result) => {
              const meta = statusMeta[result.status];
              const percentage =
                result.totalPoints > 0
                  ? Math.round((result.totalScore / result.totalPoints) * 100)
                  : 0;
              const lastSubmitted = result.lastSubmittedAt
                ? new Date(result.lastSubmittedAt).toLocaleString()
                : "Not submitted";

              return (
                <div
                  key={result.examId}
                  className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-slate-400">
                        TEST #{result.examId}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase font-mono ${meta.className}`}
                      >
                        <meta.Icon
                          className={`w-3 h-3 ${
                            result.status === "grading" ? "animate-spin" : ""
                          }`}
                        />
                        {meta.label}
                      </span>
                      <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {percentage}% score
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900">{result.examTitle}</h3>
                    <p className="text-xs text-slate-400 font-mono">
                      {result.submittedCount}/{result.questionCount} questions submitted
                      <span className="mx-1.5">•</span>
                      {result.passedTests}/{result.totalTests} test cases passed
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Last submitted: {lastSubmitted}
                    </p>
                    {result.errorCount > 0 && (
                      <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-lg">
                        {result.errorCount} question
                        {result.errorCount === 1 ? " could" : "s could"} not be graded. Open the
                        test result for details.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-5 self-end sm:self-center">
                    <div className="text-right font-mono">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">
                        Test Score
                      </span>
                      <span className="text-base font-black text-slate-800">
                        {result.status === "hidden"
                          ? "Hidden"
                          : `${formatScore(result.totalScore)} / ${formatScore(result.totalPoints)}`}
                      </span>
                    </div>

                    <Link
                      href={`/student/results/${result.examId}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors"
                    >
                      Inspect Test Result
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}

            {filteredResults.length === 0 && (
              <div className="p-10 text-center text-xs text-slate-400">
                <p className="font-semibold text-slate-600">No test results to show yet.</p>
                <p className="mt-1">
                  {examFilter
                    ? "This test has no confirmed submissions for your account."
                    : "Once you confirm a test submission, the overall result and question scores will appear here."}
                </p>
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
