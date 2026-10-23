"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
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
  MOCK_EXAMS,
  MOCK_QUESTIONS,
  MOCK_TEST_CASES,
} from "./api";

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

  // Exam & Questions Management
  exams: Exam[];
  createExam: (data: Partial<Exam>) => Exam;
  updateExam: (id: number, data: Partial<Exam>) => void;
  setExamStatus: (id: number, status: ExamStatus) => void;
  deleteExam: (id: number) => void;
  questions: Record<number, Question[]>;
  createQuestion: (examId: number, data: Partial<Question>) => Question;
  updateQuestion: (examId: number, questionId: number, data: Partial<Question>) => void;
  deleteQuestion: (examId: number, questionId: number) => void;
  testCases: Record<number, TestCase[]>;
  createTestCase: (questionId: number, data: Partial<TestCase>) => TestCase;
  deleteTestCase: (questionId: number, testCaseId: number) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

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
  const [studentsStatus, setStudentsStatus] = useState<StudentClientStatus[]>(MOCK_STUDENTS_STATUS);
  const [eventLogs, setEventLogs] = useState<RealtimeEventLog[]>(MOCK_EVENT_LOGS);
  const [submissions, setSubmissions] = useState<Submission[]>(MOCK_SUBMISSIONS);

  // Exam, Questions, and Test Cases Management State
  const [exams, setExams] = useState<Exam[]>(MOCK_EXAMS);
  const [questions, setQuestions] = useState<Record<number, Question[]>>(MOCK_QUESTIONS);
  const [testCases, setTestCases] = useState<Record<number, TestCase[]>>(MOCK_TEST_CASES);

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
        timestamp: new Date().toLocaleTimeString(),
        level,
        source,
        message,
        details,
      };
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
  };

  // Exam Management actions
  const createExam = (data: Partial<Exam>): Exam => {
    const newId = exams.length > 0 ? Math.max(...exams.map((e) => e.id)) + 1 : 1;
    const newExam: Exam = {
      id: newId,
      title: data.title || `New Examination #${newId}`,
      description: data.description || "Enter examination requirements and instructions.",
      teacher_id: 1,
      start_time: data.start_time || new Date().toISOString(),
      end_time: data.end_time || new Date(Date.now() + 1000 * 60 * 120).toISOString(),
      duration_minutes: data.duration_minutes || 90,
      status: data.status || "draft",
      questions_count: 0,
      total_points: 0,
    };
    setExams((prev) => [newExam, ...prev]);
    setQuestions((prev) => ({ ...prev, [newId]: [] }));

    addLog("EVENT", "Exam Manager", `Created new examination #${newId}: "${newExam.title}" (Status: ${newExam.status.toUpperCase()})`);
    return newExam;
  };

  const updateExam = (id: number, data: Partial<Exam>) => {
    setExams((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...data } : e))
    );
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
    setExams((prev) => prev.filter((e) => e.id !== id));
    addLog("WARN", "Exam Manager", `Deleted examination #${id}`);
  };

  // Question Management actions
  const createQuestion = (examId: number, data: Partial<Question>): Question => {
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
      memory_limit: data.memory_limit || 256,
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
    setQuestions((prev) => ({
      ...prev,
      [examId]: (prev[examId] || []).map((q) => (q.id === questionId ? { ...q, ...data } : q)),
    }));
    addLog("EVENT", "Question Manager", `Updated Question #${questionId}`);
  };

  const deleteQuestion = (examId: number, questionId: number) => {
    setQuestions((prev) => ({
      ...prev,
      [examId]: (prev[examId] || []).filter((q) => q.id !== questionId),
    }));
    addLog("WARN", "Question Manager", `Deleted Question #${questionId} from Exam #${examId}`);
  };

  // Test Case Management actions
  const createTestCase = (questionId: number, data: Partial<TestCase>): TestCase => {
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
    const newSubId = 500 + submissions.length + 1;
    const initialSub: Submission = {
      id: newSubId,
      student_id: data.student_id,
      student_name: data.student_name,
      student_username: "current_user",
      question_id: data.question_id,
      question_title: data.question_title,
      exam_id: data.exam_id,
      exam_title: data.exam_title,
      language: data.language,
      source_code: data.source_code,
      status: "queued",
      score: null,
      max_score: 30,
      submitted_at: new Date().toISOString(),
    };

    setSubmissions((prev) => [initialSub, ...prev]);

    addNotification({
      title: "Submission Received",
      message: `Solution #${newSubId} for "${data.question_title}" is queued in Piston sandbox.`,
      type: "submission",
      priority: "info",
    });

    addLog(
      "SUBMISSION",
      data.student_name,
      `Submitted solution #${newSubId} for "${data.question_title}" (${data.language}). Queued.`
    );

    setTimeout(() => {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === newSubId ? { ...s, status: "running" } : s))
      );
      addLog("INFO", "Grading Worker", `Submission #${newSubId} compiling in container sandbox...`);
    }, 1200);

    setTimeout(() => {
      const isPassed = Math.random() > 0.15;
      const score = isPassed ? 30 : 15;
      const gradedSub: Submission = {
        ...initialSub,
        status: "completed",
        score: score,
        graded_at: new Date().toISOString(),
        test_results: [
          {
            id: 9901,
            submission_id: newSubId,
            test_case_id: 1,
            is_sample: true,
            passed: 1,
            stdout: "Sample Output: Passed\n",
            time: 0.12,
            memory: 14.8,
          },
          {
            id: 9902,
            submission_id: newSubId,
            test_case_id: 2,
            is_sample: true,
            passed: 1,
            stdout: "Sample Output 2: Passed\n",
            time: 0.11,
            memory: 14.2,
          },
          {
            id: 9903,
            submission_id: newSubId,
            test_case_id: 3,
            is_sample: false,
            passed: isPassed ? 1 : 0,
            time: 0.15,
            memory: 15.1,
          },
        ],
      };

      setSubmissions((prev) => prev.map((s) => (s.id === newSubId ? gradedSub : s)));

      addNotification({
        title: "Grading Completed",
        message: `Submission #${newSubId} finished evaluation: ${score} / 30 points awarded.`,
        type: "submission",
        priority: isPassed ? "info" : "warning",
      });

      addLog(
        "SUBMISSION",
        "Piston Grader",
        `Submission #${newSubId} evaluated: ${score}/30. Status: COMPLETED.`
      );
    }, 3200);

    return initialSub;
  };

  const regradeSubmission = (id: number) => {
    setSubmissions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "running" } : s))
    );
    addLog("INFO", "Admin Trigger", `Teacher triggered manual re-grade for submission #${id}`);

    setTimeout(() => {
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: "completed",
                score: s.max_score,
                graded_at: new Date().toISOString(),
              }
            : s
        )
      );
      addNotification({
        title: "Re-grade Completed",
        message: `Submission #${id} re-evaluated with full score.`,
        type: "system",
      });
      addLog("SUBMISSION", "Piston Grader", `Re-grade completed for #${id}. Score: 100%`);
    }, 2000);
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

        // Exam & Questions Management
        exams,
        createExam,
        updateExam,
        setExamStatus,
        deleteExam,
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
