"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, Lock, Maximize2, ShieldAlert, ShieldCheck, X } from "lucide-react";

interface ExamWindowGuardProps {
  examTitle: string;
  onViolation?: (count: number) => void;
}

export function ExamWindowGuard({ examTitle, onViolation }: ExamWindowGuardProps) {
  const [started, setStarted] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [warnings, setWarnings] = useState(0);
  const [fullscreenUnavailable, setFullscreenUnavailable] = useState(false);
  const lastViolationAt = useRef(0);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setFullscreenUnavailable(false);
    } catch {
      setFullscreenUnavailable(true);
    }
  }, []);

  const triggerWarning = useCallback(() => {
    if (!started) return;
    const now = Date.now();
    if (now - lastViolationAt.current < 1500) return;
    lastViolationAt.current = now;
    setWarnings((previous) => {
      const next = previous + 1;
      onViolation?.(next);
      return next;
    });
    setShowWarning(true);
  }, [onViolation, started]);

  useEffect(() => {
    if (!started) return;

    const handleVisibility = () => {
      if (document.hidden) triggerWarning();
    };
    const handleBlur = () => triggerWarning();
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) triggerWarning();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [started, triggerWarning]);

  const beginExam = async () => {
    await enterFullscreen();
    setStarted(true);
  };

  const dismissWarning = () => {
    setShowWarning(false);
  };

  const returnToExam = async () => {
    await enterFullscreen();
    dismissWarning();
  };

  if (!started) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg bg-orange-500 flex items-center justify-center shadow-sm">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">{examTitle}</h2>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 text-xs">
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <Maximize2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-slate-300 leading-relaxed">
                  The test opens in a dedicated fullscreen window. Keep this window focused until
                  you confirm your submission.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <Eye className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-slate-300 leading-relaxed">
                  Switching tabs, minimising the window, or leaving fullscreen is detected and
                  recorded as a proctoring warning.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-slate-300 leading-relaxed">
                  Your answers are saved in this window. Use the question sidebar to move between
                  problems, then review before submitting the test.
                </p>
              </div>
            </div>

            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Do not close this window after starting the test. Closing the window may end your
                attempt without a submission.
              </span>
            </div>

            <button
              type="button"
              onClick={beginExam}
              className="w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <Maximize2 className="w-4 h-4" />
              Enter Fullscreen &amp; Begin Test
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {fullscreenUnavailable && (
        <div className="fixed bottom-4 right-4 z-[90] max-w-xs rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-800 shadow-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Fullscreen is unavailable in this browser. Keep the exam window focused; leaving it
            will still be recorded.
          </span>
        </div>
      )}

      {showWarning && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-4 right-4 z-[110] w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-red-200 bg-white shadow-xl overflow-hidden"
        >
          <div className="flex items-start gap-3 p-4">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-red-50 border border-red-200 text-red-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-500 font-mono">
                    Proctoring warning {warnings}
                  </span>
                  <h2 className="text-xs font-bold text-slate-900">You left the exam window</h2>
                </div>
                <button
                  type="button"
                  onClick={dismissWarning}
                  aria-label="Dismiss warning"
                  className="p-1 -m-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-600 leading-relaxed">
                Leaving the test window, switching tabs, or exiting fullscreen has been recorded
                and may be reviewed by your instructor.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={returnToExam}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded transition-colors flex items-center gap-1.5"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Return to Exam
                </button>
                <button
                  type="button"
                  onClick={dismissWarning}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
