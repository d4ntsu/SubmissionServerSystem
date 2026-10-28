"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock, Eye, EyeOff, Lock } from "lucide-react";

interface ExamPasswordGateProps {
  examTitle: string;
  durationMinutes: number;
  onSubmit: (password: string) => boolean;
}

export function ExamPasswordGate({
  examTitle,
  durationMinutes,
  onSubmit,
}: ExamPasswordGateProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password.trim()) {
      setError("Enter the exam password provided by your instructor.");
      return;
    }
    const valid = onSubmit(password.trim());
    if (!valid) {
      setError("Incorrect exam password. Please check with your instructor and try again.");
      setPassword("");
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-900 px-6 py-5 text-center">
          <div className="mx-auto w-11 h-11 rounded-lg bg-orange-500 text-white flex items-center justify-center shadow-sm">
            <Lock className="w-5 h-5" />
          </div>
          <span className="mt-3 block text-[10px] font-bold uppercase tracking-widest text-orange-400 font-mono">
            Password protected examination
          </span>
          <h1 className="mt-1 text-base font-bold text-white">{examTitle}</h1>
          <p className="mt-1 text-[11px] text-slate-400 font-mono flex items-center justify-center gap-1.5">
            <Clock className="w-3 h-3" /> {durationMinutes} minutes • Instructor access code required
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label
              htmlFor="exam-password"
              className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1.5"
            >
              Exam Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="exam-password"
                type={showPassword ? "text" : "password"}
                autoFocus
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                placeholder="Enter the password created by your teacher"
                className="w-full pl-9 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Verify Password & Enter Test
          </button>

          <Link
            href="/dashboard"
            className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Return to exam dashboard
          </Link>
        </form>
      </div>
    </div>
  );
}
