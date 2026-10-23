"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { MOCK_SUBMISSIONS } from "@/lib/api";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  ChevronLeft,
  FileCode,
  ShieldCheck,
  AlertTriangle,
  Lock,
} from "lucide-react";

export default function StudentResultsViewPage() {
  const params = useParams();
  const submissionId = Number(params?.id) || 501;
  const { isTeacher } = useAuth();
  const { submissions, questions } = useSocket();

  const submission =
    submissions.find((s) => s.id === submissionId) ||
    MOCK_SUBMISSIONS.find((s) => s.id === submissionId) ||
    MOCK_SUBMISSIONS[0];

  const examQuestions = questions[submission.exam_id ?? 0] || [];
  const question = examQuestions.find((q) => q.id === submission.question_id);
  const resultsVisible = isTeacher || question?.show_result_to_student !== false;

  const isFullScore = submission.score === submission.max_score;
  const passedTestsCount = submission.test_results?.filter((t) => t.passed === 1).length || 0;
  const totalTestsCount = submission.test_results?.length || 0;

  return (
    <ProtectedRoute>
      <AppLayout>
        {/* Breadcrumb Navigation */}
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
                Submissions
              </Link>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">
              Evaluation Result #{submission.id}
            </li>
          </ol>
        </nav>

        {/* Boxed Central Content Container */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header Bar */}
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                AUTOMATED CONTAINER GRADING REPORT
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                {submission.question_title}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                {submission.exam_title} • Submitted at {new Date(submission.submitted_at).toLocaleTimeString()}
              </p>
            </div>

            {/* Score Big Display */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-5 py-2.5 text-right font-mono">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Calculated Score
              </span>
              <div className="text-2xl font-black text-slate-900">
                {resultsVisible ? (
                  <>
                    {submission.score !== null ? submission.score : "—"}
                    <span className="text-sm font-semibold text-slate-400 font-sans">
                      {" "}
                      / {submission.max_score} pts
                    </span>
                  </>
                ) : (
                  <span className="text-base font-bold text-slate-500 flex items-center gap-1.5">
                    <Lock className="w-4 h-4" /> Hidden
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Execution Status Bar with Solid Green Badge */}
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Solid Green Badge for Successful Execution State */}
              {!resultsVisible ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-slate-600 text-white font-bold text-xs uppercase tracking-wider shadow-xs">
                  <Lock className="w-3.5 h-3.5" />
                  RESULT WITHHELD BY INSTRUCTOR
                </span>
              ) : isFullScore ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-green-600 text-white font-bold text-xs uppercase tracking-wider shadow-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  ACCEPTED • FULL POINTS
                </span>
              ) : submission.status === "completed" && (submission.score || 0) > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-orange-500 text-white font-bold text-xs uppercase tracking-wider shadow-xs">
                  PARTIALLY CORRECT
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-red-600 text-white font-bold text-xs uppercase tracking-wider shadow-xs">
                  <XCircle className="w-3.5 h-3.5" />
                  EVALUATION FAILED
                </span>
              )}

              <span className="text-xs text-slate-600 font-medium">
                Language: <strong className="font-mono uppercase">{submission.language}</strong>
              </span>
            </div>

            {/* Telemetry Stats */}
            <div className="flex items-center gap-4 text-xs font-mono text-slate-600">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {submission.test_results?.[0]?.time ? `${submission.test_results[0].time}s` : "0.12s"}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5 text-slate-400" />
                {submission.test_results?.[0]?.memory ? `${submission.test_results[0].memory} MB` : "14.8 MB"}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                Piston Sandbox
              </span>
            </div>
          </div>

          {/* Test Case Breakdown */}
          {resultsVisible ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide font-mono">
                Test Case Evaluations ({passedTestsCount}/{totalTestsCount} Passed)
              </h2>
              <span className="text-[11px] text-slate-400 font-mono">
                Hidden tests masked for server-side integrity
              </span>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {submission.test_results?.map((tr, index) => {
                const isPassed = tr.passed === 1;

                return (
                  <div key={tr.id} className="p-4 bg-white hover:bg-slate-50/50 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {/* Solid green badge for passed test */}
                        {isPassed ? (
                          <span className="px-2 py-0.5 rounded bg-green-600 text-white font-bold text-[10px] uppercase font-mono shadow-xs">
                            PASS
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-red-600 text-white font-bold text-[10px] uppercase font-mono shadow-xs">
                            FAIL
                          </span>
                        )}

                        <span className="font-bold text-xs text-slate-800">
                          Test Case #{index + 1}
                        </span>

                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                          {tr.is_sample ? "Sample Test" : "Hidden Proctor Test"}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-slate-400">
                        {tr.time && <span>Time: {tr.time}s</span>}
                      </div>
                    </div>

                    {/* Stdout for visible sample test cases */}
                    {tr.is_sample && tr.stdout && (
                      <div className="pt-1">
                        <span className="text-[10px] text-slate-400 font-mono block">Standard Output:</span>
                        <pre className="p-2 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] text-slate-800 whitespace-pre-wrap mt-0.5">
                          {tr.stdout}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          ) : (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold text-slate-800 block">Final result hidden by instructor</span>
                <span className="text-[11px]">
                  Your submission was received and graded, but this question is configured to keep the score, verdict, and test breakdown private.
                </span>
              </div>
            </div>
          )}

          {/* Submitted Code Area */}
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide font-mono flex items-center gap-1.5">
              <FileCode className="w-4 h-4 text-slate-500" />
              Authorized Source Code Submission
            </h2>
            <pre className="p-4 bg-slate-900 rounded-lg border border-slate-800 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto">
              {submission.source_code}
            </pre>
          </div>

          {/* Action Row */}
          <div className="pt-2 flex justify-between items-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Exam Selection Dashboard
            </Link>

            <Link
              href={`/student/exams/${submission.exam_id || 1}`}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors"
            >
              Reopen Exam Workspace
            </Link>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
