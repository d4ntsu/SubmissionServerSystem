"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import {
  Announcement,
  StudentClientStatus,
  RealtimeEventLog,
  Submission,
  Exam,
  ExamStatus,
  Question,
  TestCase,
} from "@/types";
import {
  MOCK_ANNOUNCEMENTS,
  MOCK_SUBMISSIONS,
  MOCK_EXAMS,
  MOCK_QUESTIONS,
  MOCK_TEST_CASES,
} from "./api";
import { gradeSubmissionLocally } from "./grading";
import {
  buildExamVerification,
  ExamVerification,
  ExamVerificationSummary,
} from "./exam-verification";

export interface RealtimeToast {
  id: string;
  title: string;
  message: string;
  type: "announcement" | "submission" | "system";
  priority?: "urgent" | "warning" | "info";
  timestamp: string;
}

interface SocketContextType {
  isConnected: boolean;
  announcements: Announcement[];
  activeAnnouncement: Announcement | null;
  clearActiveAnnouncement: () => void;
  notifications: RealtimeToast[];
  dismissNotification: (id: string) => void;
  postAnnouncement: (data: { title: string; message: string; priority: "info" | "warning" | "urgent"; target_exam_id?: number | "all" }) => void;
  deleteAnnouncement: (id: string) => void;
  studentsStatus: StudentClientStatus[];
  eventLogs: RealtimeEventLog[];
  clearLogs: () => void;
  addLog: (level: "INFO" | "WARN" | "EVENT" | "SUBMISSION" | "SYSTEM", source: string, message: string, details?: any) => void;
  submissions: Submission[];
  submitCode: (sub: { student_id: number; student_name: string; question_id: number; question_title: string; exam_id: number; exam_title: string; language: string; source_code: string }) => Promise<Submission>;
  regradeSubmission: (id: number) => void;
  examVerifications: Record<number, ExamVerificationSummary>;
  runExamVerification: (id: number) => ExamVerification;
  clearExamVerification: (id: number) => void;

  // Exam & Questions Management
  exams: Exam[];
  createExam: (data: Partial<Exam> & { access_password?: string }) => Exam;
  updateExam: (id: number, data: Partial<Exam> & { access_password?: string | null }) => void;
  setExamStatus: (id: number, status: ExamStatus) => void;
  deleteExam: (id: number) => void;
  hasExamPassword: (id: number) => boolean;
  verifyExamPassword: (id: number, password: string) => boolean;
  setExamPassword: (id: number, password: string | null) => void;
  questions: Record<number, Question[]>;
  createQuestion: (examId: number, data: Partial<Question>) => Question;
  updateQuestion: (examId: number, questionId: number, data: Partial<Question>) => void;
  deleteQuestion: (examId: number, questionId: number) => void;
  testCases: Record<number, TestCase[]>;
  createTestCase: (questionId: number, data: Partial<TestCase>) => TestCase;
  deleteTestCase: (questionId: number, testCaseId: number) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const STORAGE_KEYS = {
  exams: "lan_exam_exams_v1",
  questions: "lan_exam_questions_v1",
  testCases: "lan_exam_test_cases_v1",
  submissions: "lan_exam_submissions_v1",
  verifications: "lan_exam_verifications_v1",
  eventLogs: "lan_exam_event_logs_v2",
};

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>(MOCK_ANNOUNCEMENTS);
  const [activeAnnouncement, setActiveAnnouncement] = useState<Announcement | null>(null);
  const [notifications, setNotifications] = useState<RealtimeToast[]>([
    {
      id: "toast-init",
      title: "Instructor Announcement",
      message: "Welcome to CS201 Final Examination. You have 90 minutes. Good luck!",
      type: "announcement",
      priority: "urgent",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [studentsStatus, setStudentsStatus] = useState<StudentClientStatus[]>([]);
  const [eventLogs, setEventLogs] = useState<RealtimeEventLog[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>(MOCK_SUBMISSIONS);

  // Exam, Questions, and Test Cases Management State
  const [exams, setExams] = useState<Exam[]>(MOCK_EXAMS);
  const [questions, setQuestions] = useState<Record<number, Question[]>>(MOCK_QUESTIONS);
  const [testCases, setTestCases] = useState<Record<number, TestCase[]>>(MOCK_TEST_CASES);
  const [examVerifications, setExamVerifications] = useState<
    Record<number, ExamVerificationSummary>
  >({});
  const [examPasswords, setExamPasswords] = useState<Record<number, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem("lan_exam_passwords") || "{}");
    } catch {
      return {};
    }
  });
  const [storageReady, setStorageReady] = useState(false);
  const nextSubmissionId = useRef(500 + MOCK_SUBMISSIONS.length + 1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedExams = window.localStorage.getItem(STORAGE_KEYS.exams);
      if (storedExams) {
        const parsed = JSON.parse(storedExams);
        if (Array.isArray(parsed)) setExams(parsed);
      }
      const storedQuestions = window.localStorage.getItem(STORAGE_KEYS.questions);
      if (storedQuestions) {
        const parsed = JSON.parse(storedQuestions);
        if (parsed && typeof parsed === "object") setQuestions(parsed);
      }
      const storedTestCases = window.localStorage.getItem(STORAGE_KEYS.testCases);
      if (storedTestCases) {
        const parsed = JSON.parse(storedTestCases);
        if (parsed && typeof parsed === "object") setTestCases(parsed);
      }
      const storedSubmissions = window.localStorage.getItem(STORAGE_KEYS.submissions);
      if (storedSubmissions) {
        const parsed = JSON.parse(storedSubmissions);
        if (Array.isArray(parsed)) {
          const recovered = parsed.map((submission: Submission) =>
            submission.status === "queued" || submission.status === "running"
              ? {
                  ...submission,
                  status: "error" as const,
                  error_summary:
                    "Grading was interrupted before completion. Ask your instructor to re-grade this submission.",
                }
              : submission
          );
          setSubmissions(recovered);
          nextSubmissionId.current =
            Math.max(nextSubmissionId.current, ...recovered.map((submission) => submission.id)) + 1;
        }
      }
      const storedVerifications = window.localStorage.getItem(STORAGE_KEYS.verifications);
      if (storedVerifications) {
        const parsed = JSON.parse(storedVerifications);
        if (parsed && typeof parsed === "object") setExamVerifications(parsed);
      }
      const storedLogs = window.localStorage.getItem(STORAGE_KEYS.eventLogs);
      if (storedLogs) {
        const parsed = JSON.parse(storedLogs);
        if (Array.isArray(parsed)) setEventLogs(parsed);
      }
    } catch {
      // Fall back to the bundled demo data when storage is corrupted.
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.exams, JSON.stringify(exams));
  }, [exams, storageReady]);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.questions, JSON.stringify(questions));
  }, [questions, storageReady]);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.testCases, JSON.stringify(testCases));
  }, [testCases, storageReady]);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.submissions, JSON.stringify(submissions));
  }, [submissions, storageReady]);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEYS.verifications,
      JSON.stringify(examVerifications)
    );
  }, [examVerifications, storageReady]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEYS.eventLogs) return;
      try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : [];
        if (Array.isArray(parsed)) setEventLogs(parsed);
      } catch {
        // Ignore malformed cross-tab log payloads.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const persistPasswords = useCallback((next: Record<number, string>) => {
    setExamPasswords(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("lan_exam_passwords", JSON.stringify(next));
    }
  }, []);

  const hasExamPassword = useCallback(
    (id: number) =>
      Boolean(examPasswords[id]) ||
      Boolean(exams.find((exam) => exam.id === id)?.has_password),
    [examPasswords, exams]
  );

  const verifyExamPassword = useCallback(
    (id: number, password: string) => {
      const storedPassword = examPasswords[id];
      if (storedPassword) return storedPassword === password;
      const exam = exams.find((item) => item.id === id);
      return !exam?.has_password;
    },
    [examPasswords, exams]
  );

  const setExamPassword = useCallback(
    (id: number, password: string | null) => {
      const next = { ...examPasswords };
      if (password && password.trim()) {
        next[id] = password.trim();
      } else {
        delete next[id];
      }
      persistPasswords(next);
    },
    [examPasswords, persistPasswords]
  );

  const addNotification = useCallback((toast: Omit<RealtimeToast, "id" | "timestamp">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast: RealtimeToast = {
      ...toast,
      id,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setNotifications((prev) => [newToast, ...prev.slice(0, 4)]);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addLog = useCallback(
    (level: "INFO" | "WARN" | "EVENT" | "SUBMISSION" | "SYSTEM", source: string, message: string, details?: any) => {
      const newLog: RealtimeEventLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        details,
      };
      if (typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem(STORAGE_KEYS.eventLogs);
          const parsed = stored ? JSON.parse(stored) : [];
          const current = Array.isArray(parsed) ? (parsed as RealtimeEventLog[]) : [];
          window.localStorage.setItem(
            STORAGE_KEYS.eventLogs,
            JSON.stringify([newLog, ...current.slice(0, 99)])
          );
        } catch {
          window.localStorage.setItem(
            STORAGE_KEYS.eventLogs,
            JSON.stringify([newLog])
          );
        }
      }
      setEventLogs((prev) => [newLog, ...prev.slice(0, 99)]);
    },
    []
  );

  const postAnnouncement = (data: {
    title: string;
    message: string;
    priority: "info" | "warning" | "urgent";
    target_exam_id?: number | "all";
  }) => {
    const newAnn: Announcement = {
      id: `ann-${Date.now()}`,
      title: data.title,
      message: data.message,
      priority: data.priority,
      target_exam_id: data.target_exam_id || "all",
      created_at: new Date().toISOString(),
      author_name: "Course Instructor",
    };

    setAnnouncements((prev) => [newAnn, ...prev]);

    addNotification({
      title: `Teacher Broadcast: ${data.title}`,
      message: data.message,
      type: "announcement",
      priority: data.priority,
    });

    addLog(
      "EVENT",
      "Teacher Portal",
      `Broadcasted announcement "${data.title}" [${data.priority.toUpperCase()}] to active participants`
    );
  };

  const deleteAnnouncement = (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

  const clearLogs = () => {
    setEventLogs([]);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.eventLogs, JSON.stringify([]));
    }
  };

  const clearExamVerification = (id: number) => {
    setExamVerifications((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const examIdForQuestion = (questionId: number): number | null => {
    for (const [examId, examQuestions] of Object.entries(questions)) {
      if (examQuestions.some((question) => question.id === questionId)) {
        return Number(examId);
      }
    }
    return null;
  };

  const runExamVerification = (id: number): ExamVerification => {
    const exam = exams.find((item) => item.id === id);
    const examQuestions = questions[id] || [];
    const casesByQuestion: Record<number, TestCase[]> = {};
    examQuestions.forEach((question) => {
      casesByQuestion[question.id] = testCases[question.id] || [];
    });

    const report = buildExamVerification(exam, id, examQuestions, casesByQuestion);
    setExamVerifications((previous) => ({
      ...previous,
      [id]: {
        examId: id,
        checkedAt: report.checkedAt,
        passed: report.passed,
      },
    }));

    addLog(
      report.passed ? "EVENT" : "WARN",
      "Exam Verification",
      report.passed
        ? `Preflight verification passed for "${report.examTitle}" (${report.questions.length} question${report.questions.length === 1 ? "" : "s"} ready)`
        : `Preflight verification failed for "${report.examTitle}" (${report.questions.filter((question) => !question.passed).length} question(s) need fixes)`
    );

    return report;
  };

  // Exam Management actions
  const createExam = (data: Partial<Exam> & { access_password?: string }): Exam => {
    const newId = exams.length > 0 ? Math.max(...exams.map((e) => e.id)) + 1 : 1;
    const { access_password, ...examData } = data;
    const newExam: Exam = {
      id: newId,
      title: examData.title || `New Examination #${newId}`,
      description: examData.description || "Enter examination requirements and instructions.",
      teacher_id: 1,
      start_time: examData.start_time || new Date().toISOString(),
      end_time: examData.end_time || new Date(Date.now() + 1000 * 60 * 120).toISOString(),
      duration_minutes: examData.duration_minutes || 90,
      status: examData.status || "draft",
      questions_count: 0,
      total_points: 0,
      has_password: Boolean(access_password?.trim()),
    };
    setExams((prev) => [newExam, ...prev]);
    setQuestions((prev) => ({ ...prev, [newId]: [] }));
    if (access_password?.trim()) {
      setExamPassword(newId, access_password);
    }

    addLog("EVENT", "Exam Manager", `Created new examination #${newId}: "${newExam.title}" (Status: ${newExam.status.toUpperCase()})`);
    return newExam;
  };

  const updateExam = (id: number, data: Partial<Exam> & { access_password?: string | null }) => {
    clearExamVerification(id);
    const { access_password, ...examData } = data;
    setExams((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...examData } : e))
    );
    if (access_password !== undefined) {
      setExamPassword(id, access_password);
      setExams((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, has_password: Boolean(access_password?.trim()) } : e
        )
      );
    }
    addLog("EVENT", "Exam Manager", `Updated examination #${id} details`);
  };

  const setExamStatus = (id: number, newStatus: ExamStatus) => {
    setExams((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e))
    );

    const targetExam = exams.find((e) => e.id === id);
    const examTitle = targetExam?.title || `Exam #${id}`;

    if (newStatus === "started") {
      addNotification({
        title: "EXAMINATION STARTED",
        message: `Instructor has started "${examTitle}". Code submission is now open!`,
        type: "system",
        priority: "urgent",
      });
      addLog("EVENT", "Exam Lifecycle", `Teacher started test "${examTitle}". Students can now begin the test.`);
    } else if (newStatus === "ended") {
      addNotification({
        title: "EXAMINATION CONCLUDED",
        message: `"${examTitle}" has concluded. Further submissions are rejected by server.`,
        type: "system",
        priority: "urgent",
      });
      addLog("EVENT", "Exam Lifecycle", `Teacher ended test "${examTitle}". All student attempts closed and submissions locked.`);
    } else {
      addLog("EVENT", "Exam Lifecycle", `Exam #${id} status changed to ${newStatus.toUpperCase()}`);
    }
  };

  const deleteExam = (id: number) => {
    clearExamVerification(id);
    setExams((prev) => prev.filter((e) => e.id !== id));
    if (examPasswords[id]) {
      const next = { ...examPasswords };
      delete next[id];
      persistPasswords(next);
    }
    addLog("WARN", "Exam Manager", `Deleted examination #${id}`);
  };

  // Question Management actions
  const createQuestion = (examId: number, data: Partial<Question>): Question => {
    clearExamVerification(examId);
    const existing = questions[examId] || [];
    const newId = 100 + Math.floor(Math.random() * 899);
    const newQ: Question = {
      id: newId,
      exam_id: examId,
      title: data.title || `Problem ${existing.length + 1}: New Challenge`,
      description: data.description || "Provide problem requirements, input/output constraints here.",
      points: data.points || 25,
      question_type: data.question_type || "STDIN_STDOUT",
      time_limit: data.time_limit || 2,
      language: data.language || "java",
      class_name: data.class_name || (data.question_type === "JAVA_CLASS_METHOD" ? "Solution" : null),
      method_name: data.method_name || (data.question_type === "JAVA_CLASS_METHOD" ? "solve" : null),
      method_mode: data.method_mode || "STATIC",
      return_type: data.return_type || "int",
      parameter_types: data.parameter_types || "int, int",
      show_result_to_student: data.show_result_to_student ?? true,
    };

    setQuestions((prev) => ({
      ...prev,
      [examId]: [...(prev[examId] || []), newQ],
    }));

    // Update points and count on exam
    setExams((prev) =>
      prev.map((e) => {
        if (e.id === examId) {
          const count = (e.questions_count || 0) + 1;
          const points = (e.total_points || 0) + newQ.points;
          return { ...e, questions_count: count, total_points: points };
        }
        return e;
      })
    );

    addLog("EVENT", "Question Manager", `Added Question #${newId} ("${newQ.title}") to Exam #${examId}`);
    return newQ;
  };

  const updateQuestion = (examId: number, questionId: number, data: Partial<Question>) => {
    clearExamVerification(examId);
    setQuestions((prev) => ({
      ...prev,
      [examId]: (prev[examId] || []).map((q) => (q.id === questionId ? { ...q, ...data } : q)),
    }));
    addLog("EVENT", "Question Manager", `Updated Question #${questionId}`);
  };

  const deleteQuestion = (examId: number, questionId: number) => {
    clearExamVerification(examId);
    setQuestions((prev) => ({
      ...prev,
      [examId]: (prev[examId] || []).filter((q) => q.id !== questionId),
    }));
    addLog("WARN", "Question Manager", `Deleted Question #${questionId} from Exam #${examId}`);
  };

  // Test Case Management actions
  const createTestCase = (questionId: number, data: Partial<TestCase>): TestCase => {
    const ownerExamId = examIdForQuestion(questionId);
    if (ownerExamId !== null) clearExamVerification(ownerExamId);
    const existing = testCases[questionId] || [];
    const newId = 1000 + Math.floor(Math.random() * 8999);
    const newTc: TestCase = {
      id: newId,
      question_id: questionId,
      is_sample: data.is_sample ?? true,
      weight: data.weight || 10,
      stdin: data.stdin || "",
      expected_stdout: data.expected_stdout || "",
      arguments: data.arguments || "",
      expected_return: data.expected_return || "",
    };

    setTestCases((prev) => ({
      ...prev,
      [questionId]: [...(prev[questionId] || []), newTc],
    }));

    addLog("EVENT", "TestCase Manager", `Added test case #${newId} to Question #${questionId} (Sample: ${newTc.is_sample})`);
    return newTc;
  };

  const deleteTestCase = (questionId: number, testCaseId: number) => {
    const ownerExamId = examIdForQuestion(questionId);
    if (ownerExamId !== null) clearExamVerification(ownerExamId);
    setTestCases((prev) => ({
      ...prev,
      [questionId]: (prev[questionId] || []).filter((tc) => tc.id !== testCaseId),
    }));
    addLog("WARN", "TestCase Manager", `Removed test case #${testCaseId} from Question #${questionId}`);
  };

  const submitCode = async (data: {
    student_id: number;
    student_name: string;
    question_id: number;
    question_title: string;
    exam_id: number;
    exam_title: string;
    language: string;
    source_code: string;
  }): Promise<Submission> => {
    const newSubId = nextSubmissionId.current++;
    const question = Object.values(questions)
      .flat()
      .find((item) => item.id === data.question_id);
    const questionTestCases = testCases[data.question_id] || [];
    const maxScore = question?.points ?? 0;

    const initialSub: Submission = {
      id: newSubId,
      student_id: data.student_id,
      student_name: data.student_name,
      student_username: "current_user",
      question_id: data.question_id,
      question_title: data.question_title,
      exam_id: data.exam_id,
      exam_title: data.exam_title,
      language: question?.language || data.language,
      source_code: data.source_code,
      status: "queued",
      score: null,
      max_score: maxScore,
      submitted_at: new Date().toISOString(),
    };

    setSubmissions((prev) => [initialSub, ...prev]);

    addNotification({
      title: "Submission Received",
      message: `Solution #${newSubId} for "${data.question_title}" is queued for grading.`,
      type: "submission",
      priority: "info",
    });

    addLog(
      "SUBMISSION",
      data.student_name,
      `Submitted solution #${newSubId} for "${data.question_title}" (${initialSub.language}). Queued.`
    );

    if (!question) {
      const missingQuestionSub: Submission = {
        ...initialSub,
        status: "error",
        error_summary: "Question not found in the database. The submission was not graded.",
      };
      setTimeout(() => {
        setSubmissions((prev) =>
          prev.map((s) => (s.id === newSubId ? missingQuestionSub : s))
        );
        addNotification({
          title: "Grading Failed",
          message: `Submission #${newSubId} could not be graded: question not found.`,
          type: "submission",
          priority: "warning",
        });
        addLog("WARN", "Grading Worker", `Submission #${newSubId} failed: question not found.`);
      }, 700);
      return initialSub;
    }

    setTimeout(() => {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === newSubId ? { ...s, status: "running" } : s))
      );
      addLog("INFO", "Grading Worker", `Submission #${newSubId} is being evaluated...`);
    }, 900);

    setTimeout(() => {
      const outcome = gradeSubmissionLocally(
        newSubId,
        question,
        questionTestCases,
        data.source_code
      );

      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === newSubId
            ? {
                ...s,
                status: outcome.status,
                score: outcome.score,
                error_summary: outcome.error_summary,
                graded_at: new Date().toISOString(),
                test_results: outcome.test_results,
              }
            : s
        )
      );

      const passedCount = outcome.test_results.filter((result) => result.passed === 1).length;
      const totalCount = outcome.test_results.length;

      addNotification({
        title: outcome.status === "error" ? "Grading Failed" : "Grading Completed",
        message:
          outcome.status === "error"
            ? `Submission #${newSubId}: ${outcome.error_summary}`
            : `Submission #${newSubId} finished evaluation: ${outcome.score} / ${maxScore} points (${passedCount}/${totalCount} tests passed).`,
        type: "submission",
        priority: outcome.status === "error" || (outcome.score ?? 0) < maxScore ? "warning" : "info",
      });

      addLog(
        outcome.status === "error" ? "WARN" : "SUBMISSION",
        "Grading Worker",
        outcome.status === "error"
          ? `Submission #${newSubId} could not be graded: ${outcome.error_summary}`
          : `Submission #${newSubId} evaluated: ${outcome.score}/${maxScore} points. Only passing test cases earned points.`
      );
    }, 2400);

    return initialSub;
  };

  const regradeSubmission = (id: number) => {
    const target = submissions.find((s) => s.id === id);
    if (!target) {
      addLog("WARN", "Admin Trigger", `Re-grade requested for unknown submission #${id}`);
      return;
    }

    const question = Object.values(questions)
      .flat()
      .find((item) => item.id === target.question_id);
    const questionTestCases = testCases[target.question_id] || [];

    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: "running", error_summary: null } : s
      )
    );
    addLog("INFO", "Admin Trigger", `Teacher triggered re-grade for submission #${id}`);

    setTimeout(() => {
      if (!question) {
        setSubmissions((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: "error",
                  score: null,
                  error_summary: "Question not found in the database. Re-grade aborted.",
                }
              : s
          )
        );
        addLog("WARN", "Grading Worker", `Re-grade failed for #${id}: question not found.`);
        return;
      }

      const outcome = gradeSubmissionLocally(id, question, questionTestCases, target.source_code);
      const previousScore = target.score;

      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: outcome.status,
                score: outcome.score,
                error_summary: outcome.error_summary,
                graded_at: new Date().toISOString(),
                test_results: outcome.test_results,
              }
            : s
        )
      );

      if (outcome.status === "error") {
        addNotification({
          title: "Re-grade Failed",
          message: `Submission #${id}: ${outcome.error_summary}`,
          type: "system",
        });
        addLog("WARN", "Grading Worker", `Re-grade failed for #${id}: ${outcome.error_summary}`);
        return;
      }

      const change =
        previousScore == null
          ? `Score set to ${outcome.score}/${target.max_score}.`
          : previousScore === outcome.score
          ? `Score unchanged at ${outcome.score}/${target.max_score}.`
          : previousScore < (outcome.score ?? 0)
          ? `Score increased from ${previousScore} to ${outcome.score}/${target.max_score}.`
          : `Score adjusted from ${previousScore} to ${outcome.score}/${target.max_score}.`;

      addNotification({
        title: "Re-grade Completed",
        message: `Submission #${id} re-evaluated. ${change}`,
        type: "system",
      });
      addLog("SUBMISSION", "Grading Worker", `Re-grade completed for #${id}. ${change}`);
    }, 1600);
  };

  return (
    <SocketContext.Provider
      value={{
        isConnected,
        announcements,
        activeAnnouncement,
        clearActiveAnnouncement: () => setActiveAnnouncement(null),
        notifications,
        dismissNotification,
        postAnnouncement,
        deleteAnnouncement,
        studentsStatus,
        eventLogs,
        clearLogs,
        addLog,
        submissions,
        submitCode,
        regradeSubmission,
        examVerifications,
        runExamVerification,
        clearExamVerification,

        // Exam & Questions Management
        exams,
        createExam,
        updateExam,
        setExamStatus,
        deleteExam,
        hasExamPassword,
        verifyExamPassword,
        setExamPassword,
        questions,
        createQuestion,
        updateQuestion,
        deleteQuestion,
        testCases,
        createTestCase,
        deleteTestCase,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
