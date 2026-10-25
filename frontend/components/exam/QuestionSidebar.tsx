"use client";

import React from "react";
import { Question, TestCase } from "@/types";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  ListChecks,
  Send,
  X,
} from "lucide-react";

interface QuestionSidebarProps {
  questions: Question[];
  currentIndex: number;
  answeredIds: number[];
  testCases: Record<number, TestCase[]>;
  isSubmitting: boolean;
  onSelect: (index: number) => void;
  onReviewSubmit: () => void;
  onClose: () => void;
}

function isQuestionConfigured(question: Question, cases: TestCase[]): boolean {
  if (!cases.length) return false;
  return cases.every((testCase) =>
    question.question_type === "JAVA_CLASS_METHOD"
      ? Boolean(testCase.expected_return?.trim())
      : Boolean(testCase.expected_stdout?.trim())
  );
}

export function QuestionSidebar({
  questions,
  currentIndex,
  answeredIds,
  testCases,
  isSubmitting,
  onSelect,
  onReviewSubmit,
  onClose,
}: QuestionSidebarProps) {
  const answeredSet = new Set(answeredIds);
  const answeredCount = questions.filter((question) => answeredSet.has(question.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs xl:static xl:z-auto xl:block xl:bg-transparent xl:backdrop-blur-none xl:w-72 xl:shrink-0">
      <aside className="w-80 max-w-[88vw] h-full xl:h-auto xl:w-72 xl:max-h-[calc(100vh-6rem)] xl:sticky xl:top-20 bg-white border-l xl:border border-slate-200 xl:rounded-lg shadow-2xl xl:shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 text-orange-500" />
              Question navigator
            </span>
            <p className="text-[11px] text-slate-500 mt-1">
              <strong className="text-slate-800">{answeredCount}</strong> of {questions.length}{" "}
              questions answered
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200 transition-colors"
            aria-label="Hide question navigator"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{
                width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {questions.map((question, index) => {
            const isActive = index === currentIndex;
            const isAnswered = answeredSet.has(question.id);
            const cases = testCases[question.id] || [];
            const configured = isQuestionConfigured(question, cases);

            return (
              <button
                key={question.id}
                type="button"
                onClick={() => onSelect(index)}
                className={`w-full text-left rounded-md border p-2.5 transition-all flex items-start gap-2.5 ${
                  isActive
                    ? "border-orange-400 bg-orange-50/80 shadow-xs"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span
                  className={`mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold font-mono ${
                    isAnswered
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : isActive
                      ? "bg-orange-500 border-orange-500 text-white"
                      : "bg-white border-slate-300 text-slate-500"
                  }`}
                >
                  {isAnswered ? <CheckCircle2 className="w-3 h-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold text-slate-800 leading-snug truncate">
                    {question.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[10px] font-mono text-slate-400">
                    <span>{question.points} pts</span>
                    <span>•</span>
                    <span className="uppercase">{question.language}</span>
                    {isAnswered ? (
                      <>
                        <span>•</span>
                        <span className="text-emerald-600 font-bold">Answered</span>
                      </>
                    ) : (
                      <>
                        <span>•</span>
                        <span className="text-slate-400">Not answered</span>
                      </>
                    )}
                  </span>
                  {!configured && (
                    <span className="mt-1 flex items-center gap-1 text-[9px] font-bold text-amber-700">
                      <AlertTriangle className="w-3 h-3" />
                      Missing grading answers
                    </span>
                  )}
                </span>
                <span className="mt-1 shrink-0">
                  {isActive ? (
                    <Circle className="w-2 h-2 fill-orange-500 text-orange-500" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2">
          <div className="text-[10px] text-slate-400 font-mono leading-relaxed">
            Review every question before submitting. Unanswered questions can still be submitted,
            but they will not earn points.
          </div>
          <button
            type="button"
            onClick={onReviewSubmit}
            disabled={isSubmitting}
            className="w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5" />
            {isSubmitting ? "Submitting..." : "Review & Submit Test"}
          </button>
          <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono text-slate-400">
            <ClipboardCheck className="w-3 h-3" />
            Submission can be confirmed or cancelled
          </div>
        </div>
      </aside>
    </div>
  );
}
