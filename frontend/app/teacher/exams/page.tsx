"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useSocket } from "@/lib/socket-context";
import { Exam, ExamStatus } from "@/types";
import {
  Layers,
  Plus,
  Play,
  Square,
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  ExternalLink,
  Radio,
  FileCode2,
  X,
  AlertCircle,
  HelpCircle,
  Lock,
  KeyRound,
} from "lucide-react";

export default function TeacherExamManagementPage() {
  const { exams, createExam, updateExam, setExamStatus, deleteExam } = useSocket();
  const [filter, setFilter] = useState<string>("all");

  // Modal State for Create / Edit Exam
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDuration, setFormDuration] = useState(90);
  const [formPasswordEnabled, setFormPasswordEnabled] = useState(false);
  const [formPassword, setFormPassword] = useState("");
  const [formError, setFormError] = useState("");

  const filteredExams = exams.filter((e) => {
    if (filter === "all") return true;
    return e.status === filter;
  });

  const openCreateModal = () => {
    setEditingExam(null);
    setFormTitle("");
    setFormDescription("");
    setFormDuration(90);
    setFormPasswordEnabled(false);
    setFormPassword("");
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (exam: Exam) => {
    setEditingExam(exam);
    setFormTitle(exam.title);
    setFormDescription(exam.description);
    setFormDuration(exam.duration_minutes);
    setFormPasswordEnabled(Boolean(exam.has_password));
    setFormPassword("");
    setFormError("");
    setIsModalOpen(true);
  };

  const handleSaveExam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const hasExistingPassword = Boolean(editingExam?.has_password);
    if (formPasswordEnabled && !formPassword.trim() && !hasExistingPassword) {
      setFormError("Enter an exam password or disable password protection.");
      return;
    }

    const accessPassword = formPasswordEnabled
      ? formPassword.trim() || (hasExistingPassword ? undefined : "")
      : "";

    if (editingExam) {
      updateExam(editingExam.id, {
        title: formTitle,
        description: formDescription,
        duration_minutes: Number(formDuration),
        access_password: accessPassword,
      });
    } else {
      createExam({
        title: formTitle,
        description: formDescription,
        duration_minutes: Number(formDuration),
        status: "draft",
        access_password: accessPassword || undefined,
      });
    }

    setIsModalOpen(false);
  };

  return (
    <ProtectedRoute requireTeacher={true}>
      <AppLayout>
        {/* Flat White Centralized Container over textured light gray background */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header Bar */}
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                TEACHER CURRICULUM MANAGEMENT
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                Examination & Question Lifecycle Management
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Create, edit, publish, launch (start), and conclude (end) examinations across the local network.
              </p>
            </div>

            {/* Create New Exam Action Button */}
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Examination</span>
            </button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-50 rounded border border-slate-200 font-mono">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">TOTAL EXAMS</span>
              <span className="text-xl font-black text-slate-800">{exams.length}</span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200 font-mono">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">ACTIVE (LIVE)</span>
              <span className="text-xl font-black text-emerald-600">
                {exams.filter((e) => e.status === "started").length}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200 font-mono">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">PUBLISHED</span>
              <span className="text-xl font-black text-blue-600">
                {exams.filter((e) => e.status === "published").length}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200 font-mono">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">DRAFTS</span>
              <span className="text-xl font-black text-slate-500">
                {exams.filter((e) => e.status === "draft").length}
              </span>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md text-xs font-semibold font-mono w-fit">
            {["all", "started", "published", "draft", "ended"].map((st) => (
              <button
                key={st}
                onClick={() => setFilter(st)}
                className={`px-3 py-1 rounded transition-colors uppercase text-[11px] ${
                  filter === st
                    ? "bg-white text-slate-900 shadow-xs border border-slate-200"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {st === "started" ? "Live (Started)" : st}
              </button>
            ))}
          </div>

          {/* Exams List Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] font-mono">
                  <tr>
                    <th className="py-3 px-4">Exam ID & Title</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Questions & Pts</th>
                    <th className="py-3 px-4">Lifecycle State</th>
                    <th className="py-3 px-4 text-center">Lifecycle Actions</th>
                    <th className="py-3 px-4 text-right">Settings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredExams.map((exam) => {
                    const isDraft = exam.status === "draft";
                    const isPublished = exam.status === "published";
                    const isStarted = exam.status === "started";
                    const isEnded = exam.status === "ended";

                    return (
                      <tr key={exam.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4">
                          <span className="text-[10px] font-mono font-bold text-slate-400 block">
                            EXAM #{exam.id}
                          </span>
                          <span className="font-bold text-slate-900 text-sm">
                            {exam.title}
                          </span>
                          <p className="text-slate-500 text-[11px] line-clamp-1 max-w-sm mt-0.5">
                            {exam.description}
                          </p>
                          {exam.has_password && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 font-mono">
                              <Lock className="w-2.5 h-2.5" />
                              Password protected
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                          {exam.duration_minutes} Mins
                        </td>

                        <td className="py-3 px-4 font-mono">
                          <span className="font-bold text-slate-800">{exam.questions_count || 0} Problems</span>
                          <span className="text-slate-400 block text-[11px]">{exam.total_points || 0} Total Pts</span>
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider ${
                              isStarted
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse"
                                : isPublished
                                ? "bg-blue-100 text-blue-800 border border-blue-200"
                                : isDraft
                                ? "bg-slate-100 text-slate-600 border border-slate-200"
                                : "bg-amber-100 text-amber-800 border border-amber-200"
                            }`}
                          >
                            {isStarted ? "● LIVE (STARTED)" : exam.status}
                          </span>
                        </td>

                        {/* Lifecycle Controls: Publish, Start, End */}
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                            {/* Publish action for drafts */}
                            {isDraft && (
                              <button
                                onClick={() => setExamStatus(exam.id, "published")}
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded uppercase font-mono shadow-xs transition-colors"
                                title="Publish exam to schedule"
                              >
                                Publish
                              </button>
                            )}

                            {/* Start (Go Live) action for published exams */}
                            {isPublished && (
                              <button
                                onClick={() => setExamStatus(exam.id, "started")}
                                className="px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white font-bold text-[10px] rounded uppercase font-mono shadow-xs transition-colors flex items-center gap-1"
                                title="Start exam and open code submissions"
                              >
                                <Play className="w-3 h-3 fill-white" />
                                <span>Start Exam</span>
                              </button>
                            )}

                            {/* End action for currently started exams */}
                            {isStarted && (
                              <button
                                onClick={() => setExamStatus(exam.id, "ended")}
                                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] rounded uppercase font-mono shadow-xs transition-colors flex items-center gap-1"
                                title="End exam and lock further submissions"
                              >
                                <Square className="w-3 h-3 fill-white" />
                                <span>End Exam</span>
                              </button>
                            )}

                            {/* Restart/Re-open action for ended exams */}
                            {isEnded && (
                              <button
                                onClick={() => setExamStatus(exam.id, "started")}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white font-bold text-[10px] rounded uppercase font-mono shadow-xs transition-colors"
                              >
                                Reopen
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Questions Management & Settings */}
                        <td className="py-3 px-4 text-right space-x-1.5 font-mono">
                          <Link
                            href={`/teacher/exams/${exam.id}/questions`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-sans font-bold rounded shadow-xs transition-colors"
                            title="Manage questions and test cases"
                          >
                            <FileCode2 className="w-3.5 h-3.5 text-orange-400" />
                            <span>Questions ({exam.questions_count || 0})</span>
                          </Link>

                          <button
                            onClick={() => openEditModal(exam)}
                            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
                            title="Edit details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete exam #${exam.id}?`)) {
                                deleteExam(exam.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded transition-colors"
                            title="Delete exam"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

        {/* Create / Edit Exam Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    {editingExam ? "MODIFY EXAMINATION RECORD" : "NEW EXAMINATION SETUP"}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingExam ? `Edit Exam #${editingExam.id}` : "Create Examination"}
                  </h3>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveExam} className="p-5 space-y-4 text-xs font-sans">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Exam Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. CS201 Midterm Examination"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Duration (Minutes) *
                  </label>
                  <input
                    type="number"
                    required
                    min={15}
                    max={360}
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-start gap-2">
                    <KeyRound className="w-4 h-4 text-orange-500 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-800 text-xs block">
                        Require an exam entry password
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Students must enter this password before the question window opens.
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formPasswordEnabled}
                    onChange={(e) => {
                      setFormPasswordEnabled(e.target.checked);
                      setFormError("");
                    }}
                    className="w-4 h-4 accent-orange-500 rounded"
                  />
                </div>

                {formPasswordEnabled && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                      Exam Password {editingExam?.has_password ? "(leave blank to keep current)" : "*"}
                    </label>
                    <input
                      type="password"
                      value={formPassword}
                      onChange={(e) => {
                        setFormPassword(e.target.value);
                        setFormError("");
                      }}
                      placeholder={
                        editingExam?.has_password
                          ? "Enter a new password to replace the current one"
                          : "e.g. CS201-MIDTERM"
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                    />
                  </div>
                )}

                {formError && (
                  <div className="rounded border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Description & Instructions
                  </label>
                  <textarea
                    rows={3}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Instructions, allowed libraries, topics covered..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none font-sans"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold text-xs rounded hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs"
                  >
                    {editingExam ? "Save Changes" : "Create Exam"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AppLayout>
    </ProtectedRoute>
  );
}

