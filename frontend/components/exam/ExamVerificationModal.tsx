"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/lib/socket-context";
import { ExamVerification } from "@/lib/exam-verification";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";

interface ExamVerificationModalProps {
  examId: number;
  isOpen: boolean;
  onClose: () => void;
  onOpenExam?: () => void;
}

const RESULT_STATUS_LABEL: Record<string, string> = {
  ready: "READY",
  needs_fixes: "NEEDS FIXES",
  no_questions: "NO QUESTIONS",
};

export function ExamVerificationModal({
  examId,
  isOpen,
  onClose,
  onOpenExam,
}: ExamVerificationModalProps) {
  const { exams, runExamVerification } = useSocket();
  const [report, setReport] = useState<ExamVerification | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const runRef = useRef(runExamVerification);
  const startedRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    runRef.current = runExamVerification;
  }, [runExamVerification]);

  const run = useCallback(() => {
    setIsRunning(true);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setReport(runRef.current(examId));
      setIsRunning(false);
      timeoutRef.current = null;
    }, 300);
  }, [examId]);

  useEffect(() => {
    if (!isOpen) {
      startedRef.current = false;
      setReport(null);
      setIsRunning(false);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    run();
  }, [isOpen, run]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    []
  );

  if (!isOpen) return null;

  const exam = exams.find((item) => item.id === examId);
  const readyCount = report?.questions.filter((question) => question.passed).length ?? 0;

  const handleOpenExam = () => {
    if (!report || !onOpenExam) return;
    if (!report.passed) {
      const confirmed = window.confirm(
        "Verification has not passed. Open this exam to all students anyway?"
      );
      if (!confirmed) return;
    }
    onOpenExam();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] bg-white rounded-lg border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
        <div className="p-5 bg-slate-900 text-white flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center shadow-sm shrink-0">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400 font-mono">
                Exam preflight verification
              </span>
              <h2 className="mt-1 text-base font-bold">
                {exam?.title || report?.examTitle || `Examination #${examId}`}
              </h2>
              <p className="mt-1 text-[11px] text-slate-400">
                Checks test cases, expected answers, score weights, and grader configuration
                before the exam is opened to students.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close verification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isRunning && !report ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
              <span className="text-xs font-mono">Checking exam configuration...</span>
            </div>
          ) : null}

          {report ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                    Status
                  </span>
                  <span
                    className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider font-mono ${
                      report.passed
                        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                        : "bg-red-100 text-red-700 border-red-200"
                    }`}
                  >
                    {report.passed ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    {report.passed ? "Ready to open" : "Needs fixes"}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                    Questions ready
                  </span>
                  <span className="text-lg font-black text-slate-800 font-mono">
                    {readyCount}/{report.questions.length}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                    Demo reference score
                  </span>
                  <span className="text-lg font-black text-slate-800 font-mono">
                    {report.totalScore === null
                      ? "Not simulated"
                      : `${report.totalScore} / ${report.totalPoints}`}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                    Exam readiness
                  </span>
                  <span className="text-sm font-black text-slate-800 font-mono">
                    {RESULT_STATUS_LABEL[report.resultStatus] || report.resultStatus}
                  </span>
                </div>
              </div>

              <div
                className={`rounded-lg border p-3 text-[11px] flex items-start gap-2 ${
                  report.passed
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {report.passed ? (
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>
                  {report.passed
                    ? "Verification passed. Configured questions have a supported grader and valid test data. You can now open this exam to all students."
                    : "Verification failed. Fix the highlighted question configuration before opening this exam to students."}
                </span>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                {report.questions.length === 0 && (
                  <div className="p-4 text-xs text-slate-500 font-mono">
                    No questions are configured for this exam yet.
                  </div>
                )}
                {report.questions.map((question, index) => (
                  <div key={question.questionId} className="p-4 space-y-2 bg-white">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white text-[10px] font-bold font-mono">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {question.title}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {question.points} pts •{" "}
                            {question.score === null
                              ? `${question.points} possible points`
                              : `${question.score} / ${question.points} demo reference score`}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider font-mono shrink-0 ${
                          question.passed
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                            : "bg-red-100 text-red-700 border-red-200"
                        }`}
                      >
                        {question.passed ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        {question.passed ? "Ready" : "Blocked"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-8">
                      {question.checks.map((check) => (
                        <div
                          key={check.label}
                          className="flex items-start gap-1.5 text-[10px] leading-snug"
                        >
                          {check.passed ? (
                            <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-emerald-600" />
                          ) : (
                            <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-red-500" />
                          )}
                          <span>
                            <span
                              className={
                                check.passed ? "text-slate-600" : "text-red-700 font-bold"
                              }
                            >
                              {check.label}:
                            </span>{" "}
                            <span className="text-slate-500">{check.detail}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-slate-400 font-mono">
                Last verified: {new Date(report.checkedAt).toLocaleString()}
              </p>
            </>
          ) : null}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-[10px] text-slate-400 font-mono">
            {report && !report.passed
              ? "Fix the blocked checks, or open the exam anyway if you have verified it manually."
              : "Verification is repeated automatically whenever you reopen this panel."}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {report && onOpenExam && (
              <button
                type="button"
                onClick={handleOpenExam}
                className={`px-4 py-2 text-white font-bold text-xs rounded shadow-xs transition-colors ${
                  report.passed
                    ? "bg-orange-500 hover:bg-orange-600"
                    : "bg-amber-500 hover:bg-amber-600"
                }`}
              >
                {report.passed ? "Open Exam" : "Open anyway"}
              </button>
            )}
            <button
              type="button"
              onClick={run}
              disabled={isRunning}
              className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold text-xs rounded hover:bg-slate-100 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? "animate-spin" : ""}`} />
              Run Again
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded shadow-xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
