"use client";

import React, { useEffect } from "react";
import { useSocket } from "@/lib/socket-context";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export function AnnouncementBanner() {
  const { activeAnnouncement, clearActiveAnnouncement } = useSocket();

  useEffect(() => {
    if (!activeAnnouncement) return;
    const timer = setTimeout(() => clearActiveAnnouncement(), 5000);
    return () => clearTimeout(timer);
  }, [activeAnnouncement, clearActiveAnnouncement]);

  if (!activeAnnouncement) return null;

  const priorityStyles = {
    urgent: "bg-red-500/15 border-red-500/30 text-red-900 dark:text-red-200",
    warning: "bg-amber-500/15 border-amber-500/30 text-amber-900 dark:text-amber-200",
    info: "bg-indigo-500/15 border-indigo-500/30 text-indigo-900 dark:text-indigo-200",
  };

  const priorityBadgeStyles = {
    urgent: "bg-red-600 text-white",
    warning: "bg-amber-600 text-white",
    info: "bg-indigo-600 text-white",
  };

  const IconComponent =
    activeAnnouncement.priority === "urgent"
      ? AlertCircle
      : activeAnnouncement.priority === "warning"
      ? AlertTriangle
      : Info;

  return (
    <div
      className={`border-b px-4 py-3 shadow-sm transition-all duration-300 ${
        priorityStyles[activeAnnouncement.priority]
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-full bg-white/60 dark:bg-slate-800/60 shadow-sm shrink-0">
            <IconComponent className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  priorityBadgeStyles[activeAnnouncement.priority]
                }`}
              >
                {activeAnnouncement.priority} Announcement
              </span>
              <span className="font-semibold text-sm">
                {activeAnnouncement.title}
              </span>
            </div>
            <p className="text-xs mt-0.5 opacity-90">
              {activeAnnouncement.message}
            </p>
          </div>
        </div>

        <button
          onClick={clearActiveAnnouncement}
          className="text-xs p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0"
          title="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

