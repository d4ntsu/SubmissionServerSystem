"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Terminal,
  BookOpen,
  Clock,
  Layers,
  ArrowRight,
  Award,
  Lock,
} from "lucide-react";

export default function ExamDashboardPage() {
  const { user, isTeacher } = useAuth();
  const { exams } = useSocket();

  const launchExamWindow = (examId: number) => {
    const width = 1280;
    const height = 900;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    const popup = window.open(
      `/student/exams/${examId}?secure=1`,
      `exam_window_${examId}`,
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (popup) {
      popup.focus();
    } else {
      window.location.href = `/student/exams/${examId}`;
    }
  };

  // Collapsible section states
  const [activeOpen, setActiveOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);

  const activeExams = exams.filter((e) => e.status === "started");
  const upcomingExams = exams.filter((e) => e.status === "published");
  const completedExams = exams.filter((e) => e.status === "ended");

  return (
    <ProtectedRoute>
      <AppLayout>
        {/* Breadcrumb Wayfinding at Top Left */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/dashboard" className="hover:text-orange-600 transition-colors">
                Portal
              </Link>
            </li>
            <li>/</li>
            <li>
              <span className="hover:text-orange-600 transition-colors">Examinations</span>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">Active Sessions</li>
          </ol>
        </nav>

        {/* Boxed Central Content Container */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                ACADEMIC SESSION • SEMESTER 1
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                Examination Selection Dashboard
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Select an active examination room below. Submissions are compiled in real time within isolated containers.
              </p>
            </div>
            <div className="text-xs font-mono font-semibold text-slate-500 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
              Candidate: <span className="text-slate-800 font-bold">{user?.username}</span>
            </div>
          </div>

          {/* Section 1: Available Active Examinations */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setActiveOpen(!activeOpen)}
              className="w-full px-5 py-3.5 bg-slate-50 hover:bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 tracking-tight uppercase font-mono">
                  Available Active Examinations ({activeExams.length})
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  LIVE NOW
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${
                  activeOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            {activeOpen && (
              <div className="divide-y divide-slate-100">
                {activeExams.map((exam) => (
                  <div
                    key={exam.id}
                    className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Square colored icon for exam type */}
                      <div className="w-12 h-12 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Code2 className="w-6 h-6" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-mono">
                            Java & Data Structures
                          </span>
                          {exam.has_password && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-mono flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" />
                              Password
                            </span>
                          )}
                          <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {exam.duration_minutes} Mins
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {exam.title}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                          {exam.description}
                        </p>
                        <div className="text-[11px] text-slate-400 font-mono pt-1 flex items-center gap-4">
                          <span>{exam.questions_count} Problems</span>
                          <span>•</span>
                          <span>{exam.total_points} Total Points</span>
                        </div>
                      </div>
                    </div>

                    {/* Right-aligned action button in vibrant orange */}
                    <div className="shrink-0 self-end sm:self-center">
                      {isTeacher ? (
                        <Link
                          href={`/student/exams/${exam.id}`}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs rounded-md shadow-xs transition-colors"
                        >
                          <span>Open Exam Room</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      ) : (
                        <button
                          onClick={() => launchExamWindow(exam.id)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs rounded-md shadow-xs transition-colors"
                        >
                          <span>Enter Exam Room</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Upcoming Scheduled Assessments */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setUpcomingOpen(!upcomingOpen)}
              className="w-full px-5 py-3.5 bg-slate-50 hover:bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 tracking-tight uppercase font-mono">
                  Upcoming Scheduled Assessments ({upcomingExams.length})
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${
                  upcomingOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            {upcomingOpen && (
              <div className="divide-y divide-slate-100">
                {upcomingExams.map((exam) => (
                  <div
                    key={exam.id}
                    className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Square colored icon for upcoming */}
                      <div className="w-12 h-12 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Terminal className="w-6 h-6" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 font-mono">
                            Lab Assessment
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            Scheduled: Tomorrow 09:00 AM
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {exam.title}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                          {exam.description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 self-end sm:self-center">
                      <button
                        disabled
                        className="px-4 py-2 bg-slate-100 text-slate-400 font-semibold text-xs rounded-md border border-slate-200 cursor-not-allowed"
                      >
                        Opens Tomorrow
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Archived & Practice Activities */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setCompletedOpen(!completedOpen)}
              className="w-full px-5 py-3.5 bg-slate-50 hover:bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 tracking-tight uppercase font-mono">
                  Archived & Practice Activities ({completedExams.length})
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${
                  completedOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            {completedOpen && (
              <div className="divide-y divide-slate-100">
                {completedExams.map((exam) => (
                  <div
                    key={exam.id}
                    className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Square colored icon for practice */}
                      <div className="w-12 h-12 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <BookOpen className="w-6 h-6" />
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-mono">
                          Completed Session
                        </span>
                        <h3 className="text-sm font-bold text-slate-800">
                          {exam.title}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                          {exam.description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 self-end sm:self-center">
                      <Link
                        href="/student/submissions"
                        className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-md transition-colors"
                      >
                        Review Submissions
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
