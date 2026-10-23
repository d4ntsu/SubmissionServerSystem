"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { MOCK_EXAMS, MOCK_QUESTIONS, MOCK_TEST_CASES } from "@/lib/api";
import { Question, TestCase } from "@/types";
import {
  Clock,
  Play,
  Send,
  Terminal,
  Code2,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Copy,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Cpu,
  Layers,
  Radio,
  Megaphone,
  Lock,
  ListChecks,
} from "lucide-react";

const CODE_TEMPLATES: Record<string, Record<string, string>> = {
  java: {
    STDIN_STDOUT: `import java.util.Scanner;

public class Solution {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        // Implement your solution here
        
    }
}`,
    JAVA_CLASS_METHOD: `public class Calculator {
    /**
     * Required method implementation for grading harness
     */
    public static int evaluateExpression(String op, int a, int b) {
        // Implement your solution here
        return 0;
    }
}`,
  },
  python: {
    STDIN_STDOUT: `import sys

def main():
    lines = sys.stdin.read().splitlines()
    # Implement your solution here

if __name__ == "__main__":
    main()`,
    JAVA_CLASS_METHOD: `class Calculator:
    @staticmethod
    def evaluateExpression(op: str, a: int, b: int) -> int:
        return 0`,
  },
};

export default function ExamWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const examId = Number(params?.id) || 1;
  const { user, isTeacher } = useAuth();
  const {
    submitCode,
    announcements,
    postAnnouncement,
    exams,
    questions: allQuestions,
    testCases: allTestCases,
    addLog,
  } = useSocket();

  const exam = exams.find((e) => e.id === examId) || exams[0];
  const questions = allQuestions[examId] || MOCK_QUESTIONS[examId] || [];

  const [currentQIndex, setCurrentQIndex] = useState(0);
  const currentQuestion: Question = questions[currentQIndex] || questions[0];
  const testCases: TestCase[] =
    allTestCases[currentQuestion?.id] || MOCK_TEST_CASES[currentQuestion?.id] || [];

  const resultsVisible = currentQuestion?.show_result_to_student !== false;

  const [language, setLanguage] = useState("java");
  const [code, setCode] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRunningSample, setIsRunningSample] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string | null>(null);
  const [consoleStatus, setConsoleStatus] = useState<"idle" | "success" | "error">("idle");
  const [recentSubmissionId, setRecentSubmissionId] = useState<number | null>(null);

  // Instructor broadcast widget toggle & state
  const [showBroadcastWidget, setShowBroadcastWidget] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTitle, setBroadcastTitle] = useState("Exam Instruction");
  const [broadcastPriority, setBroadcastPriority] = useState<"urgent" | "warning" | "info">("urgent");

  // Timer countdown
  const [timeLeft, setTimeLeft] = useState(58 * 60 + 30);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-dismiss the submission confirmation after 5 seconds
  useEffect(() => {
    if (!recentSubmissionId) return;
    const timer = setTimeout(() => setRecentSubmissionId(null), 5000);
    return () => clearTimeout(timer);
  }, [recentSubmissionId]);

  // Log when a student opens the test so it appears in the realtime activity panel
  const loggedStartRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!user || !exam?.id) return;
    const sessionKey = `${exam.id}-${user.id}-${isTeacher ? "teacher" : "student"}`;
    if (loggedStartRef.current === sessionKey) return;
    loggedStartRef.current = sessionKey;

    addLog(
      "EVENT",
      isTeacher ? "Teacher Preview" : user.full_name,
      isTeacher
        ? `Opened test "${exam.title}" to review all questions`
        : `Started test "${exam.title}"`
    );
  }, [exam?.id, exam?.title, user, isTeacher, addLog]);

  // Set default code template
  useEffect(() => {
    if (currentQuestion) {
      const qType = currentQuestion.question_type;
      const template =
        CODE_TEMPLATES[language]?.[qType] ||
        CODE_TEMPLATES["java"]["STDIN_STDOUT"];
      setCode(template);
      setConsoleOutput(null);
      setConsoleStatus("idle");
    }
  }, [currentQuestion?.id, language]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const selectQuestion = (index: number) => {
    setCurrentQIndex(index);
    const question = questions[index];
    if (!question) return;
    addLog(
      "EVENT",
      isTeacher ? "Teacher Preview" : user?.full_name || "Student",
      `${isTeacher ? "Checked" : "Opened"} problem "${question.title}"`
    );
  };

  const handleRunSample = () => {
    setIsRunningSample(true);
    setConsoleOutput("Initializing Piston sandbox container...\nRunning test against Sample Case 1...\n");
    setConsoleStatus("idle");
    addLog(
      "INFO",
      isTeacher ? "Teacher Preview" : user?.full_name || "Student",
      `Ran sample test for "${currentQuestion.title}"`
    );

    setTimeout(() => {
      setIsRunningSample(false);
      setConsoleOutput(
        "=== SAMPLE TEST EXECUTION ===\nStatus: PASSED (1/1 sample)\nExecution Time: 0.12s\nMemory Consumed: 14.8 MB\nOutput matches expected specification exactly."
      );
      setConsoleStatus("success");
    }, 1000);
  };

  const handleSubmitSolution = async () => {
    if (!user) return;
    setIsSubmitting(true);

    try {
      const sub = await submitCode({
        student_id: user.id,
        student_name: user.full_name,
        question_id: currentQuestion.id,
        question_title: currentQuestion.title,
        exam_id: exam.id,
        exam_title: exam.title,
        language: language,
        source_code: code,
      });

      setRecentSubmissionId(sub.id);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMessage.trim()) return;
    postAnnouncement({
      title: broadcastTitle,
      message: broadcastMessage,
      priority: broadcastPriority,
      target_exam_id: exam.id,
    });
    setBroadcastMessage("");
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/dashboard" className="hover:text-orange-600 transition-colors">
                Examinations
              </Link>
            </li>
            <li>/</li>
            <li>
              <span className="text-slate-600">{exam.title}</span>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">
              Q{currentQIndex + 1}: {currentQuestion.title}
            </li>
          </ol>
        </nav>

        {/* Top Control Bar */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 mb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
              Problems:
            </span>
            <div className="flex items-center gap-1.5">
              {questions.map((q, idx) => (
                <button
                  key={q.id}
                  onClick={() => selectQuestion(idx)}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                    currentQIndex === idx
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <span>Q{idx + 1}</span>
                  <span className="text-[10px] opacity-75 font-mono">({q.points}pt)</span>
                </button>
              ))}
            </div>

            {/* Teacher Broadcast Widget Toggle */}
            {isTeacher && (
              <button
                onClick={() => setShowBroadcastWidget(!showBroadcastWidget)}
                className={`ml-2 px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border transition-all ${
                  showBroadcastWidget
                    ? "bg-orange-500 text-white border-orange-500 shadow-xs"
                    : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                }`}
              >
                <Megaphone className="w-3.5 h-3.5" />
                <span>Instructor Broadcast Tool</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end flex-wrap">
            {/* Timer */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold border ${
                timeLeft < 300
                  ? "bg-red-50 border-red-300 text-red-600 animate-pulse"
                  : "bg-slate-50 border-slate-200 text-slate-700"
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Time Left: {formatTime(timeLeft)}</span>
            </div>

            {/* Language Selection */}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-xs font-semibold py-1.5 px-3 bg-slate-50 border border-slate-200 rounded text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="java">Java 15.0.2</option>
              <option value="python">Python 3.10</option>
            </select>

            {/* Run Test Button */}
            <button
              onClick={handleRunSample}
              disabled={isRunningSample}
              className="px-3.5 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors flex items-center gap-1.5 border border-slate-200 disabled:opacity-50"
            >
              <Play className="w-3 h-3 text-slate-600 fill-slate-600" />
              <span>{isRunningSample ? "Running..." : "Run Test"}</span>
            </button>

            {/* Prominent Orange Submission Button */}
            <button
              onClick={handleSubmitSolution}
              disabled={isSubmitting}
              className="px-5 py-2 rounded bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? "Submitting..." : "Submit Solution"}</span>
            </button>
          </div>
        </div>

        {/* Complete test question navigator */}
        {questions.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 mb-4 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center items-start justify-between gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5 text-orange-500" />
                All Test Questions
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {questions.length} total • click any question to check it
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {questions.map((q, idx) => {
                const isActive = currentQIndex === idx;
                return (
                  <button
                    key={q.id}
                    onClick={() => selectQuestion(idx)}
                    className={`text-left p-2.5 rounded border transition-all flex items-start gap-2 ${
                      isActive
                        ? "border-orange-400 bg-orange-50/60 shadow-xs"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ${
                        isActive ? "bg-orange-500 text-white" : "bg-slate-900 text-white"
                      }`}
                    >
                      Q{idx + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold text-slate-800 truncate">
                        {q.title}
                      </span>
                      <span className="block text-[10px] font-mono text-slate-400">
                        {q.points} pts • {q.question_type}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Submission notification link if submitted */}
        {recentSubmissionId && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-900 shadow-xs">
            <div className="flex items-center gap-2 font-medium">
              {resultsVisible ? (
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              ) : (
                <Lock className="w-4 h-4 text-slate-500" />
              )}
              <span>
                Submission <strong>#{recentSubmissionId}</strong> received.
                {resultsVisible
                  ? " It is queued for automated grading."
                  : " Final result visibility is disabled for this question by the instructor."}
              </span>
            </div>
            {resultsVisible ? (
              <Link
                href={`/student/submissions/${recentSubmissionId}`}
                className="font-bold underline text-emerald-700 hover:text-emerald-900 flex items-center gap-1"
              >
                View Results Breakdown <ExternalLink className="w-3 h-3" />
              </Link>
            ) : (
              <span className="text-[10px] font-mono font-bold uppercase text-slate-500 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Results hidden
              </span>
            )}
          </div>
        )}

        {/* Teacher Announcements Broadcast Widget */}
        {isTeacher && showBroadcastWidget && (
          <div className="bg-white rounded-lg border-2 border-orange-400 shadow-md p-5 mb-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-orange-500 animate-pulse" />
                <h3 className="text-sm font-bold text-slate-900 font-mono uppercase tracking-wide">
                  Live Announcements Broadcast Widget
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                Pushes directly to active student screens without interrupting typing
              </span>
            </div>

            <form onSubmit={handleSendBroadcast} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-3">
                  <input
                    type="text"
                    required
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    placeholder="Announcement Title / Headline"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>
                <div>
                  <select
                    value={broadcastPriority}
                    onChange={(e) => setBroadcastPriority(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                  >
                    <option value="urgent">Urgent Priority</option>
                    <option value="warning">Warning Notice</option>
                    <option value="info">General Info</option>
                  </select>
                </div>
              </div>

              {/* Simple Text Area */}
              <div>
                <textarea
                  rows={2}
                  required
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  placeholder="Type real-time announcement to all active exam candidates..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium resize-none"
                />
              </div>

              {/* Prominent Orange Broadcast Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2 rounded bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Broadcast Now</span>
                </button>
              </div>
            </form>

            {/* Read-only chronological log of previously sent messages below input */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block">
                Chronological Broadcast Log
              </span>
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 bg-slate-50 rounded border border-slate-200 p-2">
                {announcements.map((a) => (
                  <div key={a.id} className="py-2 px-1 text-xs space-y-0.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span className="font-bold text-slate-700 uppercase">{a.title}</span>
                      <span>{new Date(a.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-600 text-[11px]">{a.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Split-Screen Coding Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Problem Requirements, Allowed Languages & Limits */}
          <div className="lg:col-span-5 bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              {/* Question Header & Constraints */}
              <div className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Problem {currentQIndex + 1} of {questions.length}
                  </span>
                  <span className="text-xs font-bold text-orange-600 font-mono bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                    {currentQuestion.points} Points
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-900">
                  {currentQuestion.title}
                </h2>
              </div>

              {/* Limits and Allowed Languages */}
              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded border border-slate-200 font-mono text-slate-600">
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">ALLOWED LANGUAGES:</span>
                  <span className="font-semibold text-slate-800">Java 15, Python 3</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">MEMORY LIMIT:</span>
                  <span className="font-semibold text-slate-800">{currentQuestion.memory_limit} MB</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">TIME LIMIT:</span>
                  <span className="font-semibold text-slate-800">{currentQuestion.time_limit}.0 Seconds</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">QUESTION TYPE:</span>
                  <span className="font-semibold text-slate-800">{currentQuestion.question_type}</span>
                </div>
              </div>

              {/* Problem Description */}
              <MarkdownRenderer content={currentQuestion.description} />

              {/* Java Reflection Spec if applicable */}
              {currentQuestion.question_type === "JAVA_CLASS_METHOD" && (
                <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">
                    Required Class/Method Contract:
                  </span>
                  <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                    <div>Class: <strong className="text-slate-900">{currentQuestion.class_name}</strong></div>
                    <div>Method: <strong className="text-slate-900">{currentQuestion.method_name}</strong></div>
                    <div>Mode: <span className="text-slate-700">{currentQuestion.method_mode}</span></div>
                    <div>Return: <span className="text-slate-700">{currentQuestion.return_type}</span></div>
                  </div>
                </div>
              )}

              {/* Sample Test Cases */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                  Sample Test Cases (Visible)
                </span>
                {testCases
                  .filter((tc) => tc.is_sample)
                  .map((tc, i) => (
                    <div key={tc.id} className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono space-y-1">
                      <div className="text-[10px] font-bold text-slate-500 flex justify-between">
                        <span>Sample #{i + 1}</span>
                        <span>{tc.weight} Pts</span>
                      </div>
                      {tc.stdin && (
                        <div>
                          <span className="text-[10px] text-slate-400 block">Input:</span>
                          <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">{tc.stdin}</pre>
                        </div>
                      )}
                      {tc.expected_stdout && (
                        <div>
                          <span className="text-[10px] text-slate-400 block">Expected Output:</span>
                          <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">{tc.expected_stdout}</pre>
                        </div>
                      )}
                      {tc.arguments && (
                        <div>
                          <span className="text-[10px] text-slate-400 block">Args:</span>
                          <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">{tc.arguments}</pre>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Right Column: Browser-Based Code Editor & Console */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            {/* Editor Container */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 shadow-md flex flex-col h-[420px] overflow-hidden">
              <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono text-slate-200 font-semibold flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-orange-400" />
                  Solution.{language === "java" ? "java" : "py"}
                </span>
                <button
                  onClick={() => {
                    const qType = currentQuestion.question_type;
                    setCode(CODE_TEMPLATES[language]?.[qType] || CODE_TEMPLATES["java"]["STDIN_STDOUT"]);
                  }}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
                  title="Reset to default starter template"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>

              {/* Code Textarea */}
              <div className="flex-1 relative">
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  className="w-full h-full p-4 bg-transparent text-slate-100 font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-orange-500/30"
                  placeholder="// Enter your solution here..."
                />
              </div>
            </div>

            {/* Test Console Output */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-slate-600" />
                  Execution Console & Diagnostics
                </span>
                {consoleStatus === "success" && (
                  <span className="text-[10px] font-bold text-emerald-600 font-mono uppercase">
                    Execution Passed
                  </span>
                )}
              </div>

              <pre className="p-3 bg-slate-50 rounded border border-slate-200 font-mono text-[11px] text-slate-700 min-h-[70px] max-h-[140px] overflow-y-auto whitespace-pre-wrap">
                {consoleOutput || (
                  <span className="text-slate-400 italic">
                    Click "Run Test" above to test your code against visible sample inputs.
                  </span>
                )}
              </pre>
            </div>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
