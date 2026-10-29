"use client";

import React from "react";
import { ExamGradeResult } from "@/types";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Loader2,
  XCircle,
} from "lucide-react";

interface ExamGradeResultPanelProps {
  result: ExamGradeResult | null;
  isGrading: boolean;
  error: string;
}

const OVERALL_STATUS = {
  completed: {
    label: "All questions graded",
    className: "bg-emerald-50 border-emerald-200 text-emerald-900",
    icon: CheckCircle2,
  },
  partial: {
    label: "Some questions could not be graded",
    className: "bg-amber-50 border-amber-200 text-amber-900",
    icon: AlertTriangle,
  },
  error: {
    label: "Grading failed",
    className: "bg-red-50 border-red-200 text-red-900",
    icon: XCircle,
  },
} as const;

export function ExamGradeResultPanel({
  result,
  isGrading,
  error,
}: ExamGradeResultPanelProps) {
  if (isGrading) {
    return (
      <div className="mb-4 p-4 bg-white border border-slate-200 rounded-lg shadow-sm flex items-center gap-3">
        <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
        <div>
          <p className="text-xs font-bold text-slate-800">Grading this exam...</p>
          <p className="text-[11px] text-slate-500">
            Running every question through the backend grader. Hidden test cases are included.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg shadow-xs flex items-start gap-2 text-xs text-red-800">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <strong className="block">The exam could not be graded.</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const overall = OVERALL_STATUS[result.status];
  const OverallIcon = overall.icon;
  const passedTests = result.questions.reduce(
    (total, question) =>
      total + question.test_results.filter((test) => test.passed === 1).length,
    0
  );
  const totalTests = result.questions.reduce(
    (total, question) => total + question.test_results.length,
    0
  );

  return (
    <section className="mb-4 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className={`p-4 border-b ${overall.className}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <OverallIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest font-mono opacity-70">
                Exam grading result
              </span>
              <h2 className="text-sm font-bold">{overall.label}</h2>
              <p className="text-[11px] opacity-80 mt-0.5">
                {result.questions.length} question
                {result.questions.length === 1 ? "" : "s"} graded • {passedTests}/{totalTests} test
                cases passed
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-md border border-black/10 bg-white/60 px-4 py-2 text-right">
            <span className="block text-[9px] font-bold uppercase tracking-wider font-mono opacity-70">
              Overall score
            </span>
            <span className="text-xl font-black font-mono">
              {result.score}
              <span className="text-xs font-bold opacity-60"> / {result.max_score}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {result.questions.map((question, questionIndex) => {
                  const isError = question.status === "error";
                  const isCorrect = !isError && question.score !== null && question.score > 0;
                  const iconBg = isError || (!isCorrect && !isError)
                    ? "bg-red-50 border-red-200 text-red-600"
                    : "bg-emerald-50 border-emerald-200 text-emerald-600";
                  const Icon = isError
                    ? XCircle
                    : question.score !== null && question.score > 0
                    ? CheckCircle2
                    : XCircle;

                  return (
                    <article key={question.question_id} className="p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span
                            className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full border ${iconBg}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="text-xs font-bold text-slate-900 truncate">
                              Q{questionIndex + 1}: {question.title}
                            </h3>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 sm:justify-end">
                          <span className="px-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-xs font-black font-mono text-slate-800">
                            {question.score === null ? "—" : question.score}
                            <span className="text-[10px] font-bold text-slate-400"> / {question.max_score}</span>
                          </span>
                        </div>
                      </div>

                      {question.error_summary && (
                        <div className="p-2.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-800 flex items-start gap-2">
                          <FileWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{question.error_summary}</span>
                        </div>
                      )}

                      {question.test_results.length > 0 && (
                <div className="space-y-2">
                  {question.test_results.map((test, testIndex) => (
                    <div
                      key={`${test.test_case_id}-${test.id}-${testIndex}`}
                      className={`rounded border p-2.5 text-[11px] font-mono space-y-2 ${
                        test.passed === 1
                          ? "bg-emerald-50/50 border-emerald-200"
                          : "bg-red-50/40 border-red-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold flex items-center gap-1.5">
                          {test.passed === 1 ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-red-600" />
                          )}
                          <span
                            className={test.passed === 1 ? "text-emerald-800" : "text-red-800"}
                          >
                            Test #{testIndex + 1} — {test.passed === 1 ? "PASS" : "FAIL"}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-slate-500">
                          {test.is_sample === false && (
                            <span className="uppercase font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                              Hidden
                            </span>
                          )}
                          <span>{test.awarded_points ?? 0} pts</span>
                          <span className="text-slate-400">
                            weight {test.score_weight ?? 0}
                          </span>
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                            Input
                          </span>
                          <pre className="mt-0.5 p-1.5 bg-white border border-slate-200 rounded whitespace-pre-wrap break-words">
                            {test.input_data || "(none)"}
                          </pre>
                        </div>
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                            Expected
                          </span>
                          <pre className="mt-0.5 p-1.5 bg-white border border-slate-200 rounded whitespace-pre-wrap break-words">
                            {test.expected_output || "(none)"}
                          </pre>
                        </div>
                      </div>

                      {(test.stdout || test.stderr || test.compile_output) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {test.stdout && (
                            <div>
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                                Actual output
                              </span>
                              <pre className="mt-0.5 p-1.5 bg-white border border-slate-200 rounded whitespace-pre-wrap break-words">
                                {test.stdout}
                              </pre>
                            </div>
                          )}
                          {test.stderr && (
                            <div>
                              <span className="text-[9px] font-bold uppercase tracking-wider text-red-400 block">
                                Standard error
                              </span>
                              <pre className="mt-0.5 p-1.5 bg-white border border-red-200 rounded whitespace-pre-wrap break-words text-red-700">
                                {test.stderr}
                              </pre>
                            </div>
                          )}
                          {test.compile_output && (
                            <div className="md:col-span-2">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-red-400 block">
                                Compile output
                              </span>
                              <pre className="mt-0.5 p-1.5 bg-white border border-red-200 rounded whitespace-pre-wrap break-words text-red-700">
                                {test.compile_output}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}

                      {test.message && (
                        <p className="text-[10px] text-slate-600">{test.message}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
        <ClipboardCheck className="w-3 h-3" />
        Preview only — no student submission was created and no realtime event was emitted.
      </div>
    </section>
  );
}
