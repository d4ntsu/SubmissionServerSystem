"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useSocket } from "@/lib/socket-context";
import { MOCK_EXAMS } from "@/lib/api";
import {
  Megaphone,
  Send,
  Radio,
  CheckCircle,
  Clock,
  Layers,
  ArrowRight,
} from "lucide-react";

export default function AnnouncementsWidgetPage() {
  const { announcements, postAnnouncement } = useSocket();
  const [title, setTitle] = useState("Important Exam Notice");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"urgent" | "warning" | "info">("urgent");
  const [targetExam, setTargetExam] = useState<string>("all");
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    postAnnouncement({
      title,
      message,
      priority,
      target_exam_id: targetExam === "all" ? "all" : Number(targetExam),
    });

    setMessage("");
    setIsSuccess(true);
    setTimeout(() => setIsSuccess(false), 5000);
  };

  return (
    <ProtectedRoute requireTeacher={true}>
      <AppLayout>
        {/* Flat White Centralized Container over textured light gray background */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6 max-w-4xl mx-auto">
          {/* Header */}
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                REALTIME BROADCAST SYSTEM
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                Announcements Broadcast Widget
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Pushes non-intrusive instant notifications to all active candidate exam screens.
              </p>
            </div>

            <Link
              href="/student/exams/1"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded border border-slate-200 transition-colors"
            >
              <span>Active Exam Room</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Success Notification */}
          {isSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs font-medium text-green-900 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>Broadcast transmitted successfully to all connected candidate clients!</span>
            </div>
          )}

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-1">
                  Announcement Headline
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Return Type Clarification"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-1">
                  Priority Rating
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                >
                  <option value="urgent">Urgent Alert</option>
                  <option value="warning">Warning Notice</option>
                  <option value="info">General Info</option>
                </select>
              </div>
            </div>

            {/* Simple Text Area */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-1">
                Announcement Message Body
              </label>
              <textarea
                rows={3}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your announcement to all active exam students..."
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-sans resize-none"
              />
            </div>

            {/* Prominent Orange "Broadcast" Button */}
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-6 py-2.5 rounded bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Broadcast Now</span>
              </button>
            </div>
          </form>

          {/* Read-Only Chronological Log of Previously Sent Messages Below Input */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">
                Read-Only Chronological Broadcast Log
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Total Logged: {announcements.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
              {announcements.map((ann) => (
                <div key={ann.id} className="p-4 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] font-bold font-mono uppercase px-1.5 py-0.5 rounded ${
                          ann.priority === "urgent"
                            ? "bg-red-100 text-red-800"
                            : ann.priority === "warning"
                            ? "bg-orange-100 text-orange-800"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {ann.priority}
                      </span>
                      <strong className="text-slate-800 font-bold">{ann.title}</strong>
                    </div>

                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(ann.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="text-slate-600 text-[11px] leading-relaxed pl-1">
                    {ann.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
