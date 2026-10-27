"use client";

import React, { useEffect } from "react";
import { useSocket } from "@/lib/socket-context";
import { AlertCircle, AlertTriangle, Info, CheckCircle2, X } from "lucide-react";

const NOTIFICATION_DURATION_MS = 5000;

function AutoDismissToast({
  toast,
  dismissNotification,
}: {
  toast: { id: string; title: string; message: string; type: string; priority?: string; timestamp: string };
  dismissNotification: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      dismissNotification(toast.id);
    }, NOTIFICATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismissNotification]);

  const isUrgent = toast.priority === "urgent";
  const isWarning = toast.priority === "warning";
  const isSubmission = toast.type === "submission";

  return (
    <div
      className={`pointer-events-auto p-3.5 rounded-lg border shadow-lg backdrop-blur-md transition-all duration-300 transform translate-y-0 ${
        isUrgent
          ? "bg-slate-900/95 border-red-500/60 text-white"
          : isWarning
          ? "bg-slate-900/95 border-orange-500/60 text-white"
          : "bg-slate-900/95 border-slate-700 text-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0">
            {isUrgent ? (
              <AlertCircle className="w-4 h-4 text-red-400" />
            ) : isWarning ? (
              <AlertTriangle className="w-4 h-4 text-orange-400" />
            ) : isSubmission ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <Info className="w-4 h-4 text-orange-400" />
            )}
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span
                className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ${
                  isUrgent
                    ? "bg-red-600 text-white"
                    : isWarning
                    ? "bg-orange-500 text-white"
                    : "bg-slate-700 text-slate-200"
                }`}
              >
                {isUrgent ? "Priority Alert" : toast.type}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {toast.timestamp}
              </span>
            </div>
            <h4 className="text-xs font-bold text-slate-100">{toast.title}</h4>
            <p className="text-[11px] text-slate-300 leading-snug">
              {toast.message}
            </p>
          </div>
        </div>

        <button
          onClick={() => dismissNotification(toast.id)}
          className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors shrink-0"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function NotificationOverlay() {
  const { notifications, dismissNotification } = useSocket();

  if (!notifications || notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-20 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
    >
      {notifications.map((toast) => (
        <AutoDismissToast
          key={toast.id}
          toast={toast}
          dismissNotification={dismissNotification}
        />
      ))}
    </div>
  );
}

