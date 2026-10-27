"use client";

import React, { useEffect, useState } from "react";
import { Question, TestCase } from "@/types";
import { hasAnswer } from "@/lib/grading";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Send,
  Undo2,
  XCircle,
} from "lucide-react";

interface SubmitReviewModalProps {
  isOpen: boolean;
  examTitle: string;
  questions: Question[];
  answers: Record<number, string>;
  testCases: Record<number, TestCase[]>;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function isQuestionConfigured(question: Question, cases: TestCase[]): boolean {
  if (!cases.length) return false;
  return cases.every((testCase) =>
    question.question_type === "JAVA_CLASS_METHOD"
      ? Boolean(testCase.expected_return?.trim())
      : Boolean(testCase.expected_stdout?.trim())
  );
}

export function SubmitReviewModal({
  isOpen,
  examTitle,
  questions,
  answers,
  testCases,
  isSubmitting,
  onClose,
  onConfirm,
}: SubmitReviewModalProps) {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (isOpen) setConfirmed(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const answeredQuestions = questions.filter((question) => hasAnswer(answers[question.id] || ""));
  const unansweredQuestions = questions.filter(
    (question) => !hasAnswer(answers[question.id] || "")
  );
  const missingAnswerCount = questions.filter(
    (question) => !isQuestionConfigured(question, testCases[question.id] || [])
  ).length;

  const handleConfirm = () => {
    if (!confirmed || isSubmitting) return;
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[92vh] bg-white rounded-lg border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
        <div className="p-5 bg-slate-900 text-white flex items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400 font-mono flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5" />
              Final submission review
            </span>
            <h2 className="mt-1 text-base font-bold">{examTitle}</h2>
            <p className="mt-1 text-[11px] text-slate-400">
              Check every question below. Confirm only when you are ready to end the test.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40"
            aria-label="Return to test"
          >
            <Undo2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50 text-center">
          <div className="p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
              Answered
            </span>
            <span className="text-lg font-black text-emerald-600 font-mono">
              {answeredQuestions.length}
            </span>
          </div>
          <div className="p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
              Not answered
            </span>
            <span className="text-lg font-black text-orange-600 font-mono">
              {unansweredQuestions.length}
            </span>
          </div>
          <div className="p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
              Missing answers
            </span>
            <span className="text-lg font-black text-red-600 font-mono">{missingAnswerCount}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {unansweredQuestions.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                You still have {unansweredQuestions.length} unanswered question
                {unansweredQuestions.length === 1 ? "" : "s"}. You may submit now anyway;
                unanswered questions will still be graded from their saved code and may receive 0
                points.
              </span>
            </div>
          )}

          {missingAnswerCount > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 flex items-start gap-2">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {missingAnswerCount} question
                {missingAnswerCount === 1 ? " has" : "s have"} no expected answers stored in the
                database. Those questions cannot be graded and will be reported as an error.
              </span>
            </div>
          )}

          {questions.map((question, index) => {
            const code = answers[question.id] || "";
            const answered = hasAnswer(code);
            const configured = isQuestionConfigured(question, testCases[question.id] || []);

            return (
              <div
                key={question.id}
                className={`rounded border p-3 ${
                  answered ? "border-slate-200 bg-white" : "border-orange-200 bg-orange-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white text-[10px] font-bold font-mono">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{question.title}</p>
                      <p className="mt-0.5 text-[10px] font-mono text-slate-400">
                        {question.points} pts • {question.language.toUpperCase()} •{" "}
                        {question.question_type}
                      </p>
                      {answered && (
                        <p className="mt-1 text-[10px] font-mono text-slate-500">
                          {code.trim().split(/\r?\n/).length} line
                          {code.trim().split(/\r?\n/).length === 1 ? "" : "s"} written
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider font-mono ${
                        answered
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-orange-100 text-orange-800"
                      }`}
                    >
                      {answered ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {answered ? "Answered" : "Not answered"}
                    </span>
                    {!configured && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-red-600 font-mono">
                        No expected answer
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={isSubmitting}
              className="mt-0.5 w-4 h-4 accent-orange-500 rounded"
            />
            <span className="text-[11px] text-slate-600 leading-relaxed">
              I reviewed all questions above and confirm that I want to submit this test,
              including any unanswered questions. After confirmation I cannot return to edit my
              answers.
            </span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold text-xs rounded hover:bg-slate-100 disabled:opacity-50"
            >
              Return to Test
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!confirmed || isSubmitting}
              className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Submitting {questions.length} question
                  {questions.length === 1 ? "" : "s"}...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Confirm & Submit Test
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
