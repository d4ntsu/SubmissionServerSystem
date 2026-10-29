"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ExamWorkspaceTabs } from "@/components/exam/ExamWorkspaceTabs";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { fetchExamMonitor, fetchExamSubmissions } from "@/lib/api";
import {
  ExamMonitorParticipant,
  RealtimeEventLog,
  Submission,
} from "@/types";
import {
  Search,
  Filter,
  ScrollText,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  online: { label: "Online", cls: "bg-blue-100 text-blue-800" },
  in_exam: { label: "In Exam", cls: "bg-emerald-100 text-emerald-800" },
  submitted: { label: "Submitted", cls: "bg-purple-100 text-purple-800" },
  idle: { label: "Idle", cls: "bg-amber-100 text-amber-800" },
  disconnected: { label: "Offline", cls: "bg-slate-200 text-slate-600" },
};

const SUBMISSION_BADGE: Record<string, { label: string; cls: string }> = {
  none: { label: "Not Submitted", cls: "bg-slate-100 text-slate-500" },
  queued: { label: "Queued", cls: "bg-amber-100 text-amber-700" },
  running: { label: "Grading", cls: "bg-orange-100 text-orange-700" },
  graded: { label: "Graded", cls: "bg-purple-100 text-purple-800" },
  passed: { label: "Passed", cls: "bg-emerald-100 text-emerald-800" },
  error: { label: "Failed", cls: "bg-red-100 text-red-700" },
};

const LOG_LEVEL_CLS: Record<string, string> = {
  INFO: "text-blue-600",
  WARN: "text-amber-600",
  EVENT: "text-orange-600",
  SUBMISSION: "text-emerald-600",
  SYSTEM: "text-slate-500",
};

function formatLogTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return timestamp;
  return parsed.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSubmissionBadge(participant: ExamMonitorParticipant) {
  if (!participant.latest_submission_status) return SUBMISSION_BADGE.none;
  if (participant.latest_submission_status === "completed") {
    return participant.latest_score === participant.latest_max_score
      ? SUBMISSION_BADGE.passed
      : SUBMISSION_BADGE.graded;
  }
  if (participant.latest_submission_status === "error") return SUBMISSION_BADGE.error;
  return (
    SUBMISSION_BADGE[participant.latest_submission_status] ?? SUBMISSION_BADGE.none
  );
}

function buildSubmissionLogs(submissions: Submission[]): RealtimeEventLog[] {
  return submissions.map((submission) => {
    const timestamp = submission.graded_at || submission.submitted_at;
    const failed = submission.status === "error";
    return {
      id: `exam-submission-${submission.id}`,
      timestamp,
      level: failed ? "WARN" : "SUBMISSION",
      source: "Backend Grader",
      message: failed
        ? `${submission.student_name} — submission #${submission.id} for "${submission.question_title}" failed: ${
            submission.error_summary || "grading error"
          }`
        : `${submission.student_name} — submission #${submission.id} for "${submission.question_title}" is ${submission.status}${
            submission.score !== null ? ` (${submission.score}/${submission.max_score} pts)` : ""
          }`,
      details: { exam_id: submission.exam_id, submission_id: submission.id },
    };
  });
}

export default function TeacherExamRealtimeMonitoringPage() {
  const params = useParams();
  const examId = Number(params?.id) || 0;
  const { token } = useAuth();
  const {
    exams,
    studentsStatus,
    eventLogs,
    submissions: localSubmissions,
    isLoadingExamData,
    dataApiError,
  } = useSocket();

  const exam = exams.find((item) => item.id === examId);
  const [participants, setParticipants] = useState<ExamMonitorParticipant[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const mountedRef = useRef(true);

  const localExamSubmissions = useMemo(
    () => localSubmissions.filter((submission) => submission.exam_id === examId),
    [localSubmissions, examId]
  );

  const fallbackParticipants = useMemo<ExamMonitorParticipant[]>(() => {
    if (!exam) return [];
    return studentsStatus
      .filter((student) => {
        if (!student.current_exam) return true;
        return (
          student.current_exam === exam.title ||
          exam.title.includes(student.current_exam) ||
          student.current_exam.includes(exam.title)
        );
      })
      .map((student) => {
        const studentSubmissions = localExamSubmissions.filter(
          (submission) => submission.student_id === student.student_id
        );
        const latest = [...studentSubmissions].sort(
          (a, b) =>
            new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        )[0];
        return {
          student_id: student.student_id,
          student_name: student.student_name,
          username: student.username,
          client_ip: student.client_ip,
          status: student.status,
          current_exam: exam.title,
          current_question: student.current_question || null,
          submissions_count: studentSubmissions.length,
          online: student.status !== "disconnected",
          last_seen_at: null,
          latest_submission_status: latest?.status ?? null,
          latest_score: latest?.score ?? null,
          latest_max_score: latest?.max_score ?? null,
          latest_submitted_at: latest?.submitted_at ?? null,
        };
      });
  }, [studentsStatus, localExamSubmissions, exam]);

  const scopedParticipants = token ? participants : fallbackParticipants;
  const scopedSubmissions = token ? submissions : localExamSubmissions;

  const loadMonitor = useCallback(
    async (initial = false) => {
      if (!token) {
        setIsLoading(false);
        return;
      }
      if (initial) setIsLoading(true);
      else setIsRefreshing(true);
      try {
        const [loadedParticipants, loadedSubmissions] = await Promise.all([
          fetchExamMonitor(examId, token),
          fetchExamSubmissions(examId, token),
        ]);
        if (!mountedRef.current) return;
        setParticipants(loadedParticipants);
        setSubmissions(loadedSubmissions);
        setLoadError(null);
      } catch (error) {
        if (!mountedRef.current) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load the realtime monitor for this exam."
        );
      } finally {
        if (!mountedRef.current) return;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [examId, token]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setParticipants([]);
      setSubmissions([]);
      setIsLoading(false);
      setLoadError(null);
      return;
    }
    void loadMonitor(true);
    const timer = window.setInterval(() => {
      void loadMonitor(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadMonitor, token]);

  useEffect(() => {
    setSearchTerm("");
    setStatusFilter("all");
  }, [examId]);

  const connectedCount = scopedParticipants.filter(
    (participant) => participant.online
  ).length;
  const disconnectedCount = scopedParticipants.length - connectedCount;

  const filteredStudents = scopedParticipants.filter((participant) => {
    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "connected"
        ? participant.online
        : !participant.online;
    const normalizedSearch = searchTerm.toLowerCase();
    const matchesSearch =
      participant.student_name.toLowerCase().includes(normalizedSearch) ||
      participant.username.toLowerCase().includes(normalizedSearch) ||
      (participant.client_ip || "").includes(searchTerm);
    return matchesStatus && matchesSearch;
  });

  const scopedLogs = useMemo(() => {
    const contextLogs = eventLogs.filter(
      (log) =>
        log.details?.exam_id === examId ||
        Boolean(exam?.title && log.message.includes(exam.title))
    );
    return [...buildSubmissionLogs(scopedSubmissions), ...contextLogs].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [eventLogs, scopedSubmissions, examId, exam?.title]);

  return (
    <ProtectedRoute requireTeacher={true}>
      <AppLayout>
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/teacher/exams" className="hover:text-orange-600 transition-colors">
                Exams Management
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link
                href={`/teacher/exams/${examId}/questions`}
                className="hover:text-orange-600 transition-colors"
              >
                Exam #{exam?.id || examId}: {exam?.title || "Loading..."}
              </Link>
            </li>
            <li>/</li>
            <li className="text-orange-600 font-bold font-mono">Realtime Monitor</li>
          </ol>
        </nav>

        <ExamWorkspaceTabs examId={examId} active="monitoring" />

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
            <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                  EXAM-SCOPED REALTIME MONITOR
                </span>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                  {exam?.title || `Examination #${examId}`} — Participant Monitor
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Tracking students, submissions, and activity for this exam only.
                </p>
              </div>

              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-600 shadow-xs"></span>
                  <span className="text-xs font-bold text-slate-800">
                    {connectedCount} CONNECTED
                  </span>
                </div>
                <span className="text-slate-300">•</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                  <span className="text-xs font-bold text-slate-500">
                    {disconnectedCount} DISCONNECTED
                  </span>
                </div>
              </div>
            </div>

            {!exam && !isLoadingExamData && !dataApiError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  This exam could not be found in your exam list.{" "}
                  <Link href="/teacher/exams" className="font-bold underline">
                    Return to exam management
                  </Link>
                </span>
              </div>
            )}

            {loadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {loadError}
                </span>
                <button
                  type="button"
                  onClick={() => void loadMonitor(true)}
                  className="self-start sm:self-auto font-bold underline"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search candidate name, ID, or IP..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="text-xs py-1.5 px-3 bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                >
                  <option value="all">All Participants ({scopedParticipants.length})</option>
                  <option value="connected">Connected Only ({connectedCount})</option>
                  <option value="disconnected">Disconnected Only ({disconnectedCount})</option>
                </select>
                <button
                  type="button"
                  onClick={() => void loadMonitor(false)}
                  disabled={!token || isRefreshing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-xs font-bold rounded transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Loading exam participants...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStudents.map((student) => {
                  const statusBadge =
                    STATUS_BADGE[student.status] ?? STATUS_BADGE.idle;
                  const submissionBadge = getSubmissionBadge(student);

                  return (
                    <div
                      key={student.student_id}
                      className={`p-4 rounded-lg border transition-all ${
                        student.online
                          ? "bg-white border-slate-200 shadow-xs hover:border-orange-300"
                          : "bg-slate-50/60 border-slate-200 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              student.online ? "bg-green-600 shadow-xs" : "bg-slate-400"
                            }`}
                            title={student.online ? "Online" : "Disconnected"}
                          />
                          <div>
                            <h3 className="font-bold text-slate-900 text-xs">
                              {student.student_name}
                            </h3>
                            <span className="text-[10px] text-slate-400 font-mono block">
                              ID: {student.username}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`text-[9px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded ${statusBadge.cls}`}
                        >
                          {statusBadge.label}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs font-mono pt-2 border-t border-slate-100 text-slate-600">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">
                            IP ADDRESS
                          </span>
                          <span>{student.client_ip || "—"}</span>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">
                            EXAM
                          </span>
                          <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                            {student.current_exam || "—"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">
                            DOING
                          </span>
                          <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                            {student.current_question || "—"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">
                            SUBMISSIONS
                          </span>
                          <span className="font-semibold text-slate-800">
                            {student.submissions_count}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-1">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">
                            SUBMISSION
                          </span>
                          <span
                            className={`text-[9px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded ${submissionBadge.cls}`}
                          >
                            {submissionBadge.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredStudents.length === 0 && (
                  <div className="col-span-full text-center py-12 text-slate-400 text-xs font-mono">
                    {scopedParticipants.length === 0
                      ? "No participants have joined this exam yet."
                      : "No participants match the current filter."}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-orange-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700 font-mono">
                  Exam Activity Log
                </span>
                <span className="text-[9px] bg-slate-200 text-slate-600 font-mono font-bold px-1.5 py-0.5 rounded">
                  {scopedLogs.length} ENTRIES
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {token ? "Backend + session activity" : "Offline session activity"}
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 font-mono text-[11px]">
              {scopedLogs.length === 0 ? (
                <div className="p-6 text-center text-slate-400 italic text-xs">
                  No activity logged for this exam yet. Events will appear here as students interact with it.
                </div>
              ) : (
                scopedLogs.map((log) => (
                  <div
                    key={log.id}
                    className="px-5 py-2 flex items-start gap-3 hover:bg-slate-50 transition-colors"
                  >
                    <span
                      className="text-slate-400 shrink-0 w-32 text-[10px] pt-0.5"
                      title={new Date(log.timestamp).toString()}
                    >
                      {formatLogTimestamp(log.timestamp)}
                    </span>
                    <span
                      className={`shrink-0 font-bold uppercase text-[9px] w-20 pt-0.5 ${
                        LOG_LEVEL_CLS[log.level] ?? "text-slate-500"
                      }`}
                    >
                      [{log.level}]
                    </span>
                    <span className="text-slate-500 shrink-0 w-24 truncate text-[10px] pt-0.5">
                      {log.source}
                    </span>
                    <span className="text-slate-800 leading-snug">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Link
            href="/teacher/exams"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-orange-600 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to all exams
          </Link>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
