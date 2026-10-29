"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ExamWorkspaceTabs } from "@/components/exam/ExamWorkspaceTabs";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { fetchExamSubmissions, fetchSubmissionResult, regradeRequest } from "@/lib/api";
import { Submission } from "@/types";
import {
  Server,
  Filter,
  Search,
  XCircle,
  RefreshCw,
  RotateCcw,
  X,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";

export default function TeacherExamSubmissionsPage() {
  const params = useParams();
  const examId = Number(params?.id) || 0;
  const { token } = useAuth();
  const {
    exams,
    submissions: localSubmissions,
    regradeSubmission,
    isLoadingExamData,
    dataApiError,
  } = useSocket();

  const exam = exams.find((item) => item.id === examId);
  const localExamSubmissions = useMemo(
    () => localSubmissions.filter((submission) => submission.exam_id === examId),
    [localSubmissions, examId]
  );

  const [backendSubmissions, setBackendSubmissions] = useState<Submission[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(Boolean(token));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regradingId, setRegradingId] = useState<number | null>(null);
  const mountedRef = useRef(true);

  const examSubmissions = token ? backendSubmissions : localExamSubmissions;
  const selectedSub =
    examSubmissions.find((submission) => submission.id === selectedSubId) || null;

  const loadSubmissions = useCallback(
    async (initial = false) => {
      if (!token) {
        setIsLoadingSubmissions(false);
        return;
      }
      if (initial) setIsLoadingSubmissions(true);
      else setIsRefreshing(true);
      try {
        const loaded = await fetchExamSubmissions(examId, token);
        if (!mountedRef.current) return;
        setBackendSubmissions(loaded);
        setLoadError(null);
      } catch (error) {
        if (!mountedRef.current) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load submissions for this exam."
        );
      } finally {
        if (!mountedRef.current) return;
        setIsLoadingSubmissions(false);
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
      setBackendSubmissions([]);
      setIsLoadingSubmissions(false);
      setLoadError(null);
      return;
    }

    void loadSubmissions(true);
    const timer = window.setInterval(() => {
      void loadSubmissions(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadSubmissions, token]);

  useEffect(() => {
    setSelectedSubId(null);
    setStatusFilter("all");
    setSearchTerm("");
    setActionError(null);
  }, [examId]);

  const queuedCount = examSubmissions.filter((item) => item.status === "queued").length;
  const runningCount = examSubmissions.filter((item) => item.status === "running").length;
  const completedCount = examSubmissions.filter((item) => item.status === "completed").length;
  const failedCount = examSubmissions.filter((item) => item.status === "error").length;

  const filteredSubmissions = examSubmissions.filter((submission) => {
    const matchesStatus =
      statusFilter === "all" ? true : submission.status === statusFilter;
    const normalizedSearch = searchTerm.toLowerCase();
    const matchesSearch =
      (submission.student_name || "").toLowerCase().includes(normalizedSearch) ||
      (submission.student_username || "").toLowerCase().includes(normalizedSearch) ||
      (submission.question_title || "").toLowerCase().includes(normalizedSearch) ||
      submission.id.toString().includes(searchTerm);
    return matchesStatus && matchesSearch;
  });

  const handleRegrade = async (submission: Submission) => {
    setActionError(null);
    setRegradingId(submission.id);
    try {
      if (!token) {
        await regradeSubmission(submission.id);
        return;
      }

      setBackendSubmissions((previous) =>
        previous.map((item) =>
          item.id === submission.id
            ? { ...item, status: "running", error_summary: null }
            : item
        )
      );
      await regradeRequest(submission.id, token);

      let finished = false;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const result = await fetchSubmissionResult(submission.id, token);
        if (
          result.submission.status === "completed" ||
          result.submission.status === "error"
        ) {
          finished = true;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (!finished) {
        setActionError(
          "The re-grade was queued but did not finish within 30 seconds. Refresh to check its latest state."
        );
      }
      await loadSubmissions(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The submission could not be re-graded."
      );
      await loadSubmissions(false);
    } finally {
      if (mountedRef.current) setRegradingId(null);
    }
  };

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
            <li className="text-orange-600 font-bold font-mono">Submission Dashboard</li>
          </ol>
        </nav>

        <ExamWorkspaceTabs examId={examId} active="submissions" />

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                EXAM-SCOPED SUBMISSION WORKSPACE
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                {exam?.title || `Examination #${examId}`} — Submission Dashboard
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Inspect candidate source code, review test diagnostics, and re-evaluate submissions for this exam only.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-slate-100 text-slate-700 text-xs font-mono font-bold border border-slate-200">
                <span className={`w-2 h-2 rounded-full ${token ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
                {token ? "Backend Results" : "Offline Preview"}
              </span>
              <button
                type="button"
                onClick={() => void loadSubmissions(false)}
                disabled={!token || isRefreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-xs font-bold rounded transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
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
                onClick={() => void loadSubmissions(true)}
                className="self-start sm:self-auto font-bold underline"
              >
                Retry
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                QUEUED JOBS
              </span>
              <div className="text-2xl font-black text-slate-800 mt-1 font-mono">{queuedCount}</div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Awaiting runner slot
              </span>
            </div>

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

            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                COMPLETED
              </span>
              <div className="text-2xl font-black text-green-700 mt-1 font-mono">{completedCount}</div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Graded & persisted
              </span>
            </div>

            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono block">
                FAILED / ERROR
              </span>
              <div className="text-2xl font-black text-red-600 mt-1 font-mono">{failedCount}</div>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-medium">
                Compiler / runtime crash
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search student, username, question, or ID..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="text-xs py-1.5 px-3 bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
              >
                <option value="all">All Statuses ({examSubmissions.length})</option>
                <option value="queued">Queued ({queuedCount})</option>
                <option value="running">In Execution ({runningCount})</option>
                <option value="completed">Completed ({completedCount})</option>
                <option value="error">Failed / Error ({failedCount})</option>
              </select>
            </div>
          </div>

          {actionError && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}

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
                  {isLoadingSubmissions && (
                    <tr>
                      <td colSpan={6} className="py-10 px-4 text-center text-sm text-slate-500">
                        Loading exam submissions...
                      </td>
                    </tr>
                  )}

                  {!isLoadingSubmissions && filteredSubmissions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 px-4 text-center">
                        <Server className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-sm font-semibold text-slate-700">
                          {examSubmissions.length === 0
                            ? "No submissions have been received for this exam yet."
                            : "No submissions match the current filter."}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          This dashboard only shows submissions belonging to {exam?.title || `exam #${examId}`}.
                        </p>
                      </td>
                    </tr>
                  )}

                  {!isLoadingSubmissions &&
                    filteredSubmissions.map((submission) => {
                      const isPerfect =
                        submission.status === "completed" &&
                        submission.score === submission.max_score;

                      return (
                        <tr
                          key={submission.id}
                          onClick={() => setSelectedSubId(submission.id)}
                          className={`hover:bg-orange-50/40 cursor-pointer transition-colors ${
                            selectedSub?.id === submission.id ? "bg-orange-50/70" : ""
                          }`}
                        >
                          <td className="py-2.5 px-4 font-bold text-slate-900">
                            {submission.student_username || `SV${submission.student_id}`}
                            <span className="font-sans font-normal text-slate-500 block text-[11px]">
                              {submission.student_name}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-sans font-medium text-slate-800">
                            {submission.question_title}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 uppercase text-[11px]">
                            {submission.language}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                submission.status === "completed"
                                  ? "bg-green-100 text-green-800"
                                  : submission.status === "running"
                                  ? "bg-orange-100 text-orange-800 animate-pulse"
                                  : submission.status === "queued"
                                  ? "bg-slate-100 text-slate-700"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {submission.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-bold">
                            {submission.score !== null ? (
                              <span className={isPerfect ? "text-green-700" : "text-slate-800"}>
                                {submission.score} / {submission.max_score}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-normal">Pending...</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSubId(submission.id);
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

        {selectedSub && (
          <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end">
            <div className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between animate-in slide-in-from-right duration-200">
              <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block">
                    EXAM #{examId} SUBMISSION INSPECTOR
                  </span>
                  <h3 className="text-base font-bold text-slate-900 mt-0.5">
                    {selectedSub.student_name} ({selectedSub.student_username || `SV${selectedSub.student_id}`})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedSub.question_title} • Submitted at{" "}
                    {new Date(selectedSub.submitted_at).toLocaleString()}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedSubId(null)}
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                  title="Close panel"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 p-5 overflow-y-auto space-y-4">
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
                      {selectedSub.test_results?.[0]?.time
                        ? `${selectedSub.test_results[0].time}s`
                        : "—"}
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

                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">
                    Student Source Code
                  </span>
                  <pre className="p-4 bg-slate-900 rounded border border-slate-800 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed max-h-72">
                    {selectedSub.source_code}
                  </pre>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">
                    Standard Output & Test Execution Diagnostics
                  </span>
                  {selectedSub.test_results && selectedSub.test_results.length > 0 ? (
                    selectedSub.test_results.map((testResult, index) => {
                      const awarded =
                        testResult.awarded_points ??
                        (testResult.passed === 1 ? testResult.score_weight ?? null : 0);
                      const weight = testResult.score_weight ?? null;
                      return (
                        <div
                          key={testResult.id}
                          className={`p-3 rounded border font-mono text-xs space-y-1.5 ${
                            testResult.passed === 1
                              ? "bg-emerald-50/50 border-emerald-200"
                              : "bg-red-50/40 border-red-200"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-800 flex items-center gap-1.5">
                              {testResult.is_sample ? "Sample" : "Hidden"} Test Case #{index + 1}
                            </span>
                            <span
                              className={`font-bold ${
                                testResult.passed === 1 ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {testResult.passed === 1 ? "PASSED" : "FAILED"}
                              {awarded !== null && weight !== null
                                ? ` · ${awarded}/${weight} pts`
                                : testResult.passed === 0
                                ? " · 0 pts"
                                : ""}
                            </span>
                          </div>

                          {testResult.input_data ? (
                            <div className="text-[11px]">
                              <span className="text-slate-400">Input: </span>
                              <span className="text-slate-700 whitespace-pre-wrap">
                                {testResult.input_data}
                              </span>
                            </div>
                          ) : null}
                          {testResult.expected_output ? (
                            <div className="text-[11px]">
                              <span className="text-slate-400">Expected: </span>
                              <span className="text-emerald-700 whitespace-pre-wrap">
                                {testResult.expected_output}
                              </span>
                            </div>
                          ) : null}
                          <div className="text-[11px]">
                            <span className="text-slate-400">Actual: </span>
                            <span
                              className={`whitespace-pre-wrap ${
                                testResult.passed === 1 ? "text-slate-700" : "text-red-700"
                              }`}
                            >
                              {testResult.stdout?.trim() ? testResult.stdout : "(no output)"}
                            </span>
                          </div>
                          {testResult.message && testResult.passed !== 1 && (
                            <div className="text-[11px] text-red-700">{testResult.message}</div>
                          )}
                          {testResult.stderr && (
                            <div className="text-[11px] text-red-700 bg-red-50 p-2 rounded border border-red-200 whitespace-pre-wrap">
                              {testResult.stderr}
                            </div>
                          )}
                          {testResult.compile_output && (
                            <div className="text-[11px] text-red-700 bg-red-50 p-2 rounded border border-red-200 whitespace-pre-wrap">
                              {testResult.compile_output}
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

              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void handleRegrade(selectedSub)}
                  disabled={
                    regradingId === selectedSub.id ||
                    selectedSub.status === "running" ||
                    selectedSub.status === "queued"
                  }
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-xs rounded transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <RotateCcw
                    className={`w-3.5 h-3.5 ${
                      regradingId === selectedSub.id ? "animate-spin" : ""
                    }`}
                  />
                  <span>
                    {regradingId === selectedSub.id
                      ? "Re-grading..."
                      : "Re-evaluate & Mark Solution"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedSubId(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

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
