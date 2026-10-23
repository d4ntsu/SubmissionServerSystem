"use client";

import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useSocket } from "@/lib/socket-context";
import {
  Search,
  Filter,
  ScrollText,
  Trash2,
} from "lucide-react";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  online:        { label: "Online",       cls: "bg-blue-100 text-blue-800" },
  in_exam:       { label: "In Exam",      cls: "bg-emerald-100 text-emerald-800" },
  submitted:     { label: "Submitted",    cls: "bg-purple-100 text-purple-800" },
  idle:          { label: "Idle",         cls: "bg-amber-100 text-amber-800" },
  disconnected:  { label: "Offline",      cls: "bg-slate-200 text-slate-600" },
};

const SUBMISSION_BADGE: Record<string, { label: string; cls: string }> = {
  none:    { label: "Not Submitted", cls: "bg-slate-100 text-slate-500" },
  queued:  { label: "Queued",        cls: "bg-amber-100 text-amber-700" },
  running: { label: "Grading",       cls: "bg-orange-100 text-orange-700" },
  graded:  { label: "Graded",        cls: "bg-purple-100 text-purple-800" },
  passed:  { label: "Passed",        cls: "bg-emerald-100 text-emerald-800" },
  error:   { label: "Failed",        cls: "bg-red-100 text-red-700" },
};

const LOG_LEVEL_CLS: Record<string, string> = {
  INFO:       "text-blue-600",
  WARN:       "text-amber-600",
  EVENT:      "text-orange-600",
  SUBMISSION: "text-emerald-600",
  SYSTEM:     "text-slate-500",
};

export default function TeacherRealtimeMonitoringPage() {
  const { studentsStatus, eventLogs, clearLogs, submissions } = useSocket();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const connectedCount = studentsStatus.filter((s) => s.status !== "disconnected").length;
  const disconnectedCount = studentsStatus.filter((s) => s.status === "disconnected").length;

  const getSubmissionBadge = (studentId: number) => {
    const studentSubmissions = submissions.filter((s) => s.student_id === studentId);
    if (studentSubmissions.length === 0) return SUBMISSION_BADGE.none;

    const latest = [...studentSubmissions].sort(
      (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    )[0];

    if (latest.status === "completed") {
      return latest.score === latest.max_score ? SUBMISSION_BADGE.passed : SUBMISSION_BADGE.graded;
    }
    if (latest.status === "error") return SUBMISSION_BADGE.error;
    return SUBMISSION_BADGE[latest.status] ?? SUBMISSION_BADGE.none;
  };

  const filteredStudents = studentsStatus.filter((s) => {
    const isOnline = s.status !== "disconnected";
    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "connected"
        ? isOnline
        : !isOnline;
    const matchesSearch =
      s.student_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.client_ip.includes(searchTerm);
    return matchesStatus && matchesSearch;
  });

  return (
    <ProtectedRoute requireTeacher={true}>
      <AppLayout>
        <div className="space-y-4">
          {/* Flat White Centralized Container */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
            {/* Header */}
            <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                  REALTIME TCP &amp; WEBSOCKET MONITOR
                </span>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                  Participant Realtime Monitoring Screen
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Real-time tracking of assignments, student activity, and submission status.
                </p>
              </div>

              {/* Connected / Disconnected summary */}
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

            {/* Search & Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search candidate name, ID, or IP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-xs py-1.5 px-3 bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                >
                  <option value="all">All Participants ({studentsStatus.length})</option>
                  <option value="connected">Connected Only ({connectedCount})</option>
                  <option value="disconnected">Disconnected Only ({disconnectedCount})</option>
                </select>
              </div>
            </div>

            {/* Participant Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredStudents.map((student) => {
                const isOnline = student.status !== "disconnected";
                const statusBadge = STATUS_BADGE[student.status] ?? STATUS_BADGE.idle;
                const submissionBadge = getSubmissionBadge(student.student_id);

                return (
                  <div
                    key={student.student_id}
                    className={`p-4 rounded-lg border transition-all ${
                      isOnline
                        ? "bg-white border-slate-200 shadow-xs hover:border-orange-300"
                        : "bg-slate-50/60 border-slate-200 opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2.5">
                        {/* Solid Green / Gray Status Dot */}
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isOnline ? "bg-green-600 shadow-xs" : "bg-slate-400"
                          }`}
                          title={isOnline ? "Online" : "Disconnected"}
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

                    {/* Metadata rows */}
                    <div className="space-y-1.5 text-xs font-mono pt-2 border-t border-slate-100 text-slate-600">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">IP ADDRESS</span>
                        <span>{student.client_ip}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">ASSIGNMENT</span>
                        <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                          {student.current_exam || "—"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">DOING</span>
                        <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                          {student.current_question || "—"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <span className="text-slate-400 font-bold uppercase text-[9px]">SUBMISSION</span>
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
                <div className="col-span-3 text-center py-12 text-slate-400 text-xs font-mono">
                  No participants match the current filter.
                </div>
              )}
            </div>
          </div>

          {/* Activity Log Panel */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-orange-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700 font-mono">
                  Student Activity Log
                </span>
                <span className="text-[9px] bg-slate-200 text-slate-600 font-mono font-bold px-1.5 py-0.5 rounded">
                  {eventLogs.length} ENTRIES
                </span>
              </div>
              <button
                onClick={clearLogs}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500 font-mono transition-colors"
                title="Clear log"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 font-mono text-[11px]">
              {eventLogs.length === 0 ? (
                <div className="p-6 text-center text-slate-400 italic text-xs">
                  No activity logged yet. Events will appear here as students interact with the exam.
                </div>
              ) : (
                [...eventLogs].reverse().map((log) => (
                  <div key={log.id} className="px-5 py-2 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                    <span className="text-slate-400 shrink-0 w-16 text-[10px] pt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span
                      className={`shrink-0 font-bold uppercase text-[9px] w-20 pt-0.5 ${
                        LOG_LEVEL_CLS[log.level] ?? "text-slate-500"
                      }`}
                    >
                      [{log.level}]
                    </span>
                    <span className="text-slate-500 shrink-0 w-24 truncate text-[10px] pt-0.5">{log.source}</span>
                    <span className="text-slate-800 leading-snug">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
