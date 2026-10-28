"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { ExamPasswordGate } from "@/components/exam/ExamPasswordGate";
import { ExamWindowGuard } from "@/components/exam/ExamWindowGuard";
import { ExamVerificationModal } from "@/components/exam/ExamVerificationModal";
import { QuestionSidebar } from "@/components/exam/QuestionSidebar";
import { SubmitReviewModal } from "@/components/exam/SubmitReviewModal";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { MOCK_QUESTIONS, MOCK_TEST_CASES } from "@/lib/api";
import { gradeSampleTests, hasAnswer } from "@/lib/grading";
import { CodingLanguage, Question, QuestionType, TestCase } from "@/types";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Code2,
  ExternalLink,
  FileWarning,
  FlaskConical,
  Megaphone,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Terminal,
} from "lucide-react";

const CODE_TEMPLATES: Record<CodingLanguage, Record<QuestionType, string>> = {
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
    pass

if __name__ == "__main__":
    main()`,
    JAVA_CLASS_METHOD: `class Calculator:
    @staticmethod
    def evaluateExpression(op: str, a: int, b: int) -> int:
        # Implement your solution here
        return 0`,
  },
};

function templateFor(question: Question): string {
  return (
    CODE_TEMPLATES[question.language]?.[question.question_type] ||
    CODE_TEMPLATES.java.STDIN_STDOUT
  );
}

function isQuestionConfigured(question: Question, cases: TestCase[]): boolean {
  if (!cases.length) return false;
  return cases.every((testCase) =>
    question.question_type === "JAVA_CLASS_METHOD"
      ? Boolean(testCase.expected_return?.trim())
      : Boolean(testCase.expected_stdout?.trim())
  );
}

export default function ExamWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const routeExamId = Number(params?.id) || 1;
  const { user, isTeacher, isStudent } = useAuth();
  const {
    submitCode,
    announcements,
    postAnnouncement,
    exams,
    questions: allQuestions,
    testCases: allTestCases,
    addLog,
    hasExamPassword,
    verifyExamPassword,
    examVerifications,
  } = useSocket();

  const [selectedExamId, setSelectedExamId] = useState(routeExamId);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [interactedIds, setInteractedIds] = useState<Record<number, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [isSubmittingExam, setIsSubmittingExam] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const [accessGranted, setAccessGranted] = useState(false);
  const [isRunningSample, setIsRunningSample] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string | null>(null);
  const [consoleStatus, setConsoleStatus] = useState<"idle" | "success" | "error">("idle");
  const [showBroadcastWidget, setShowBroadcastWidget] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTitle, setBroadcastTitle] = useState("Exam Instruction");
  const [broadcastPriority, setBroadcastPriority] = useState<"urgent" | "warning" | "info">(
    "urgent"
  );
  const [timeLeft, setTimeLeft] = useState(90 * 60);
  const [verificationOpen, setVerificationOpen] = useState(false);

  useEffect(() => {
    setSelectedExamId(routeExamId);
  }, [routeExamId]);

  const exam = exams.find((item) => item.id === selectedExamId);
  const questions = allQuestions[selectedExamId] || MOCK_QUESTIONS[selectedExamId] || [];

  const currentQuestion = questions[currentQIndex] || questions[0];
  const currentCode = currentQuestion ? answers[currentQuestion.id] || "" : "";
  const questionTestCases = currentQuestion ? allTestCases[currentQuestion.id] || [] : [];

  useEffect(() => {
    if (!exam) return;
    if (isTeacher) {
      setAccessGranted(true);
      return;
    }
    if (!hasExamPassword(exam.id)) {
      setAccessGranted(true);
      return;
    }
    const key = `exam_unlocked_${exam.id}_${user?.id ?? "anonymous"}`;
    setAccessGranted(window.sessionStorage.getItem(key) === "1");
  }, [exam, hasExamPassword, isTeacher, user?.id]);

  useEffect(() => {
    if (!questions.length) return;
    setAnswers((previous) => {
      let changed = false;
      const next = { ...previous };
      questions.forEach((question) => {
        if (next[question.id] === undefined) {
          next[question.id] = templateFor(question);
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [questions]);

  useEffect(() => {
    setTimeLeft((exam?.duration_minutes || 90) * 60);
  }, [exam?.id, exam?.duration_minutes]);

  useEffect(() => {
    if (submitted || !accessGranted) return;
    const timer = setInterval(() => {
      setTimeLeft((previous) => (previous > 0 ? previous - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [submitted, accessGranted]);

  const loggedStartRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!user || !exam?.id || !accessGranted) return;
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
  }, [exam?.id, exam?.title, user, isTeacher, addLog, accessGranted]);

  const answeredIds = useMemo(
    () =>
      questions
        .filter(
          (question) =>
            Boolean(interactedIds[question.id]) || hasAnswer(answers[question.id] || "")
        )
        .map((question) => question.id),
    [answers, questions, interactedIds]
  );

  const answeredSet = useMemo(() => new Set(answeredIds), [answeredIds]);
  const isAnswered = (question: Question) => answeredSet.has(question.id);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  };

  const selectQuestion = (index: number) => {
    setCurrentQIndex(index);
    setConsoleOutput(null);
    setConsoleStatus("idle");
    setSidebarOpen(window.innerWidth >= 1280);
    const question = questions[index];
    if (!question) return;
    addLog(
      "EVENT",
      isTeacher ? "Teacher Preview" : user?.full_name || "Student",
      `${isTeacher ? "Checked" : "Opened"} problem "${question.title}"`
    );
  };

  const handleSelectExam = (id: number) => {
    if (!isTeacher || id === selectedExamId) return;
    const nextExam = exams.find((item) => item.id === id);
    setSelectedExamId(id);
    setCurrentQIndex(0);
    setConsoleOutput(null);
    setConsoleStatus("idle");
    setSubmitted(false);
    setSubmittedCount(0);
    setSubmitError("");
    setReviewOpen(false);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/student/exams/${id}`);
    }
    addLog(
      "EVENT",
      "Teacher Preview",
      `Opened test "${nextExam?.title ?? `Examination #${id}`}" to review all questions`
    );
  };

  const markQuestionInteracted = () => {
    if (!currentQuestion) return;
    setInteractedIds((previous) =>
      previous[currentQuestion.id] ? previous : { ...previous, [currentQuestion.id]: true }
    );
  };

  const updateCode = (value: string) => {
    if (!currentQuestion) return;
    markQuestionInteracted();
    setAnswers((previous) => ({ ...previous, [currentQuestion.id]: value }));
  };

  const handleCodeKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const editKeys = ["Backspace", "Delete", "Enter", "Tab"];
    if (event.key.length === 1 || editKeys.includes(event.key)) {
      markQuestionInteracted();
    }
  };

  const handleUnlock = (password: string) => {
    if (!exam) return false;
    const valid = verifyExamPassword(exam.id, password);
    if (!valid) {
      addLog(
        "WARN",
        user?.full_name || "Student",
        `Entered an incorrect exam password for "${exam.title}"`
      );
      return false;
    }
    const key = `exam_unlocked_${exam.id}_${user?.id ?? "anonymous"}`;
    window.sessionStorage.setItem(key, "1");
    setAccessGranted(true);
    addLog(
      "EVENT",
      user?.full_name || "Student",
      `Entered the correct exam password for "${exam.title}"`
    );
    return true;
  };

  const handleRunSample = () => {
    if (!currentQuestion) return;
    setIsRunningSample(true);
    setConsoleOutput("Evaluating visible sample test cases...\n");
    setConsoleStatus("idle");
    addLog(
      "INFO",
      isTeacher ? "Teacher Preview" : user?.full_name || "Student",
      `Ran sample tests for "${currentQuestion.title}"`
    );

    setTimeout(() => {
      const sampleCases = questionTestCases.filter((testCase) => testCase.is_sample);
      const outcome = gradeSampleTests(currentQuestion, questionTestCases, currentCode);

      if (!sampleCases.length) {
        setConsoleOutput(
          "NO SAMPLE TESTS CONFIGURED\nThis question has no visible sample test cases in the database."
        );
        setConsoleStatus("error");
      } else if (outcome.status === "error") {
        setConsoleOutput(`GRADING ERROR\n${outcome.error_summary}`);
        setConsoleStatus("error");
      } else {
        const lines = outcome.test_results.map((result, index) => {
          const verdict = result.passed === 1 ? "PASS" : "FAIL";
          const expected = result.expected_output || "(missing expected answer)";
          const actual =
            result.passed === 1
              ? expected
              : result.message || "Wrong answer: no score awarded";
          return `Sample #${index + 1}: ${verdict}\n  Expected: ${expected}\n  Actual:   ${actual}`;
        });
        const passed = outcome.test_results.filter((result) => result.passed === 1).length;
        setConsoleOutput(
          `=== SAMPLE TEST EXECUTION ===\nResult: ${passed}/${outcome.test_results.length} sample tests passed\n\n${lines.join(
            "\n\n"
          )}\n\nOnly passing test cases earn points during final grading.`
        );
        setConsoleStatus(passed === outcome.test_results.length ? "success" : "error");
      }
      setIsRunningSample(false);
    }, 700);
  };

  const handleResetCode = () => {
    if (!currentQuestion) return;
    updateCode(templateFor(currentQuestion));
    setConsoleOutput(null);
    setConsoleStatus("idle");
  };

  const handleConfirmSubmit = async () => {
    if (!user || !exam) return;
    setIsSubmittingExam(true);
    setSubmitError("");
    const toSubmit = questions;

    try {
      for (const question of toSubmit) {
        await submitCode({
          student_id: user.id,
          student_name: user.full_name,
          question_id: question.id,
          question_title: question.title,
          exam_id: exam.id,
          exam_title: exam.title,
          language: question.language,
          source_code: answers[question.id] ?? templateFor(question),
        });
      }
      setSubmittedCount(toSubmit.length);
      setReviewOpen(false);
      setSubmitted(true);
      if (typeof document !== "undefined" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
      addLog(
        "SUBMISSION",
        user.full_name,
        `Confirmed final submission of test "${exam.title}" (${toSubmit.length} question${
          toSubmit.length === 1 ? "" : "s"
        } submitted for grading)`
      );
      setTimeout(() => {
        router.push(`/student/results/${exam.id}`);
      }, 2600);
    } catch (error) {
      console.error(error);
      setSubmitError("The test could not be submitted. Please try again.");
    } finally {
      setIsSubmittingExam(false);
    }
  };

  const handleSendBroadcast = (event: React.FormEvent) => {
    event.preventDefault();
    if (!broadcastMessage.trim() || !exam) return;
    postAnnouncement({
      title: broadcastTitle,
      message: broadcastMessage,
      priority: broadcastPriority,
      target_exam_id: exam.id,
    });
    setBroadcastMessage("");
  };

  if (!exam) {
    return (
      <ProtectedRoute>
        <AppLayout hideNavbar={isStudent}>
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500">
            This examination could not be found.
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  if (!accessGranted) {
    return (
      <ProtectedRoute>
        <AppLayout hideNavbar={isStudent}>
          <ExamPasswordGate
            examTitle={exam.title}
            durationMinutes={exam.duration_minutes}
            onSubmit={handleUnlock}
          />
        </AppLayout>
      </ProtectedRoute>
    );
  }

  if (submitted) {
    return (
      <ProtectedRoute>
        <AppLayout hideNavbar={isStudent}>
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 font-mono">
                  Test submitted
                </span>
                <h1 className="text-lg font-bold text-slate-900 mt-1">{exam.title}</h1>
                <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                  {submittedCount} question{submittedCount === 1 ? "" : "s"} were sent for grading.
                  {(() => {
                    const unanswered = questions.filter(
                      (question) => !isAnswered(question)
                    ).length;
                    if (unanswered === 0) return " You will be redirected to your test result shortly.";
                    return ` ${unanswered} unanswered question${
                      unanswered === 1 ? "" : "s"
                    } will be graded from the saved code and may receive 0 points. You will be redirected to your test result shortly.`;
                  })()}
                </p>
              </div>
              <Link
                href={`/student/results/${exam.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs transition-colors"
              >
                View Test Result
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <p className="text-[10px] text-slate-400 font-mono">
                Do not close this window until the redirect completes.
              </p>
            </div>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  if (!currentQuestion) {
    return (
      <ProtectedRoute>
        <AppLayout hideNavbar={isStudent}>
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-2">
            <FileWarning className="w-8 h-8 text-amber-500 mx-auto" />
            <h1 className="text-sm font-bold text-slate-800">No questions configured</h1>
            <p className="text-xs text-slate-500">
              This examination does not contain any questions in the database yet.
            </p>
            {isTeacher && (
              <div className="flex items-center justify-center gap-2 pt-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Test another exam
                </label>
                <select
                  value={selectedExamId}
                  onChange={(event) => handleSelectExam(Number(event.target.value))}
                  className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono max-w-xs"
                >
                  {exams.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.id} — {item.title} ({item.status})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Link
              href={isTeacher ? "/teacher/exams" : "/dashboard"}
              className="text-xs font-bold text-orange-600 hover:underline"
            >
              {isTeacher ? "Return to exam management" : "Return to exam dashboard"}
            </Link>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  const resultsVisible = currentQuestion.show_result_to_student !== false;
  const questionConfigured = isQuestionConfigured(currentQuestion, questionTestCases);
  const languageLabel = currentQuestion.language === "java" ? "Java 15" : "Python 3.10";

  return (
    <ProtectedRoute>
      <AppLayout hideNavbar={isStudent}>
        {!isTeacher && (
          <ExamWindowGuard
            examTitle={exam.title}
            onViolation={(count) =>
              addLog(
                "WARN",
                user?.full_name || "Student",
                `Left the exam window during "${exam.title}" (warning ${count})`
              )
            }
          />
        )}

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

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 mb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border transition-all ${
                sidebarOpen
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
              }`}
              title={sidebarOpen ? "Hide question navigator" : "Show question navigator"}
            >
              {sidebarOpen ? (
                <PanelRightClose className="w-3.5 h-3.5" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5" />
              )}
              <span>{sidebarOpen ? "Hide Questions" : "Show Questions"}</span>
            </button>

            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
              {answeredIds.length}/{questions.length} answered
            </span>

            {isTeacher && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Exam
                </label>
                <select
                  value={selectedExamId}
                  onChange={(event) => handleSelectExam(Number(event.target.value))}
                  className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono max-w-[18rem]"
                  title="Choose which exam to test"
                >
                  {exams.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.id} — {item.title} ({item.status})
                    </option>
                  ))}
                </select>

                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Question
                </label>
                <select
                  value={currentQIndex}
                  onChange={(event) => selectQuestion(Number(event.target.value))}
                  disabled={questions.length === 0}
                  className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono max-w-[18rem] disabled:opacity-50"
                  title="Choose which question to test"
                >
                  {questions.map((question, index) => (
                    <option key={question.id} value={index}>
                      Q{index + 1} — {question.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isTeacher && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider font-mono">
                <ShieldCheck className="w-3 h-3" />
                Teacher preview
              </span>
            )}

            {isTeacher && (
              <button
                type="button"
                onClick={() => setVerificationOpen(true)}
                className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border transition-all ${
                  examVerifications[exam.id]?.passed
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                    : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                }`}
                title="Run a reference attempt and verify the exam result before opening it to students"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>
                  {examVerifications[exam.id]?.passed ? "Exam Verified" : "Test Exam"}
                </span>
              </button>
            )}

            {isTeacher && (
              <button
                type="button"
                onClick={() => setShowBroadcastWidget(!showBroadcastWidget)}
                className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border transition-all ${
                  showBroadcastWidget
                    ? "bg-orange-500 text-white border-orange-500 shadow-xs"
                    : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                }`}
              >
                <Megaphone className="w-3.5 h-3.5" />
                <span>Broadcast Tool</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
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

            <button
              type="button"
              onClick={handleRunSample}
              disabled={isRunningSample}
              className="px-3.5 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors flex items-center gap-1.5 border border-slate-200 disabled:opacity-50"
            >
              <Play className="w-3 h-3 text-slate-600 fill-slate-600" />
              <span>{isRunningSample ? "Running..." : "Run Sample"}</span>
            </button>

            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              disabled={isSubmittingExam}
              className="px-5 py-2 rounded bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Test</span>
            </button>
          </div>
        </div>

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
                    onChange={(event) => setBroadcastTitle(event.target.value)}
                    placeholder="Announcement Title / Headline"
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>
                <div>
                  <select
                    value={broadcastPriority}
                    onChange={(event) =>
                      setBroadcastPriority(event.target.value as "urgent" | "warning" | "info")
                    }
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                  >
                    <option value="urgent">Urgent Priority</option>
                    <option value="warning">Warning Notice</option>
                    <option value="info">General Info</option>
                  </select>
                </div>
              </div>

              <div>
                <textarea
                  rows={2}
                  required
                  value={broadcastMessage}
                  onChange={(event) => setBroadcastMessage(event.target.value)}
                  placeholder="Type real-time announcement to all active exam candidates..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium resize-none"
                />
              </div>

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

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block">
                Chronological Broadcast Log
              </span>
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 bg-slate-50 rounded border border-slate-200 p-2">
                {announcements.map((announcement) => (
                  <div key={announcement.id} className="py-2 px-1 text-xs space-y-0.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span className="font-bold text-slate-700 uppercase">
                        {announcement.title}
                      </span>
                      <span>{new Date(announcement.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-600 text-[11px]">{announcement.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {submittedCount > 0 && !submitted && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 shadow-xs">
            Submission received. Results are being calculated; open your test result to inspect
            the question score breakdown.
          </div>
        )}

        {submitError && (
          <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 shadow-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {submitError}
          </div>
        )}

        {!questionConfigured && (
          <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 shadow-xs flex items-start gap-2">
            <FileWarning className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong className="block">This question is missing grading answers.</strong>
              <span>
                No test cases or expected answers were found in the database. Submissions for this
                question will be reported as a grading error and will not receive a score.
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 w-full space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                        Problem {currentQIndex + 1} of {questions.length}
                      </span>
                      <span className="text-xs font-bold text-orange-600 font-mono bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                        {currentQuestion.points} Points
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{currentQuestion.title}</h2>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded border border-slate-200 font-mono text-slate-600">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">
                        INSTRUCTOR-SELECTED LANGUAGE:
                      </span>
                      <span className="font-semibold text-slate-800">{languageLabel}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">TIME LIMIT:</span>
                      <span className="font-semibold text-slate-800">
                        {currentQuestion.time_limit}.0 Seconds
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">
                        QUESTION TYPE:
                      </span>
                      <span className="font-semibold text-slate-800">
                        {currentQuestion.question_type}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">
                        RESULT VISIBILITY:
                      </span>
                      <span className="font-semibold text-slate-800">
                        {resultsVisible ? "Visible to student" : "Hidden by instructor"}
                      </span>
                    </div>
                  </div>

                  <MarkdownRenderer content={currentQuestion.description} />

                  {currentQuestion.question_type === "JAVA_CLASS_METHOD" && (
                    <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">
                        Required Class/Method Contract:
                      </span>
                      <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                        <div>
                          Class:{" "}
                          <strong className="text-slate-900">{currentQuestion.class_name}</strong>
                        </div>
                        <div>
                          Method:{" "}
                          <strong className="text-slate-900">{currentQuestion.method_name}</strong>
                        </div>
                        <div>
                          Mode: <span className="text-slate-700">{currentQuestion.method_mode}</span>
                        </div>
                        <div>
                          Return:{" "}
                          <span className="text-slate-700">{currentQuestion.return_type}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                      Sample Test Cases (Visible)
                    </span>
                    {questionTestCases.filter((testCase) => testCase.is_sample).length === 0 && (
                      <p className="text-[11px] text-slate-400 italic">
                        No sample test cases were provided for this question.
                      </p>
                    )}
                    {questionTestCases
                      .filter((testCase) => testCase.is_sample)
                      .map((testCase, index) => (
                        <div
                          key={testCase.id}
                          className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono space-y-1"
                        >
                          <div className="text-[10px] font-bold text-slate-500 flex justify-between">
                            <span>Sample #{index + 1}</span>
                            <span>{testCase.weight} Pts</span>
                          </div>
                          {testCase.stdin && (
                            <div>
                              <span className="text-[10px] text-slate-400 block">Input:</span>
                              <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">
                                {testCase.stdin}
                              </pre>
                            </div>
                          )}
                          {testCase.expected_stdout && (
                            <div>
                              <span className="text-[10px] text-slate-400 block">
                                Expected Output:
                              </span>
                              <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">
                                {testCase.expected_stdout}
                              </pre>
                            </div>
                          )}
                          {testCase.arguments && (
                            <div>
                              <span className="text-[10px] text-slate-400 block">Args:</span>
                              <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">
                                {testCase.arguments}
                              </pre>
                            </div>
                          )}
                          {testCase.expected_return && (
                            <div>
                              <span className="text-[10px] text-slate-400 block">
                                Expected Return:
                              </span>
                              <pre className="p-1.5 bg-white border border-slate-200 rounded text-[11px]">
                                {testCase.expected_return}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col space-y-4">
                <div className="bg-slate-900 rounded-lg border border-slate-800 shadow-md flex flex-col h-[420px] overflow-hidden">
                  <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                    <span className="font-mono text-slate-200 font-semibold flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-orange-400" />
                      Solution.{currentQuestion.language === "java" ? "java" : "py"}
                      <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">
                        {languageLabel} selected by instructor
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={handleResetCode}
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
                      title="Reset to the instructor-provided starter template"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </div>

                  <div className="flex-1 relative">
                    <textarea
                      value={currentCode}
                      onChange={(event) => updateCode(event.target.value)}
                      onKeyDown={handleCodeKeyDown}
                      spellCheck={false}
                      className="w-full h-full p-4 bg-transparent text-slate-100 font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-orange-500/30"
                      placeholder="// Enter your solution here..."
                    />
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-slate-600" />
                      Execution Console & Diagnostics
                    </span>
                    {consoleStatus === "success" && (
                      <span className="text-[10px] font-bold text-emerald-600 font-mono uppercase">
                        Sample Tests Passed
                      </span>
                    )}
                    {consoleStatus === "error" && (
                      <span className="text-[10px] font-bold text-red-600 font-mono uppercase">
                        Check Sample Output
                      </span>
                    )}
                  </div>

                  <pre className="p-3 bg-slate-50 rounded border border-slate-200 font-mono text-[11px] text-slate-700 min-h-[70px] max-h-[160px] overflow-y-auto whitespace-pre-wrap">
                    {consoleOutput || (
                      <span className="text-slate-400 italic">
                        Click &quot;Run Sample&quot; to test your saved answer against the visible
                        sample cases. Only passing test cases receive points.
                      </span>
                    )}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {sidebarOpen && (
            <QuestionSidebar
              questions={questions}
              currentIndex={currentQIndex}
              answeredIds={answeredIds}
              testCases={allTestCases}
              isSubmitting={isSubmittingExam}
              onSelect={selectQuestion}
              onReviewSubmit={() => setReviewOpen(true)}
              onClose={() => setSidebarOpen(false)}
            />
          )}
        </div>

        <div className="mt-5 flex items-center justify-end border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="px-5 py-2 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2"
          >
            <Send className="w-3.5 h-3.5" />
            Review & Submit Test
          </button>
        </div>

        <SubmitReviewModal
          isOpen={reviewOpen}
          examTitle={exam.title}
          questions={questions}
          answers={answers}
          answeredIds={answeredIds}
          testCases={allTestCases}
          isSubmitting={isSubmittingExam}
          onClose={() => setReviewOpen(false)}
          onConfirm={handleConfirmSubmit}
        />

        <ExamVerificationModal
          examId={exam.id}
          isOpen={verificationOpen}
          onClose={() => setVerificationOpen(false)}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}
