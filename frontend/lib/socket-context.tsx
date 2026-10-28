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
  MOCK_STUDENTS_STATUS,
  MOCK_EVENT_LOGS,
  MOCK_SUBMISSIONS,
  MOCK_QUESTIONS,
  MOCK_TEST_CASES,
  createExamRequest,
  createQuestionRequest,
  createTestCaseRequest,
  deleteExamRequest,
  deleteQuestionRequest,
  deleteTestCaseRequest,
  fetchExams,
  fetchQuestionsByExam,
  fetchTestCasesByQuestion,
  submitCodeRequest,
  fetchSubmissionResult,
    regradeRequest,
    toFrontendQuestion,
  toFrontendTestCase,
    toBackendQuestionType,
    toBackendLanguage,
    updateExamRequest,
      updateQuestionRequest,
      BackendSubmissionResult,
    ApiError,
  } from "./api";
import { gradeSubmissionLocally } from "./grading";
import { useAuth } from "./auth-context";
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
  regradeSubmission: (id: number) => Promise<void>;
  examVerifications: Record<number, ExamVerificationSummary>;
  runExamVerification: (id: number) => ExamVerification;
  clearExamVerification: (id: number) => void;

  // Exam & Questions Management
  exams: Exam[];
  dataApiError: string | null;
  isExamDataLoaded: boolean;
  retryExamData: () => void;
    createExam: (data: Partial<Exam> & { access_password?: string }) => Promise<Exam>;
    updateExam: (id: number, data: Partial<Exam> & { access_password?: string | null }) => Promise<void>;
    setExamStatus: (id: number, status: ExamStatus) => Promise<void>;
  deleteExam: (id: number) => void;
  hasExamPassword: (id: number) => boolean;
  verifyExamPassword: (id: number, password: string) => boolean;
  setExamPassword: (id: number, password: string | null) => void;
  questions: Record<number, Question[]>;
    createQuestion: (examId: number, data: Partial<Question>) => Promise<Question>;
  updateQuestion: (examId: number, questionId: number, data: Partial<Question>) => Promise<void>;
  deleteQuestion: (examId: number, questionId: number) => void;
  testCases: Record<number, TestCase[]>;
    createTestCase: (questionId: number, data: Partial<TestCase>) => Promise<TestCase>;
  deleteTestCase: (questionId: number, testCaseId: number) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const STORAGE_KEYS = {
  questions: "lan_exam_questions_v1",
  testCases: "lan_exam_test_cases_v1",
  submissions: "lan_exam_submissions_v1",
  verifications: "lan_exam_verifications_v1",
  eventLogs: "lan_exam_event_logs_v1",
};

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, logout } = useAuth();
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
  const [studentsStatus, setStudentsStatus] = useState<StudentClientStatus[]>(MOCK_STUDENTS_STATUS);
  const [eventLogs, setEventLogs] = useState<RealtimeEventLog[]>(MOCK_EVENT_LOGS);
  const [submissions, setSubmissions] = useState<Submission[]>(MOCK_SUBMISSIONS);

  // Exam, Questions, and Test Cases Management State
  const [exams, setExams] = useState<Exam[]>([]);
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
  const [dataApiError, setDataApiError] = useState<string | null>(null);
  const [isExamDataLoaded, setIsExamDataLoaded] = useState(false);
  const [examDataRetryCount, setExamDataRetryCount] = useState(0);
  const nextSubmissionId = useRef(500 + MOCK_SUBMISSIONS.length + 1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem("lan_exam_exams_v1");
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
      } else {
        window.localStorage.setItem(
          STORAGE_KEYS.eventLogs,
          JSON.stringify(MOCK_EVENT_LOGS)
        );
      }
    } catch {
      // Fall back to the bundled demo data when storage is corrupted.
    }
    setStorageReady(true);
  }, []);

  // Load backend data only for verified sessions; failures must not leave demo data looking authoritative.
  useEffect(() => {
    if (!token) {
      setDataApiError(null);
      setIsExamDataLoaded(false);
      return;
    }

    let cancelled = false;
    setDataApiError(null);
    setIsExamDataLoaded(false);
    setExams([]);
    setQuestions({});
    setTestCases({});

    (async () => {
      try {
        const realExams = await fetchExams(token);
        const qByExam: Record<number, Question[]> = {};
        const tcByQ: Record<number, TestCase[]> = {};

        for (const exam of realExams) {
          const qs = await fetchQuestionsByExam(exam.id, token);
          const frontendQuestions = qs.map(toFrontendQuestion);
          qByExam[exam.id] = frontendQuestions;

          for (const question of frontendQuestions) {
            const testCases = await fetchTestCasesByQuestion(question.id, token);
            tcByQ[question.id] = testCases.map((testCase) =>
              toFrontendTestCase(testCase, question.question_type)
            );
          }
        }

        if (!cancelled) {
          setExams(realExams);
          setQuestions(qByExam);
          setTestCases(tcByQ);
          setIsExamDataLoaded(true);
        }
      } catch (error) {
        if (cancelled) return;
        setExams([]);
        setQuestions({});
        setTestCases({});
        setDataApiError(
          error instanceof Error
            ? error.message
            : "Could not load exam data from the backend. Retry when the server is available."
        );
        setIsExamDataLoaded(true);
        if (error instanceof ApiError && error.status === 401) {
          logout("Your session was rejected by the backend. Please sign in again.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, examDataRetryCount, logout]);

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

    const report = buildExamVerification(
      exam,
      id,
      examQuestions,
      casesByQuestion,
      Boolean(token)
    );
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
    const createExam = async (data: Partial<Exam> & { access_password?: string }): Promise<Exam> => {
      const { access_password, ...examData } = data;
      const newId = exams.length > 0 ? Math.max(...exams.map((e) => e.id)) + 1 : 1;
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

      // Real backend persistence when online.
      if (token) {
        const created = await createExamRequest(
          {
            title: newExam.title,
            description: newExam.description,
            start_time: newExam.start_time,
            end_time: newExam.end_time,
            duration_minutes: newExam.duration_minutes,
            access_password: access_password?.trim() || undefined,
          },
          token
        );
        if (created) {
          setExams((prev) => [created, ...prev]);
          setQuestions((prev) => ({ ...prev, [created.id]: [] }));
          if (access_password?.trim()) setExamPassword(created.id, access_password);
          addLog("EVENT", "Exam Manager", `Created new examination #${created.id}: "${created.title}" (Status: ${created.status.toUpperCase()})`);
          return created;
        }
      }

      setExams((prev) => [newExam, ...prev]);
      setQuestions((prev) => ({ ...prev, [newId]: [] }));
      if (access_password?.trim()) {
        setExamPassword(newId, access_password);
      }

      addLog("EVENT", "Exam Manager", `Created new examination #${newId}: "${newExam.title}" (Status: ${newExam.status.toUpperCase()})`);
      return newExam;
    };

  const updateExam = async (
      id: number,
      data: Partial<Exam> & { access_password?: string | null }
    ): Promise<void> => {
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
      if (token) {
        const updated = await updateExamRequest(
          id,
          {
            title: examData.title,
            description: examData.description,
            duration_minutes: examData.duration_minutes,
            status: examData.status,
            access_password: access_password === undefined ? undefined : access_password || null,
          },
          token
        );
        if (updated) {
          setExams((prev) => prev.map((e) => (e.id === id ? updated : e)));
        }
      }
      addLog("EVENT", "Exam Manager", `Updated examination #${id} details`);
    };

  const setExamStatus = async (id: number, newStatus: ExamStatus) => {
    setExams((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e))
    );

      if (token) {
        await updateExamRequest(id, { status: newStatus }, token);
      }

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
      if (token) {
        deleteExamRequest(id, token);
      }
      if (examPasswords[id]) {
        const next = { ...examPasswords };
        delete next[id];
        persistPasswords(next);
      }
      addLog("WARN", "Exam Manager", `Deleted examination #${id}`);
    };

  // Question Management actions
    const createQuestion = async (examId: number, data: Partial<Question>): Promise<Question> => {
    clearExamVerification(examId);
    const existing = questions[examId] || [];
    const newId = 100 + Math.floor(Math.random() * 899);
    const newQ: Question = {
      id: newId,
      exam_id: examId,
      title: data.title || `Problem ${existing.length + 1}: New Challenge`,
      description: data.description || "Provide problem requirements, input/output constraints here.",
      boilerplate: data.boilerplate ?? "",
      points: data.points || 25,
      question_type: data.question_type || "STDIN_STDOUT",
      time_limit: data.time_limit || 2,
      language: data.language || "java",
      class_name: data.class_name || (data.question_type === "JAVA_CLASS_METHOD" ? "Solution" : null),
      method_name: data.method_name || (data.question_type === "JAVA_CLASS_METHOD" ? "solve" : null),
      method_mode: data.method_mode || "STATIC",
      return_type: data.return_type || "int",
      parameter_types: data.parameter_types ?? "int, int",
      show_result_to_student: data.show_result_to_student ?? true,
    };

      if (token) {
        const created = await createQuestionRequest(
          {
            exam_id: examId,
            title: newQ.title,
            description: newQ.description,
            boilerplate: newQ.boilerplate ?? "",
            question_type: toBackendQuestionType(newQ.question_type),
            max_score: newQ.points,
            allowed_languages: toBackendLanguage(newQ.language),
            class_name: newQ.class_name,
            method_signature: newQ.method_name
              ? `${newQ.method_name}(${newQ.parameter_types ?? "int, int"}): ${newQ.return_type || "int"}`
              : null,
            method_mode: newQ.method_mode || "STATIC",
          },
          token
        );
        setQuestions((prev) => ({
          ...prev,
          [examId]: [...(prev[examId] || []), created],
        }));
        setExams((prev) =>
          prev.map((e) => {
            if (e.id === examId) {
              const count = (e.questions_count || 0) + 1;
              const points = (e.total_points || 0) + created.points;
              return { ...e, questions_count: count, total_points: points };
            }
            return e;
          })
        );
        addLog("EVENT", "Question Manager", `Added Question #${created.id} ("${created.title}") to Exam #${examId}`);
        return created;
      }

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

  const updateQuestion = async (
    examId: number,
    questionId: number,
    data: Partial<Question>
  ): Promise<void> => {
    const currentQuestion = (questions[examId] || []).find((question) => question.id === questionId);
    if (!currentQuestion) {
      throw new Error(`Question #${questionId} could not be found in this exam.`);
    }

    const updatedQuestion = { ...currentQuestion, ...data };
    let questionToStore = updatedQuestion;
    if (token) {
      const persistedQuestion = await updateQuestionRequest(
        questionId,
        {
          title: updatedQuestion.title,
          description: updatedQuestion.description,
          boilerplate: updatedQuestion.boilerplate ?? "",
          question_type: toBackendQuestionType(updatedQuestion.question_type),
          max_score: updatedQuestion.points,
          allowed_languages: toBackendLanguage(updatedQuestion.language),
          class_name: updatedQuestion.class_name ?? null,
          method_signature: updatedQuestion.method_name
            ? `${updatedQuestion.method_name}(${updatedQuestion.parameter_types ?? ""}): ${updatedQuestion.return_type || "int"}`
            : null,
          method_mode: updatedQuestion.method_mode || "STATIC",
        },
        token
      );
      questionToStore = {
        ...persistedQuestion,
        time_limit: updatedQuestion.time_limit,
        show_result_to_student: updatedQuestion.show_result_to_student,
      };
    }

    clearExamVerification(examId);
    setQuestions((prev) => ({
      ...prev,
      [examId]: (prev[examId] || []).map((question) =>
        question.id === questionId ? questionToStore : question
      ),
    }));
    addLog("EVENT", "Question Manager", `Updated Question #${questionId}`);
  };

  const deleteQuestion = (examId: number, questionId: number) => {
    clearExamVerification(examId);
    setQuestions((prev) => ({
      ...prev,
      [examId]: (prev[examId] || []).filter((q) => q.id !== questionId),
    }));
      if (token) {
        deleteQuestionRequest(questionId, token);
      }
      addLog("WARN", "Question Manager", `Deleted Question #${questionId} from Exam #${examId}`);
    };

    // Test Case Management actions
    const createTestCase = async (questionId: number, data: Partial<TestCase>): Promise<TestCase> => {
      const ownerExamId = examIdForQuestion(questionId);
      const question =
        ownerExamId === null
          ? undefined
          : (questions[ownerExamId] || []).find((item) => item.id === questionId);
      const isJavaMethodQuestion = question?.question_type === "JAVA_CLASS_METHOD";
      if (ownerExamId !== null) clearExamVerification(ownerExamId);
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

      if (token) {
        const created = await createTestCaseRequest(
          {
            question_id: questionId,
            input_data: isJavaMethodQuestion
              ? newTc.arguments || ""
              : newTc.stdin || "",
            expected_output: isJavaMethodQuestion
              ? newTc.expected_return || ""
              : newTc.expected_stdout || "",
            is_hidden: newTc.is_sample ? 0 : 1,
            score_weight: newTc.weight,
          },
          token,
          question?.question_type || "STDIN_STDOUT"
        );
        if (created) {
          setTestCases((prev) => ({
            ...prev,
            [questionId]: [...(prev[questionId] || []), created],
          }));
          addLog("EVENT", "TestCase Manager", `Added test case #${created.id} to Question #${questionId} (Sample: ${created.is_sample})`);
          return created;
        }
      }

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
      if (token) {
        deleteTestCaseRequest(testCaseId, token);
      }
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

      if (token) {
        let backendSubmissionId: number | null = null;
        try {
          const realSubId = await submitCodeRequest(
            data.question_id,
            question.language,
            data.source_code,
            token
          );
          backendSubmissionId = realSubId;
          const acceptedSub: Submission = {
            ...initialSub,
            id: realSubId,
            status: "queued",
          };
          setSubmissions((prev) =>
            prev.map((submission) =>
              submission.id === newSubId ? acceptedSub : submission
            )
          );

          let result: BackendSubmissionResult | null = null;
          let deadline = Date.now() + 30000; // up to 30s for Piston grading
          while (Date.now() < deadline) {
            result = await fetchSubmissionResult(realSubId, token);
            const status = result.submission.status;
            if (status === "completed" || status === "error") break;
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          if (result?.submission.status === "completed" || result?.submission.status === "error") {
            const backendSub: Submission = {
              id: realSubId,
              student_id: data.student_id,
              student_name: data.student_name,
              student_username: "current_user",
              question_id: data.question_id,
              question_title: data.question_title,
              exam_id: data.exam_id,
              exam_title: data.exam_title,
              language: question.language,
              source_code: data.source_code,
              status: result.submission.status as Submission["status"],
              score: result.submission.score,
              max_score: result.submission.max_score,
              error_summary: result.submission.error_summary,
              submitted_at: new Date().toISOString(),
              graded_at: new Date().toISOString(),
              test_results: (result.test_results || []).map((tr) => ({
                id: tr.id,
                submission_id: realSubId,
                test_case_id: tr.test_case_id,
                is_sample: tr.is_sample,
                passed: tr.passed,
                stdout: tr.stdout || "",
                stderr: tr.stderr || "",
                compile_output: tr.compile_output || "",
                exit_code: tr.exit_code,
                time: tr.time,
                memory: tr.memory,
                input_data: tr.input_data || "",
                expected_output: tr.expected_output || "",
                awarded_points: tr.awarded_points,
                score_weight: tr.score_weight,
                message: tr.message,
              })),
            };
            setSubmissions((prev) =>
              prev.map((submission) =>
                submission.id === realSubId ? backendSub : submission
              )
            );

            const failed = backendSub.status === "error";
            addNotification({
              title: failed ? "Grading Failed" : "Grading Completed",
              message: failed
                ? `Submission #${realSubId}: ${backendSub.error_summary || "grading error"}`
                : `Submission #${realSubId} finished evaluation: ${backendSub.score} / ${backendSub.max_score} points (${backendSub.test_results?.filter((t) => t.passed === 1).length ?? 0}/${backendSub.test_results?.length ?? 0} tests passed).`,
              type: "submission",
              priority: failed ? "warning" : "info",
            });
            addLog(
              failed ? "WARN" : "SUBMISSION",
              "Grading Worker",
              failed
                ? `Submission #${realSubId} could not be graded: ${backendSub.error_summary}`
                : `Submission #${realSubId} evaluated: ${backendSub.score}/${backendSub.max_score} points.`
            );
            return backendSub;
          }

          const pendingSub: Submission = {
            ...acceptedSub,
            status: result?.submission.status === "running" ? "running" : "queued",
            max_score: result?.submission.max_score ?? acceptedSub.max_score,
          };
          setSubmissions((prev) =>
            prev.map((submission) =>
              submission.id === realSubId ? pendingSub : submission
            )
          );
          addNotification({
            title: "Grading Still in Progress",
            message: `Submission #${realSubId} was accepted and is still being graded. Refresh the result later.`,
            type: "submission",
            priority: "info",
          });
          addLog(
            "INFO",
            "Grading Worker",
            `Submission #${realSubId} remains ${pendingSub.status} after the polling window.`
          );
          return pendingSub;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "The backend returned an unknown error.";
          const accepted = backendSubmissionId !== null;
          const failedSub: Submission = {
            ...initialSub,
            id: backendSubmissionId ?? newSubId,
            status: accepted ? "running" : "error",
            error_summary: accepted
              ? `Submission #${backendSubmissionId} was accepted, but its grading status could not be retrieved: ${message}`
              : `The backend could not accept this submission: ${message}`,
          };
          setSubmissions((prev) =>
            prev.map((submission) =>
              submission.id === (backendSubmissionId ?? newSubId) ||
              submission.id === newSubId
                ? failedSub
                : submission
            )
          );
          addNotification({
            title: accepted ? "Grading Status Unavailable" : "Submission Failed",
            message: failedSub.error_summary || message,
            type: "submission",
            priority: "warning",
          });
          addLog(
            "WARN",
            "Grading Worker",
            `Submission #${failedSub.id}: ${failedSub.error_summary}`
          );
          return failedSub;
        }
      }

      // Offline demo mode uses heuristic grading only when no backend session exists.
      setTimeout(() => {
        setSubmissions((prev) =>
          prev.map((submission) =>
            submission.id === newSubId ? { ...submission, status: "running" } : submission
          )
        );
        addLog("INFO", "Grading Worker", `Submission #${newSubId} is being evaluated offline...`);
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

  const regradeSubmission = async (id: number) => {
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

      if (token) {
        let accepted = false;
        try {
          await regradeRequest(id, token);
          accepted = true;
          let result: BackendSubmissionResult | null = null;
          let deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            result = await fetchSubmissionResult(id, token);
            const status = result.submission.status;
            if (status === "completed" || status === "error") break;
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (result?.submission.status === "completed" || result?.submission.status === "error") {
            const updated: Submission = {
              ...target,
              status: result.submission.status as Submission["status"],
              score: result.submission.score,
              error_summary: result.submission.error_summary,
              graded_at: new Date().toISOString(),
              test_results: (result.test_results || []).map((tr) => ({
                id: tr.id,
                submission_id: id,
                test_case_id: tr.test_case_id,
                is_sample: tr.is_sample,
                passed: tr.passed,
                stdout: tr.stdout || "",
                stderr: tr.stderr || "",
                compile_output: tr.compile_output || "",
                exit_code: tr.exit_code,
                time: tr.time,
                memory: tr.memory,
                input_data: tr.input_data || "",
                expected_output: tr.expected_output || "",
                awarded_points: tr.awarded_points,
                score_weight: tr.score_weight,
                message: tr.message,
              })),
            };
            setSubmissions((prev) => prev.map((s) => (s.id === id ? updated : s)));
            if (updated.status === "error") {
              addNotification({
                title: "Re-grade Failed",
                message: `Submission #${id}: ${updated.error_summary}`,
                type: "system",
              });
              addLog("WARN", "Grading Worker", `Re-grade failed for #${id}: ${updated.error_summary}`);
              return;
            }
            addNotification({
              title: "Re-grade Completed",
              message: `Submission #${id} re-evaluated. Score: ${updated.score}/${target.max_score}.`,
              type: "system",
            });
            addLog("SUBMISSION", "Grading Worker", `Re-grade completed for #${id}. Score: ${updated.score}/${target.max_score}`);
            return;
          }
          const pendingStatus =
            result?.submission.status === "running" ? "running" : "queued";
          setSubmissions((prev) =>
            prev.map((submission) =>
              submission.id === id
                ? { ...submission, status: pendingStatus, error_summary: null }
                : submission
            )
          );
          addNotification({
            title: "Re-grade Still in Progress",
            message: `Submission #${id} remains ${pendingStatus}. Refresh the result later.`,
            type: "system",
          });
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "The backend returned an unknown error.";
          setSubmissions((prev) =>
            prev.map((submission) =>
              submission.id === id
                ? {
                    ...submission,
                    status: accepted ? "running" : "error",
                    error_summary: accepted
                      ? `Re-grade was accepted, but its status could not be retrieved: ${message}`
                      : `The backend could not re-queue this submission: ${message}`,
                  }
                : submission
            )
          );
          addNotification({
            title: accepted ? "Re-grade Status Unavailable" : "Re-grade Failed",
            message: `Submission #${id}: ${message}`,
            type: "system",
          });
          addLog("WARN", "Grading Worker", `Re-grade failed for #${id}: ${message}`);
          return;
        }
      }

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
        dataApiError,
        isExamDataLoaded,
        retryExamData: () => setExamDataRetryCount((count) => count + 1),
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
      {dataApiError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 shadow-lg"
        >
          <p>{dataApiError}</p>
          <button
            type="button"
            onClick={() => setExamDataRetryCount((count) => count + 1)}
            className="mt-2 font-bold underline"
          >
            Retry loading exam data
          </button>
        </div>
      )}
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
