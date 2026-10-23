"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Search,
  Filter,
} from "lucide-react";

export default function SubmissionsHistoryPage() {
  const { user, isTeacher } = useAuth();
  const { submissions, questions } = useSocket();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const isResultVisible = (examId?: number, questionId?: number) => {
    if (isTeacher) return true;
    const examQuestions = questions[examId ?? 0] || [];
    const question = examQuestions.find((q) => q.id === questionId);
    return question?.show_result_to_student !== false;
  };

  const studentSubmissions = submissions.filter((sub) => {
    const isOwner = isTeacher || sub.student_id === user?.id;
    const matchesStatus = statusFilter === "all" ? true : sub.status === statusFilter;
    const matchesSearch =
      sub.question_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.id.toString().includes(searchTerm);
    return isOwner && matchesStatus && matchesSearch;
  });

  return (
    <ProtectedRoute>
      <AppLayout>
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/dashboard" className="hover:text-orange-600 transition-colors">
                Portal
              </Link>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">My Submissions & Results</li>
          </ol>
        </nav>

        {/* Boxed Central Container */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                ACADEMIC RECORDS
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                Evaluation Results & Submission History
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search problem title..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
              >
                <option value="all">All States</option>
                <option value="completed">Completed</option>
                <option value="running">Running</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>

          {/* Spacious Horizontal Rows separated by faint gray lines */}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {studentSubmissions.map((sub) => {
              const isAccepted = sub.score === sub.max_score;
              const resultsVisible = isResultVisible(sub.exam_id, sub.question_id);

              return (
                <div
                  key={sub.id}
                  className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-400">
                        #{sub.id}
                      </span>
                      {!resultsVisible ? (
                        <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-bold text-[10px] uppercase font-mono shadow-xs">
                          RESULT HIDDEN
                        </span>
                      ) : isAccepted ? (
                        <span className="px-2 py-0.5 rounded bg-green-600 text-white font-bold text-[10px] uppercase font-mono shadow-xs">
                          ACCEPTED
                        </span>
                      ) : sub.status === "completed" ? (
                        <span className="px-2 py-0.5 rounded bg-orange-500 text-white font-bold text-[10px] uppercase font-mono shadow-xs">
                          PARTIAL
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-red-600 text-white font-bold text-[10px] uppercase font-mono shadow-xs">
                          {sub.status.toUpperCase()}
                        </span>
                      )}
                      <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {sub.language}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900">
                      {sub.question_title}
                    </h3>
                    <p className="text-xs text-slate-400 font-mono">
                      {sub.exam_title} • Submitted: {new Date(sub.submitted_at).toLocaleTimeString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-5 self-end sm:self-center">
                    <div className="text-right font-mono">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Score</span>
                      <span className="text-base font-black text-slate-800">
                        {!resultsVisible
                          ? "Hidden"
                          : sub.score !== null
                          ? `${sub.score} / ${sub.max_score}`
                          : "Evaluating..."}
                      </span>
                    </div>

                    <Link
                      href={`/student/submissions/${sub.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors"
                    >
                      <span>{resultsVisible ? "Inspect Result" : "View Submission"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
