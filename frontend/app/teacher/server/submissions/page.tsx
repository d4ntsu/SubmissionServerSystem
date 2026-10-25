"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useSocket } from "@/lib/socket-context";
import { Submission, SubmissionStatus } from "@/types";
import {
  Server,
  Filter,
  Search,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  Cpu,
  FileCode,
  RotateCcw,
  X,
  Play,
  Layers,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

export default function TeacherLiveSubmissionsDashboard() {
  const { submissions, regradeSubmission } = useSocket();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  const selectedSub = submissions.find((sub) => sub.id === selectedSubId) || null;

  // 4 Top-aligned KPI metrics
  const queuedCount = submissions.filter((s) => s.status === "queued").length;
  const runningCount = submissions.filter((s) => s.status === "running").length;
  const completedCount = submissions.filter((s) => s.status === "completed").length;
  const failedCount = submissions.filter((s) => s.status === "error").length;

  const filteredSubmissions = submissions.filter((sub) => {
    const matchesStatus = statusFilter === "all" ? true : sub.status === statusFilter;
    const matchesSearch =
      sub.student_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.student_username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.question_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.id.toString().includes(searchTerm);
    return matchesStatus && matchesSearch;
  });

  return (
    <ProtectedRoute requireTeacher={true}>
      <AppLayout>
        {/* Flat White Centralized Container over textured light gray background */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                ADMINISTRATION & MONITORING
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                Live Submissions Dashboard
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Real-time queue monitoring, Piston container executions, and candidate code inspection.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-slate-100 text-slate-700 text-xs font-mono font-bold border border-slate-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Runner: Localhost:2000
              </span>
            </div>
          </div>

          {/* 1. Four Top-Aligned KPI Tiles (Queued, Running, Completed, Failed) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Queued Tile */}
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                QUEUED JOBS
              </span>
              <div className="text-2xl font-black text-slate-800 mt-1 font-mono">
                {queuedCount}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Awaiting runner slot
              </span>
            </div>

            {/* Running Tile */}
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                IN EXECUTION
              </span>
              <div className="text-2xl font-black text-orange-600 mt-1 font-mono flex items-center gap-2">
                <span>{runningCount}</span>
                {runningCount > 0 && <RefreshCw className="w-4 h-4 animate-spin text-orange-500" />}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Piston container sandbox
              </span>
            </div>

            {/* Completed Tile */}
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                COMPLETED
              </span>
              <div className="text-2xl font-black text-green-700 mt-1 font-mono">
                {completedCount}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Graded & persisted
              </span>
            </div>

            {/* Failed Tile */}
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                FAILED / ERROR
              </span>
              <div className="text-2xl font-black text-red-600 mt-1 font-mono">
                {failedCount}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Compiler / Runtime crash
              </span>
            </div>
          </div>

          {/* Search bar and status dropdown filters with vibrant orange search button */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="relative w-full sm:w-80 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search Student ID, name or question..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>
              <button
                type="button"
                className="px-3.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded transition-colors shadow-xs"
              >
                Search
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs py-1.5 px-3 bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
              >
                <option value="all">All Statuses ({submissions.length})</option>
                <option value="queued">Queued ({queuedCount})</option>
                <option value="running">In Execution ({runningCount})</option>
                <option value="completed">Completed ({completedCount})</option>
                <option value="error">Failed / Error ({failedCount})</option>
              </select>
            </div>
          </div>

          {/* Dense, Scannable Table (Student ID, Question, Language, Status, Score) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] font-mono">
                  <tr>
                    <th className="py-2.5 px-4">Student ID</th>
                    <th className="py-2.5 px-4">Question</th>
                    <th className="py-2.5 px-4">Language</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Score</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredSubmissions.map((sub) => {
                    const isPerfect = sub.status === "completed" && sub.score === sub.max_score;

                    return (
                      <tr
                        key={sub.id}
                        onClick={() => setSelectedSubId(sub.id)}
                        className={`hover:bg-orange-50/40 cursor-pointer transition-colors ${
                          selectedSub?.id === sub.id ? "bg-orange-50/70" : ""
                        }`}
                      >
                        <td className="py-2.5 px-4 font-bold text-slate-900">
                          {sub.student_username || `SV${sub.student_id}`}
                          <span className="font-sans font-normal text-slate-500 block text-[11px]">
                            {sub.student_name}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-sans font-medium text-slate-800">
                          {sub.question_title}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 uppercase text-[11px]">
                          {sub.language}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              sub.status === "completed"
                                ? "bg-green-100 text-green-800"
                                : sub.status === "running"
                                ? "bg-orange-100 text-orange-800 animate-pulse"
                                : sub.status === "queued"
                                ? "bg-slate-100 text-slate-700"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {sub.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-bold">
                          {sub.score !== null ? (
                            <span className={isPerfect ? "text-green-700" : "text-slate-800"}>
                              {sub.score} / {sub.max_score}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">Pending...</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSubId(sub.id);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-orange-500 hover:text-white rounded text-[11px] font-sans font-bold text-slate-700 transition-colors"
                          >
                            Inspect Code →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right-Aligned Slide-Over Panel (Drawer) displaying source code, execution time, stdout */}
        {selectedSub && (
          <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end">
            <div className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between animate-in slide-in-from-right duration-200">
              {/* Drawer Top Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block">
                    CANDIDATE SUBMISSION INSPECTOR
                  </span>
                  <h3 className="text-base font-bold text-slate-900 mt-0.5">
                    {selectedSub.student_name} ({selectedSub.student_username || `SV${selectedSub.student_id}`})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedSub.question_title} • Submitted at {new Date(selectedSub.submitted_at).toLocaleTimeString()}
                  </p>
                </div>

                <button
                  onClick={() => setSelectedSubId(null)}
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                  title="Close Panel"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Content Body */}
              <div className="flex-1 p-5 overflow-y-auto space-y-4">
                {/* Metrics Bar */}
                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded border border-slate-200 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold uppercase">SCORE</span>
                    <strong className="text-slate-900 text-sm">
                      {selectedSub.score ?? "Pending"} / {selectedSub.max_score}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold uppercase">RUNTIME</span>
                    <strong className="text-slate-900 text-sm">
                      {selectedSub.test_results?.[0]?.time ? `${selectedSub.test_results[0].time}s` : "0.14s"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold uppercase">LANGUAGE</span>
                    <strong className="text-slate-900 text-sm uppercase">{selectedSub.language}</strong>
                  </div>
                </div>

                {selectedSub.error_summary && (
                  <div className="rounded border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 flex items-start gap-2">
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block uppercase tracking-wide font-mono text-[10px]">
                        Grading error
                      </strong>
                      <span>{selectedSub.error_summary}</span>
                    </div>
                  </div>
                )}

                {/* Source Code */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">
                    Student Source Code
                  </span>
                  <pre className="p-4 bg-slate-900 rounded border border-slate-800 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed max-h-72">
                    {selectedSub.source_code}
                  </pre>
                </div>

                {/* Stdout / Stderr Results */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">
                    Standard Output & Test Execution Diagnostics
                  </span>
                  {selectedSub.test_results && selectedSub.test_results.length > 0 ? (
                    selectedSub.test_results.map((tr, i) => {
                      const awarded = tr.awarded_points ?? (tr.passed === 1 ? tr.score_weight ?? null : 0);
                      const weight = tr.score_weight ?? null;
                      return (
                        <div
                          key={tr.id}
                          className={`p-3 rounded border font-mono text-xs space-y-1.5 ${
                            tr.passed === 1
                              ? "bg-emerald-50/50 border-emerald-200"
                              : "bg-red-50/40 border-red-200"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-800 flex items-center gap-1.5">
                              {tr.is_sample ? "Sample" : "Hidden"} Test Case #{i + 1}
                            </span>
                            <span className={`font-bold ${tr.passed === 1 ? "text-green-600" : "text-red-600"}`}>
                              {tr.passed === 1 ? "PASSED" : "FAILED"}
                              {awarded !== null && weight !== null
                                ? ` · ${awarded}/${weight} pts`
                                : tr.passed === 0
                                ? " · 0 pts"
                                : ""}
                            </span>
                          </div>

                          {tr.input_data ? (
                            <div className="text-[11px]">
                              <span className="text-slate-400">Input: </span>
                              <span className="text-slate-700 whitespace-pre-wrap">{tr.input_data}</span>
                            </div>
                          ) : null}
                          {tr.expected_output ? (
                            <div className="text-[11px]">
                              <span className="text-slate-400">Expected: </span>
                              <span className="text-emerald-700 whitespace-pre-wrap">{tr.expected_output}</span>
                            </div>
                          ) : null}
                          <div className="text-[11px]">
                            <span className="text-slate-400">Actual: </span>
                            <span className={`whitespace-pre-wrap ${tr.passed === 1 ? "text-slate-700" : "text-red-700"}`}>
                              {tr.stdout?.trim() ? tr.stdout : "(no output)"}
                            </span>
                          </div>
                          {tr.message && tr.passed !== 1 && (
                            <div className="text-[11px] text-red-700">{tr.message}</div>
                          )}
                          {tr.stderr && (
                            <div className="text-[11px] text-red-700 bg-red-50 p-2 rounded border border-red-200 whitespace-pre-wrap">
                              {tr.stderr}
                            </div>
                          )}
                          {tr.compile_output && (
                            <div className="text-[11px] text-red-700 bg-red-50 p-2 rounded border border-red-200 whitespace-pre-wrap">
                              {tr.compile_output}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-xs text-slate-400 italic p-3 bg-slate-50 rounded border border-slate-200">
                      No test diagnostics are available for this submission yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Drawer Bottom Actions */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <button
                  onClick={() => regradeSubmission(selectedSub.id)}
                  disabled={selectedSub.status === "running" || selectedSub.status === "queued"}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-xs rounded transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <RotateCcw
                    className={`w-3.5 h-3.5 ${
                      selectedSub.status === "running" ? "animate-spin" : ""
                    }`}
                  />
                  <span>
                    {selectedSub.status === "running"
                      ? "Re-grading..."
                      : "Re-evaluate & Re-grade Solution"}
                  </span>
                </button>

                <button
                  onClick={() => setSelectedSubId(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </AppLayout>
    </ProtectedRoute>
  );
}
