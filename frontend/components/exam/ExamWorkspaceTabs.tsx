"use client";

import React from "react";
import Link from "next/link";
import { Activity, FileCode2, Server } from "lucide-react";

type ExamWorkspaceTab = "questions" | "submissions" | "monitoring";

const TABS: Array<{
  key: ExamWorkspaceTab;
  label: string;
  segment: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "questions",
    label: "Questions & Test Cases",
    segment: "questions",
    icon: FileCode2,
  },
  {
    key: "submissions",
    label: "Submission Dashboard",
    segment: "submissions",
    icon: Server,
  },
  {
    key: "monitoring",
    label: "Realtime Monitor",
    segment: "monitoring",
    icon: Activity,
  },
];

export function ExamWorkspaceTabs({
  examId,
  active,
}: {
  examId: number;
  active: ExamWorkspaceTab;
}) {
  return (
    <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={`/teacher/exams/${examId}/${tab.segment}`}
            aria-current={isActive ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-md px-3.5 py-2 transition-colors ${
              isActive
                ? "bg-slate-900 text-orange-400 shadow-xs"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${isActive ? "text-orange-400" : "text-slate-400"}`} />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
