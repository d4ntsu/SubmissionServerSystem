"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { ExamVerificationModal } from "@/components/exam/ExamVerificationModal";
import { useSocket } from "@/lib/socket-context";
import { CodingLanguage, Question, TestCase, QuestionType, ExamStatus } from "@/types";
import {
  FileCode2,
  Plus,
  Play,
  Square,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronDown,
  Layers,
  Code2,
  Terminal,
  Cpu,
  Clock,
  CheckCircle2,
  X,
  Sparkles,
  HelpCircle,
  Eye,
  EyeOff,
  AlertTriangle,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";

export default function TeacherQuestionsManagementPage() {
  const params = useParams();
  const examId = Number(params?.id) || 1;
  const {
    exams,
    setExamStatus,
    questions,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    testCases,
    createTestCase,
    deleteTestCase,
    examVerifications,
  } = useSocket();

  const exam = exams.find((e) => e.id === examId) || exams[0];
  const examQuestions = questions[examId] || [];
  const [verificationOpen, setVerificationOpen] = useState(false);

  const startExam = () => {
    if (!exam) return;
    if (!examVerifications[exam.id]?.passed) {
      setVerificationOpen(true);
      return;
    }
    setExamStatus(exam.id, "started");
  };

  const openExamFromVerification = () => {
    if (!exam) return;
    setExamStatus(exam.id, "started");
    setVerificationOpen(false);
  };

  // Modal State for Create / Edit Question
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qTitle, setQTitle] = useState("");
  const [qDesc, setQDesc] = useState("");
  const [qBoilerplate, setQBoilerplate] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [qPoints, setQPoints] = useState(30);
  const [qType, setQType] = useState<QuestionType>("STDIN_STDOUT");
  const [qLanguage, setQLanguage] = useState<CodingLanguage>("java");
  const [qTimeLimit, setQTimeLimit] = useState(2);
  const [qShowResult, setQShowResult] = useState(true);
  // Java class/method specs
  const [qClassName, setQClassName] = useState("Solution");
  const [qMethodName, setQMethodName] = useState("solve");
  const [qMethodMode, setQMethodMode] = useState<"STATIC" | "INSTANCE">("STATIC");
  const [qReturnType, setQReturnType] = useState("int");
  const [qParamTypes, setQParamTypes] = useState("int, int");

  // Modal State for Test Case creation
  const [isTestCaseModalOpen, setIsTestCaseModalOpen] = useState(false);
  const [activeQuestionIdForTc, setActiveQuestionIdForTc] = useState<number | null>(null);
  const [tcIsSample, setTcIsSample] = useState(true);
  const [tcWeight, setTcWeight] = useState(10);
  const [tcStdin, setTcStdin] = useState("");
  const [tcExpectedStdout, setTcExpectedStdout] = useState("");
  const [tcArgs, setTcArgs] = useState("");
  const [tcExpectedReturn, setTcExpectedReturn] = useState("");
  const [tcError, setTcError] = useState("");

  const openAddQuestion = () => {
    setEditingQuestion(null);
    setQTitle(`Problem ${examQuestions.length + 1}: `);
    setQDesc("");
    setQBoilerplate("");
    setQuestionError("");
    setQPoints(30);
    setQType("STDIN_STDOUT");
    setQLanguage("java");
    setQTimeLimit(2);
    setQShowResult(true);
    setQClassName("Solution");
    setQMethodName("solve");
    setQMethodMode("STATIC");
    setQReturnType("int");
    setQParamTypes("int, int");
    setIsQuestionModalOpen(true);
  };

  const openEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setQTitle(q.title);
    setQDesc(q.description);
    setQBoilerplate(q.boilerplate ?? "");
    setQuestionError("");
    setQPoints(q.points);
    setQType(q.question_type);
    setQLanguage(q.language || "java");
    setQTimeLimit(q.time_limit);
    setQShowResult(q.show_result_to_student ?? true);
    setQClassName(q.class_name || "Solution");
    setQMethodName(q.method_name || "solve");
    setQMethodMode(q.method_mode || "STATIC");
    setQReturnType(q.return_type || "int");
    setQParamTypes(q.parameter_types ?? "");
    setIsQuestionModalOpen(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qTitle.trim()) return;
    setQuestionError("");

    try {
      if (editingQuestion) {
        await updateQuestion(examId, editingQuestion.id, {
          title: qTitle,
          description: qDesc,
          boilerplate: qBoilerplate,
          points: Number(qPoints),
          question_type: qType,
          language: qType === "JAVA_CLASS_METHOD" ? "java" : qLanguage,
          time_limit: Number(qTimeLimit),
          show_result_to_student: qShowResult,
          class_name: qType === "JAVA_CLASS_METHOD" ? qClassName : null,
          method_name: qType === "JAVA_CLASS_METHOD" ? qMethodName : null,
          method_mode: qType === "JAVA_CLASS_METHOD" ? qMethodMode : null,
          return_type: qType === "JAVA_CLASS_METHOD" ? qReturnType : null,
          parameter_types: qType === "JAVA_CLASS_METHOD" ? qParamTypes : null,
        });
      } else {
        await createQuestion(examId, {
          title: qTitle,
          description: qDesc,
          boilerplate: qBoilerplate,
          points: Number(qPoints),
          question_type: qType,
          language: qType === "JAVA_CLASS_METHOD" ? "java" : qLanguage,
          time_limit: Number(qTimeLimit),
          show_result_to_student: qShowResult,
          class_name: qType === "JAVA_CLASS_METHOD" ? qClassName : null,
          method_name: qType === "JAVA_CLASS_METHOD" ? qMethodName : null,
          method_mode: qType === "JAVA_CLASS_METHOD" ? qMethodMode : null,
          return_type: qType === "JAVA_CLASS_METHOD" ? qReturnType : null,
          parameter_types: qType === "JAVA_CLASS_METHOD" ? qParamTypes : null,
        });
      }

      setIsQuestionModalOpen(false);
    } catch (error) {
      setQuestionError(
        error instanceof Error ? error.message : "The question could not be saved."
      );
    }
  };

  const openAddTestCase = (questionId: number) => {
    setActiveQuestionIdForTc(questionId);
    setTcIsSample(true);
    setTcWeight(10);
    setTcStdin("");
    setTcExpectedStdout("");
    setTcArgs("");
    setTcExpectedReturn("");
    setTcError("");
    setIsTestCaseModalOpen(true);
  };

  const activeTestCaseQuestion = examQuestions.find(
    (question) => question.id === activeQuestionIdForTc
  );

  const handleSaveTestCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuestionIdForTc) return;

    const expected =
      activeTestCaseQuestion?.question_type === "JAVA_CLASS_METHOD"
        ? tcExpectedReturn.trim()
        : tcExpectedStdout.trim();

    if (!expected) {
      setTcError(
        activeTestCaseQuestion?.question_type === "JAVA_CLASS_METHOD"
          ? "The expected return value is required. Without it the grader cannot detect a wrong answer."
          : "The expected output is required. Without it the grader cannot detect a wrong answer."
      );
      return;
    }

    createTestCase(activeQuestionIdForTc, {
      is_sample: tcIsSample,
      weight: Number(tcWeight),
      stdin: tcStdin,
      expected_stdout: tcExpectedStdout,
      arguments: tcArgs,
      expected_return: tcExpectedReturn,
    });

    setIsTestCaseModalOpen(false);
  };

  return (
    <ProtectedRoute requireTeacher={true}>
      <AppLayout>
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <li>
              <Link href="/teacher/exams" className="hover:text-orange-600 transition-colors">
                Exams Management
              </Link>
            </li>
            <li>/</li>
            <li className="text-slate-800 font-bold font-mono">
              Exam #{exam?.id || examId}: {exam?.title}
            </li>
            <li>/</li>
            <li className="text-orange-600 font-bold font-mono">Questions & Test Cases</li>
          </ol>
        </nav>

        {/* Centralized Boxed Container */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header Bar with Lifecycle Status and Actions */}
          <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 font-mono">
                  EXAMINATION WORKBENCH
                </span>
                <span
                  className={`text-[9px] font-bold font-mono uppercase px-2 py-0.5 rounded ${
                    exam?.status === "started"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse"
                      : exam?.status === "published"
                      ? "bg-blue-100 text-blue-800 border border-blue-200"
                      : exam?.status === "ended"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {exam?.status === "started" ? "● LIVE (STARTED)" : exam?.status}
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                {exam?.title}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {exam?.questions_count || examQuestions.length} Problems Configured • {exam?.total_points} Total Points • {exam?.duration_minutes} Mins
              </p>
            </div>

            {/* Actions: Add Question & Exam Status Quick Switch */}
            <div className="flex items-center gap-2 flex-wrap">
              {exam && (
                <button
                  onClick={() => setVerificationOpen(true)}
                  className={`px-3 py-1.5 font-bold text-xs rounded shadow-xs flex items-center gap-1.5 border ${
                    examVerifications[exam.id]?.passed
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                      : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                  }`}
                  title="Check test data and grader configuration before opening the exam"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>
                    {examVerifications[exam.id]?.passed ? "Test Again" : "Test Exam"}
                  </span>
                  {examVerifications[exam.id]?.passed && (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              {exam?.status === "draft" && (
                <button
                  onClick={() => setExamStatus(exam.id, "published")}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded shadow-xs"
                >
                  Publish Exam
                </button>
              )}
              {exam?.status === "published" && (
                <button
                  onClick={startExam}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs flex items-center gap-1.5"
                  title={
                    exam && examVerifications[exam.id]?.passed
                      ? "Start exam and open code submissions"
                      : "Verify the exam before opening it to all students"
                  }
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Start Exam Now</span>
                </button>
              )}
              {exam?.status === "started" && (
                <button
                  onClick={() => setExamStatus(exam.id, "ended")}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded shadow-xs flex items-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5 fill-white" />
                  <span>End Exam (Lock Submissions)</span>
                </button>
              )}

              <button
                onClick={openAddQuestion}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Question</span>
              </button>
            </div>
          </div>

          {/* Questions List */}
          <div className="space-y-6">
            {examQuestions.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg space-y-3">
                <FileCode2 className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="text-sm font-bold text-slate-700">No Questions Configured Yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Click "Add New Question" above to configure programming requirements, limits, and test cases.
                </p>
                <button
                  onClick={openAddQuestion}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded"
                >
                  Create First Question
                </button>
              </div>
            ) : (
              examQuestions.map((question, qIdx) => {
                const qTestCases = testCases[question.id] || [];
                const sampleCount = qTestCases.filter((tc) => tc.is_sample).length;
                const hiddenCount = qTestCases.filter((tc) => !tc.is_sample).length;

                return (
                  <div
                    key={question.id}
                    className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs"
                  >
                    {/* Question Item Header */}
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold font-mono uppercase bg-slate-900 text-white px-2 py-0.5 rounded">
                            Q{qIdx + 1}
                          </span>
                          <span className="text-[10px] font-bold font-mono uppercase bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded">
                            {question.question_type}
                          </span>
                          <span className="text-xs font-bold text-slate-800 font-mono">
                            {question.points} Points
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-slate-900">
                          {question.title}
                        </h2>
                      </div>

                      {/* Header Actions */}
                      <div className="flex items-center gap-2 font-mono">
                        <button
                          onClick={() => openEditQuestion(question)}
                          className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded text-xs font-sans font-semibold flex items-center gap-1 hover:bg-slate-50 transition-colors"
                        >
                          <Edit2 className="w-3 h-3 text-slate-400" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete Question #${question.id}?`)) {
                              deleteQuestion(examId, question.id);
                            }
                          }}
                          className="px-2.5 py-1 text-red-600 hover:text-red-700 bg-white border border-slate-200 rounded text-xs font-sans font-semibold hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Question Details Body */}
                    <div className="p-5 space-y-4 text-xs font-sans">
                      {/* Resource limits */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono text-[11px] text-slate-600">
                        <div>Time Limit: <strong className="text-slate-800">{question.time_limit}s</strong></div>
                        <div>Language: <strong className="text-slate-800 uppercase">{question.language}</strong></div>
                        <div>Sample Tests: <strong className="text-slate-800">{sampleCount}</strong></div>
                        <div>Hidden Tests: <strong className="text-slate-800">{hiddenCount}</strong></div>
                        <div>
                          Results:{" "}
                          <strong className={question.show_result_to_student === false ? "text-red-600" : "text-emerald-600"}>
                            {question.show_result_to_student === false ? "Hidden" : "Visible"}
                          </strong>
                        </div>
                      </div>

                      {(() => {
                        const hasMissingAnswer =
                          qTestCases.length === 0 ||
                          qTestCases.some((testCase) =>
                            question.question_type === "JAVA_CLASS_METHOD"
                              ? !testCase.expected_return?.trim()
                              : !testCase.expected_stdout?.trim()
                          );
                        if (!hasMissingAnswer) return null;
                        return (
                          <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <div>
                              <strong className="block">Logical grading is incomplete</strong>
                              <span>
                                {qTestCases.length === 0
                                  ? "No test cases are configured. Student submissions will fail with a grading error."
                                  : "One or more test cases have no expected answer. Those answers must be added before wrong submissions can be scored correctly."}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Java Class / Method contract if applicable */}
                      {question.question_type === "JAVA_CLASS_METHOD" && (
                        <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1 font-mono text-[11px]">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">
                            Java Reflection Signature Contract:
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>Class: <strong>{question.class_name}</strong></div>
                            <div>Method: <strong>{question.method_name}</strong></div>
                            <div>Return: <strong>{question.return_type}</strong></div>
                            <div>Params: <strong>{question.parameter_types}</strong></div>
                          </div>
                        </div>
                      )}

                      {/* Description Preview */}
                      <div className="bg-white p-3 rounded border border-slate-100">
                        <MarkdownRenderer content={question.description} />
                      </div>

                      {/* Test Cases Sub-Section */}
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                            Test Cases ({qTestCases.length} total)
                          </span>
                          <button
                            onClick={() => openAddTestCase(question.id)}
                            className="text-xs text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1 font-mono"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Test Case</span>
                          </button>
                        </div>

                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                          {qTestCases.length === 0 ? (
                            <div className="p-3 text-slate-400 italic text-[11px] text-center font-mono">
                              No test cases added. Click "Add Test Case" to configure sample and hidden evaluations.
                            </div>
                          ) : (
                            qTestCases.map((tc, tcIdx) => (
                              <div
                                key={tc.id}
                                className="p-3 flex items-start justify-between gap-4 text-xs font-mono"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800">
                                      Case #{tcIdx + 1}
                                    </span>
                                    <span
                                      className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded ${
                                        tc.is_sample
                                          ? "bg-blue-100 text-blue-800"
                                          : "bg-purple-100 text-purple-800"
                                      }`}
                                    >
                                      {tc.is_sample ? "Visible Sample" : "Hidden Proctor Secret"}
                                    </span>
                                    <span className="text-slate-500 text-[11px]">
                                      {tc.weight} Points
                                    </span>
                                  </div>

                                  {tc.stdin && (
                                    <div className="text-[11px] text-slate-600">
                                      <span className="text-slate-400">Stdin:</span> {tc.stdin}
                                    </div>
                                  )}
                                  {tc.expected_stdout && (
                                    <div className="text-[11px] text-slate-600">
                                      <span className="text-slate-400">Expected:</span> {tc.expected_stdout}
                                    </div>
                                  )}
                                  {tc.arguments && (
                                    <div className="text-[11px] text-slate-600">
                                      <span className="text-slate-400">Args:</span> {tc.arguments} ➔ {tc.expected_return}
                                    </div>
                                  )}
                                </div>

                                <button
                                  onClick={() => deleteTestCase(question.id, tc.id)}
                                  className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-slate-200 transition-colors"
                                  title="Remove test case"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal: Create or Edit Question */}
        {isQuestionModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    {editingQuestion ? "UPDATE PROBLEM SPECIFICATION" : "NEW QUESTION DESIGN"}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingQuestion ? `Edit Question: ${editingQuestion.title}` : "Create Programming Question"}
                  </h3>
                </div>
                <button
                  onClick={() => setIsQuestionModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveQuestion} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs font-sans">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                      Problem Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={qTitle}
                      onChange={(e) => setQTitle(e.target.value)}
                      placeholder="e.g. Problem 1: Reverse Words"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                      Question Points *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={100}
                      value={qPoints}
                      onChange={(e) => setQPoints(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                    />
                  </div>
                </div>

                {/* Question Type Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Grading & Question Mode *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setQType("STDIN_STDOUT")}
                      className={`p-3 rounded border text-left transition-all ${
                        qType === "STDIN_STDOUT"
                          ? "border-orange-500 bg-orange-50/50 shadow-xs"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-orange-500" />
                        Standard I/O (STDIN_STDOUT)
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Reads standard input stream and checks standard output lines.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setQType("JAVA_CLASS_METHOD");
                        setQLanguage("java");
                      }}
                      className={`p-3 rounded border text-left transition-all ${
                        qType === "JAVA_CLASS_METHOD"
                          ? "border-orange-500 bg-orange-50/50 shadow-xs"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5 text-orange-500" />
                        Java Class/Method (Reflection)
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Invokes specific Java methods and tests return values directly.
                      </p>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Programming Language (locked for students) *
                  </label>
                  <select
                    value={qType === "JAVA_CLASS_METHOD" ? "java" : qLanguage}
                    onChange={(e) => setQLanguage(e.target.value as CodingLanguage)}
                    disabled={qType === "JAVA_CLASS_METHOD"}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono disabled:opacity-70"
                  >
                    <option value="java">Java 15.0.2</option>
                    <option value="python">Python 3.10</option>
                  </select>
                  <p className="mt-1 text-[10px] text-slate-400">
                    The student cannot change the language during the test. Java class/method
                    questions always use Java.
                  </p>
                </div>

                {/* Java Method Spec Fields if JAVA_CLASS_METHOD */}
                {qType === "JAVA_CLASS_METHOD" && (
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3 font-mono">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Java Reflection Verification Contract:
                    </span>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Required Class Name</label>
                        <input
                          type="text"
                          required
                          value={qClassName}
                          onChange={(e) => setQClassName(e.target.value)}
                          placeholder="e.g. Calculator"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Required Method Name</label>
                        <input
                          type="text"
                          required
                          value={qMethodName}
                          onChange={(e) => setQMethodName(e.target.value)}
                          placeholder="e.g. evaluateExpression"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Method Mode</label>
                        <select
                          value={qMethodMode}
                          onChange={(e) => setQMethodMode(e.target.value as any)}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded"
                        >
                          <option value="STATIC">STATIC</option>
                          <option value="INSTANCE">INSTANCE</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Return Type</label>
                        <input
                          type="text"
                          required
                          value={qReturnType}
                          onChange={(e) => setQReturnType(e.target.value)}
                          placeholder="e.g. int, String, boolean"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Parameter Types</label>
                        <input
                          type="text"
                          value={qParamTypes}
                          onChange={(e) => setQParamTypes(e.target.value)}
                          placeholder="e.g. int[] or int, String"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded"
                        />
                        <p className="mt-1 text-[10px] text-slate-500">
                          Enter parameter types in order, comma-separated. Use int[] for one integer-array parameter.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Student Boilerplate
                  </label>
                  <textarea
                    rows={10}
                    spellCheck={false}
                    value={qBoilerplate}
                    onChange={(e) => setQBoilerplate(e.target.value)}
                    placeholder="Optional starter code shown to students. Leave blank for an empty editor."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 resize-y font-mono text-xs leading-relaxed"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Students receive this code on first open and when they Reset. Existing student
                    code is preserved.{" "}
                    {qType === "JAVA_CLASS_METHOD" &&
                      "The grader generates a hidden Main.java runner; provide only the class and method here."}
                  </p>
                </div>

                {/* Resource Limits */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    CPU Time Limit (Seconds) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={10}
                    value={qTimeLimit}
                    onChange={(e) => setQTimeLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 font-mono"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Memory limits are managed automatically by the execution sandbox and are no
                    longer configured per question.
                  </p>
                </div>

                {/* Result Visibility */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-200">
                  <div className="flex items-start gap-2.5">
                    {qShowResult ? (
                      <Eye className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <span className="font-bold text-slate-800 text-xs block">
                        Show Final Result to Student
                      </span>
                      <span className="text-[10px] text-slate-500">
                        When disabled, students can submit code but cannot view the score, verdict, or test breakdown for this question.
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={qShowResult}
                    onChange={(e) => setQShowResult(e.target.checked)}
                    className="w-4 h-4 accent-orange-500 rounded shrink-0"
                  />
                </div>

                {/* Markdown Description */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Problem Requirements & Constraints (Markdown Supported) *
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={qDesc}
                    onChange={(e) => setQDesc(e.target.value)}
                    placeholder={"Write detailed problem explanation, input format, and output specifications...\n\nMarkdown is supported: **bold**, `inline code`, - bullet lists, ### headings, tables, and $...$ for math."}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-900 resize-none font-sans font-mono text-[11px] leading-relaxed"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Supports Markdown and LaTeX math wrapped in <code className="rounded bg-slate-100 px-1">$...$</code>.
                  </p>

                  <div className="mt-2 rounded border border-slate-200 bg-white p-3">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                      Live Preview
                    </span>
                    <MarkdownRenderer content={qDesc} />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  {questionError && (
                    <p role="alert" className="mr-auto text-xs text-red-700">
                      {questionError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsQuestionModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold text-xs rounded hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs"
                  >
                    {editingQuestion ? "Save Question Updates" : "Create Question"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Add Test Case */}
        {isTestCaseModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    TEST CASE EVALUATION CONFIG
                  </span>
                  <h3 className="text-sm font-bold text-slate-900">Add Test Case</h3>
                </div>
                <button
                  onClick={() => setIsTestCaseModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveTestCase} className="p-5 space-y-4 text-xs font-sans">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-200">
                  <div>
                    <span className="font-bold text-slate-800 text-xs block">Visible Sample Test Case</span>
                    <span className="text-[10px] text-slate-500">
                      If checked, candidate can view this input and output in the problem statement.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={tcIsSample}
                    onChange={(e) => setTcIsSample(e.target.checked)}
                    className="w-4 h-4 accent-orange-500 rounded"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                    Points Weight *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={50}
                    value={tcWeight}
                    onChange={(e) => setTcWeight(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded font-mono"
                  />
                </div>

                {activeTestCaseQuestion?.question_type === "JAVA_CLASS_METHOD" ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                        Method Arguments
                      </label>
                      <textarea
                        rows={2}
                        value={tcArgs}
                        onChange={(e) => {
                          setTcArgs(e.target.value);
                          setTcError("");
                        }}
                        placeholder="For int[] numbers: new int[]{12, 35, 1} or [[12,35,1]]"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                        Expected Return Value *
                      </label>
                      <textarea
                        rows={2}
                        required
                        value={tcExpectedReturn}
                        onChange={(e) => {
                          setTcExpectedReturn(e.target.value);
                          setTcError("");
                        }}
                        placeholder="Expected return value (e.g. 15)"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                        Standard Input (Stdin)
                      </label>
                      <textarea
                        rows={2}
                        value={tcStdin}
                        onChange={(e) => {
                          setTcStdin(e.target.value);
                          setTcError("");
                        }}
                        placeholder="Input fed to stdin (e.g. 5\n10)"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase font-mono mb-1">
                        Expected Output (Stdout) *
                      </label>
                      <textarea
                        rows={2}
                        required
                        value={tcExpectedStdout}
                        onChange={(e) => {
                          setTcExpectedStdout(e.target.value);
                          setTcError("");
                        }}
                        placeholder="Expected standard output (e.g. 15)"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>
                  </>
                )}

                {tcError && (
                  <div className="rounded border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{tcError}</span>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTestCaseModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold text-xs rounded hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded shadow-xs"
                  >
                    Add Test Case
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ExamVerificationModal
          examId={exam?.id ?? examId}
          isOpen={verificationOpen}
          onClose={() => setVerificationOpen(false)}
          onOpenExam={openExamFromVerification}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}
