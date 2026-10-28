import { Exam, Question, TestCase, Submission, User, UserRole, Announcement, StudentClientStatus, RealtimeEventLog, ExamStatus, CodingLanguage, QuestionType } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Mock Fallback Data to ensure offline LMS presentation & resilience
export const MOCK_USER_TEACHER: User = {
  id: 1,
  username: "prof_alan",
  full_name: "Dr. Alan Turing (Teacher)",
  role: "teacher",
};

export const MOCK_USER_STUDENT: User = {
  id: 101,
  username: "student_john",
  full_name: "John Doe (SV101)",
  role: "student",
};

export const DEMO_CREDENTIALS: Record<UserRole, { username: string; password: string }> = {
  student: { username: "student_john", password: "password123" },
  teacher: { username: "prof_alan", password: "password123" },
};

export function isValidDemoCredentials(
  username: string,
  password: string,
  role: UserRole
): boolean {
  const expected = DEMO_CREDENTIALS[role];
  return username === expected.username && password === expected.password;
}

export interface LoginResult {
  access_token: string;
  token_type?: string;
}

export type ApiErrorKind = "http" | "network" | "invalid_response";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLoginResult(value: unknown): value is LoginResult {
  return isRecord(value) && typeof value.access_token === "string" && value.access_token.length > 0;
}

function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.username === "string" &&
    typeof value.full_name === "string" &&
    (value.role === "student" || value.role === "teacher")
  );
}

function httpError(action: string, response: Response): ApiError {
  return new ApiError(
    `${action} failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
    "http",
    response.status
  );
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(`${action} returned an invalid response.`, "invalid_response", response.status);
  }
}

export async function loginRequest(
  username: string,
  password: string
): Promise<LoginResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw httpError("Login", res);
    const data: unknown = await readJson(res, "Login");
    if (!isLoginResult(data)) {
      throw new ApiError("Login returned an invalid response.", "invalid_response", res.status);
    }
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Login could not reach the backend. Check the connection and retry.", "network");
  }
}

export async function fetchCurrentUser(token: string): Promise<User> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw httpError("Session verification", res);
    const data: unknown = await readJson(res, "Session verification");
    if (!isUser(data)) {
      throw new ApiError(
        "Session verification returned an invalid user profile.",
        "invalid_response",
        res.status
      );
    }
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      "Session verification could not reach the backend. Check the connection and retry.",
      "network"
    );
  }
}

export const MOCK_EXAMS: Exam[] = [
  {
    id: 1,
    title: "CS201: Data Structures & Java Algorithms Final",
    description: "Official 90-minute midterm programming exam. Implements Java Array and Class Methods with strict constraints.",
    teacher_id: 1,
    start_time: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    end_time: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    duration_minutes: 90,
    status: "started",
    questions_count: 3,
    total_points: 100,
  },
  {
    id: 2,
    title: "CS102: Object-Oriented Programming Lab 4",
    description: "Standard input/output and Object methods evaluation on string manipulation and array sorting.",
    teacher_id: 1,
    start_time: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    end_time: new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString(),
    duration_minutes: 120,
    status: "published",
    questions_count: 2,
    total_points: 100,
  },
  {
    id: 3,
    title: "CS101: Introduction to Programming Practice",
    description: "Archived practice session with solved standard test cases.",
    teacher_id: 1,
    start_time: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    end_time: new Date(Date.now() - 1000 * 60 * 60 * 46).toISOString(),
    duration_minutes: 60,
    status: "ended",
    questions_count: 2,
    total_points: 50,
  },
];

export const MOCK_QUESTIONS: Record<number, Question[]> = {
  1: [
    {
      id: 101,
      exam_id: 1,
      title: "Problem 1: Reverse Words in Sentence",
      description: `Write a program that reads an integer $N$ followed by $N$ lines of text. For each line, output the words in reversed order separated by a single space.\n\n### Input Format\n- First line: integer $N$ ($1 \\le N \\le 100$)\n- Next $N$ lines: a string of whitespace-separated words.\n\n### Output Format\n- $N$ lines with words reversed.`,
      points: 30,
      question_type: "STDIN_STDOUT",
      language: "java",
      time_limit: 2,
      show_result_to_student: true,
    },
    {
      id: 102,
      exam_id: 1,
      title: "Problem 2: Calculator Class & Math Methods",
      description: `Implement a Java class named **\`Calculator\`** with the method **\`int evaluateExpression(String op, int a, int b)\`**.\n\n### Requirements:\n- Class name must be **\`Calculator\`**.\n- Method mode: **STATIC** or instance method.\n- Supported operations: \`"add"\`, \`"sub"\`, \`"mul"\`, \`"div"\`.\n- Handles division by zero by returning \`-1\`.`,
      points: 40,
      question_type: "JAVA_CLASS_METHOD",
      class_name: "Calculator",
      method_name: "evaluateExpression",
      method_mode: "STATIC",
      return_type: "int",
      parameter_types: "String, int, int",
      time_limit: 3,
      language: "java",
      show_result_to_student: true,
    },
    {
      id: 103,
      exam_id: 1,
      title: "Problem 3: Finding Prime Factors",
      description: `Given a positive integer $K$, print all prime factors of $K$ in ascending order separated by a space.\n\n### Input\n- A single integer $K$ ($2 \\le 10^7$).\n\n### Output\n- The prime factors separated by space.`,
      points: 30,
      question_type: "STDIN_STDOUT",
      language: "java",
      time_limit: 2,
      show_result_to_student: true,
    },
  ],
};

export const MOCK_TEST_CASES: Record<number, TestCase[]> = {
  101: [
    {
      id: 1,
      question_id: 101,
      is_sample: true,
      weight: 10,
      stdin: "2\nHello World\nJava Socket Exam",
      expected_stdout: "World Hello\nExam Socket Java",
    },
    {
      id: 2,
      question_id: 101,
      is_sample: true,
      weight: 10,
      stdin: "1\nAntigravity AI Assistant",
      expected_stdout: "Assistant AI Antigravity",
    },
    {
      id: 3,
      question_id: 101,
      is_sample: false,
      weight: 10,
      stdin: "[HIDDEN TEST CASE 1]",
      expected_stdout: "[HIDDEN OUTPUT]",
    },
  ],
  102: [
    {
      id: 4,
      question_id: 102,
      is_sample: true,
      weight: 15,
      arguments: '"add", 10, 25',
      expected_return: "35",
    },
    {
      id: 5,
      question_id: 102,
      is_sample: true,
      weight: 15,
      arguments: '"mul", 6, 7',
      expected_return: "42",
    },
    {
      id: 6,
      question_id: 102,
      is_sample: false,
      weight: 10,
      arguments: "[HIDDEN ARGUMENTS]",
      expected_return: "[HIDDEN RETURN]",
    },
  ],
  103: [
    {
      id: 7,
      question_id: 103,
      is_sample: true,
      weight: 10,
      stdin: "12",
      expected_stdout: "2 2 3",
    },
    {
      id: 8,
      question_id: 103,
      is_sample: true,
      weight: 10,
      stdin: "100",
      expected_stdout: "2 2 5 5",
    },
    {
      id: 9,
      question_id: 103,
      is_sample: false,
      weight: 10,
      stdin: "[HIDDEN TEST CASE 2]",
      expected_stdout: "[HIDDEN OUTPUT]",
    },
  ],
};

export const MOCK_SUBMISSIONS: Submission[] = [
  {
    id: 501,
    student_id: 101,
    student_name: "John Doe",
    student_username: "student_john",
    question_id: 101,
    question_title: "Problem 1: Reverse Words in Sentence",
    exam_id: 1,
    exam_title: "CS201: Data Structures & Java Algorithms Final",
    language: "java",
    source_code: `import java.util.Scanner;

public class Solution {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        if (!sc.hasNextInt()) return;
        int n = sc.nextInt();
        sc.nextLine();
        for (int i = 0; i < n; i++) {
            String line = sc.nextLine().trim();
            String[] words = line.split("\\\\s+");
            StringBuilder sb = new StringBuilder();
            for (int j = words.length - 1; j >= 0; j--) {
                sb.append(words[j]);
                if (j > 0) sb.append(" ");
            }
            System.out.println(sb.toString());
        }
    }
}`,
    status: "completed",
    score: 30,
    max_score: 30,
    submitted_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    graded_at: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    test_results: [
      {
        id: 901,
        submission_id: 501,
        test_case_id: 1,
        is_sample: true,
        passed: 1,
        input_data: "2\nHello World\nJava Socket Exam",
        expected_output: "World Hello\nExam Socket Java",
        stdout: "World Hello\nExam Socket Java\n",
        awarded_points: 10,
        score_weight: 10,
        time: 0.12,
        memory: 14.5,
      },
      {
        id: 902,
        submission_id: 501,
        test_case_id: 2,
        is_sample: true,
        passed: 1,
        input_data: "1\nAntigravity AI Assistant",
        expected_output: "Assistant AI Antigravity",
        stdout: "Assistant AI Antigravity\n",
        awarded_points: 10,
        score_weight: 10,
        time: 0.11,
        memory: 14.2,
      },
      {
        id: 903,
        submission_id: 501,
        test_case_id: 3,
        is_sample: false,
        passed: 1,
        expected_output: "[HIDDEN OUTPUT]",
        awarded_points: 10,
        score_weight: 10,
        time: 0.14,
        memory: 15.0,
      },
    ],
  },
  {
    id: 502,
    student_id: 102,
    student_name: "Alice Smith",
    student_username: "alice_s",
    question_id: 102,
    question_title: "Problem 2: Calculator Class & Math Methods",
    exam_id: 1,
    exam_title: "CS201: Data Structures & Java Algorithms Final",
    language: "java",
    source_code: `public class Calculator {
    public static int evaluateExpression(String op, int a, int b) {
        if ("add".equalsIgnoreCase(op)) return a + b;
        if ("sub".equalsIgnoreCase(op)) return a - b;
        if ("mul".equalsIgnoreCase(op)) return a * b;
        if ("div".equalsIgnoreCase(op)) {
            if (b == 0) return -1;
            return a / b;
        }
        return -1;
    }
}`,
    status: "completed",
    score: 40,
    max_score: 40,
    submitted_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    graded_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    test_results: [
      {
        id: 904,
        submission_id: 502,
        test_case_id: 4,
        is_sample: true,
        passed: 1,
        input_data: '"add", 10, 25',
        expected_output: "35",
        stdout: "35\n",
        awarded_points: 15,
        score_weight: 15,
        time: 0.15,
        memory: 18.0,
      },
      {
        id: 905,
        submission_id: 502,
        test_case_id: 5,
        is_sample: true,
        passed: 1,
        input_data: '"mul", 6, 7',
        expected_output: "42",
        stdout: "42\n",
        awarded_points: 15,
        score_weight: 15,
        time: 0.13,
        memory: 17.8,
      },
      {
        id: 906,
        submission_id: 502,
        test_case_id: 6,
        is_sample: false,
        passed: 1,
        expected_output: "[HIDDEN RETURN]",
        awarded_points: 10,
        score_weight: 10,
        time: 0.16,
        memory: 18.2,
      },
    ],
  },
  {
    id: 503,
    student_id: 103,
    student_name: "Bob Martin",
    student_username: "bob_m",
    question_id: 101,
    question_title: "Problem 1: Reverse Words in Sentence",
    exam_id: 1,
    exam_title: "CS201: Data Structures & Java Algorithms Final",
    language: "java",
    source_code: `public class Solution {
    public static void main(String[] args) {
        // syntax error demo
        System.out.println("Missing closing semicolon"
    }
}`,
    status: "error",
    score: 0,
    max_score: 30,
    submitted_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    graded_at: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    error_summary: "Compilation Error: ';' expected at line 4",
    test_results: [],
  },
  {
    id: 504,
    student_id: 104,
    student_name: "Emily Watson",
    student_username: "emily_w",
    question_id: 102,
    question_title: "Problem 2: Calculator Class & Math Methods",
    exam_id: 1,
    exam_title: "CS201: Data Structures & Java Algorithms Final",
    language: "java",
    source_code: `public class Calculator {
    public static int evaluateExpression(String op, int a, int b) {
        if ("add".equalsIgnoreCase(op)) return a + b;
        if ("sub".equalsIgnoreCase(op)) return a - b;
        if ("mul".equalsIgnoreCase(op)) return a * b;
        if ("div".equalsIgnoreCase(op)) {
            if (b == 0) return -1;
            return a / b;
        }
        return -1;
    }
}`,
    status: "completed",
    score: 15,
    max_score: 40,
    submitted_at: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    graded_at: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    test_results: [
      {
        id: 907,
        submission_id: 504,
        test_case_id: 4,
        is_sample: true,
        passed: 1,
        input_data: '"add", 10, 25',
        expected_output: "35",
        stdout: "35\n",
        awarded_points: 15,
        score_weight: 15,
        time: 0.14,
        memory: 16.5,
      },
      {
        id: 908,
        submission_id: 504,
        test_case_id: 5,
        is_sample: true,
        passed: 0,
        input_data: '"mul", 6, 7',
        expected_output: "42",
        stdout: "13\n",
        awarded_points: 0,
        score_weight: 15,
        message: "Stale grader result: expected 42 but received 13. Re-evaluate to re-run grading.",
        time: 0.15,
        memory: 16.2,
      },
    ],
  },
  {
    id: 505,
    student_id: 105,
    student_name: "David Kim",
    student_username: "david_k",
    question_id: 101,
    question_title: "Problem 1: Reverse Words in Sentence",
    exam_id: 1,
    exam_title: "CS201: Data Structures & Java Algorithms Final",
    language: "java",
    source_code: `import java.util.Scanner;\npublic class Solution { ... }`,
    status: "running",
    score: null,
    max_score: 30,
    submitted_at: new Date(Date.now() - 1000 * 15).toISOString(),
  },
];

export const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "ann-1",
    title: "Clarification on Problem 2 (Calculator)",
    message: "Students: For division by zero in Problem 2, you must return -1 instead of throwing an ArithmeticException.",
    priority: "urgent",
    target_exam_id: 1,
    target_exam_title: "CS201: Data Structures & Java Algorithms Final",
    created_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    author_name: "Dr. Alan Turing",
  },
  {
    id: "ann-2",
    title: "LAN System Stability Note",
    message: "Do not refresh your browser during code submission. Wait for the grading verdict spinner to finalize.",
    priority: "warning",
    target_exam_id: "all",
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    author_name: "Lab Administrator",
  },
  {
    id: "ann-3",
    title: "Welcome to Midterm Exam Session",
    message: "The exam window is 90 minutes. Submissions after 22:30 will be rejected automatically by the server.",
    priority: "info",
    target_exam_id: 1,
    target_exam_title: "CS201: Data Structures & Java Algorithms Final",
    created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    author_name: "Dr. Alan Turing",
  },
];

export const MOCK_STUDENTS_STATUS: StudentClientStatus[] = [
  {
    student_id: 101,
    student_name: "John Doe",
    username: "student_john",
    client_ip: "192.168.1.101",
    status: "in_exam",
    current_exam: "CS201 Final",
    current_question: "Problem 2: Calculator",
    submissions_count: 1,
    warning_count: 0,
  },
  {
    student_id: 102,
    student_name: "Alice Smith",
    username: "alice_s",
    client_ip: "192.168.1.102",
    status: "submitted",
    current_exam: "CS201 Final",
    current_question: "Reviewing Problem 3",
    submissions_count: 2,
    warning_count: 0,
  },
  {
    student_id: 103,
    student_name: "Bob Martin",
    username: "bob_m",
    client_ip: "192.168.1.103",
    status: "in_exam",
    current_exam: "CS201 Final",
    current_question: "Problem 1: Reverse Words",
    submissions_count: 1,
    warning_count: 1,
  },
  {
    student_id: 104,
    student_name: "Emily Watson",
    username: "emily_w",
    client_ip: "192.168.1.104",
    status: "in_exam",
    current_exam: "CS201 Final",
    current_question: "Problem 2: Calculator",
    submissions_count: 1,
    warning_count: 0,
  },
  {
    student_id: 105,
    student_name: "David Kim",
    username: "david_k",
    client_ip: "192.168.1.105",
    status: "in_exam",
    current_exam: "CS201 Final",
    current_question: "Problem 1: Reverse Words",
    submissions_count: 0,
    warning_count: 0,
  },
  {
    student_id: 106,
    student_name: "Sarah Connor",
    username: "sarah_c",
    client_ip: "192.168.1.106",
    status: "disconnected",
    current_exam: "CS201 Final",
    current_question: "Disconnected",
    submissions_count: 0,
    warning_count: 2,
  },
];

export const MOCK_EVENT_LOGS: RealtimeEventLog[] = [
  {
    id: "log-1",
    timestamp: new Date(Date.now() - 1000 * 12).toISOString(),
    level: "SUBMISSION",
    source: "FastAPI /submit",
    message: "Student David Kim (192.168.1.105) submitted Java solution for Q101 (Reverse Words)",
    details: { submission_id: 505, language: "java", bytes: 642 },
  },
  {
    id: "log-2",
    timestamp: new Date(Date.now() - 1000 * 25).toISOString(),
    level: "EVENT",
    source: "Student Portal",
    message: "Emily Watson (192.168.1.104) started the test \"CS201 Final\" and opened Problem 2",
  },
  {
    id: "log-3",
    timestamp: new Date(Date.now() - 1000 * 60).toISOString(),
    level: "EVENT",
    source: "RealtimeBridge",
    message: "Teacher broadcasted announcement 'Clarification on Problem 2' to 5 active clients",
  },
  {
    id: "log-4",
    timestamp: new Date(Date.now() - 1000 * 140).toISOString(),
    level: "EVENT",
    source: "Exam Lifecycle",
    message: "Teacher ended test \"CS201 Final\". Student sessions closed and submissions locked",
  },
  {
    id: "log-5",
    timestamp: new Date(Date.now() - 1000 * 240).toISOString(),
    level: "SUBMISSION",
    source: "Piston Grader",
    message: "Grading finished for submission #502 (Alice Smith). Score: 40/40. Status: COMPLETED",
    details: { passed_cases: 3, total_cases: 3, execution_time: 0.15 },
  },
];

// Authenticated data requests must report backend failures rather than present demo records.
export async function fetchExams(token?: string): Promise<Exam[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw httpError("Loading exams", res);
    const data: unknown = await readJson(res, "Loading exams");
    if (!Array.isArray(data)) {
      throw new ApiError("Loading exams returned an invalid response.", "invalid_response", res.status);
    }
    return data as Exam[];
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Loading exams could not reach the backend. Check the connection and retry.", "network");
  }
}

export async function fetchExamById(examId: number, token?: string): Promise<Exam | undefined> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw httpError("Loading the exam", res);
    return await readJson<Exam>(res, "Loading the exam");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Loading the exam could not reach the backend. Check the connection and retry.", "network");
  }
}

export async function fetchQuestionsByExam(
  examId: number,
  token?: string
): Promise<BackendQuestion[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/questions?exam_id=${examId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw httpError("Loading exam questions", res);
    const data: unknown = await readJson(res, "Loading exam questions");
    if (!Array.isArray(data)) {
      throw new ApiError(
        "Loading exam questions returned an invalid response.",
        "invalid_response",
        res.status
      );
    }
    return data as BackendQuestion[];
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      "Loading exam questions could not reach the backend. Check the connection and retry.",
      "network"
    );
  }
}

export async function fetchTestCasesByQuestion(
  questionId: number,
  token?: string
): Promise<BackendTestCase[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/test-cases/question/${questionId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw httpError("Loading question test cases", res);
    const data: unknown = await readJson(res, "Loading question test cases");
    if (!Array.isArray(data)) {
      throw new ApiError(
        "Loading question test cases returned an invalid response.",
        "invalid_response",
        res.status
      );
    }
    return data as BackendTestCase[];
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      "Loading question test cases could not reach the backend. Check the connection and retry.",
      "network"
    );
  }
}

// ---------------------------------------------------------------------------
// Real backend CRUD + submission helpers (fall back to mocks when offline)
// ---------------------------------------------------------------------------

function authHeaders(token?: string): HeadersInit {
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

export interface CreateExamPayload {
  title: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  access_password?: string;
}

export async function createExamRequest(
  payload: CreateExamPayload,
  token?: string
): Promise<Exam | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export interface UpdateExamPayload {
  title?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  status?: ExamStatus;
  access_password?: string | null;
}

export async function updateExamRequest(
  examId: number,
  payload: UpdateExamPayload,
  token?: string
): Promise<Exam | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function deleteExamRequest(examId: number, token?: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export interface CreateQuestionPayload {
  exam_id: number;
  title: string;
  description?: string;
  question_type?: "stdio" | "java_class";
  max_score?: number;
  allowed_languages?: string;
  class_name?: string | null;
  method_signature?: string | null;
}

export function toBackendQuestionType(qt: QuestionType): "stdio" | "java_class" {
  return qt === "JAVA_CLASS_METHOD" ? "java_class" : "stdio";
}

export function toFrontendQuestionType(qt: string): QuestionType {
  return qt === "java_class" ? "JAVA_CLASS_METHOD" : "STDIN_STDOUT";
}

export function toBackendLanguage(lang: CodingLanguage): string {
  return lang;
}

export type BackendQuestion = {
  id: number;
  exam_id: number;
  title: string;
  description: string;
  question_type: "stdio" | "java_class";
  max_score: number;
  allowed_languages: string;
  class_name: string | null;
  method_signature: string | null;
  created_at?: string | null;
};

/** Map a backend QuestionResponse to the frontend Question shape. */
export function toFrontendQuestion(q: BackendQuestion): Question {
  const methodSignature = q.method_signature || "";
  const [methodName = "", parameterTypes = ""] = methodSignature.split("(");
  return {
    id: q.id,
    exam_id: q.exam_id,
    title: q.title,
    description: q.description,
    points: q.max_score,
    question_type: toFrontendQuestionType(q.question_type),
    time_limit: 2,
    language: "java",
    class_name: q.class_name,
    method_name: methodName.trim() || null,
    method_mode: "STATIC",
    return_type: "int",
    parameter_types: parameterTypes.replace(")", "").trim() || null,
    show_result_to_student: true,
  };
}

export async function createQuestionRequest(
  payload: CreateQuestionPayload,
  token?: string
): Promise<Question | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/questions`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return toFrontendQuestion(data);
  } catch (err) {
    return null;
  }
}

export async function deleteQuestionRequest(questionId: number, token?: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/questions/${questionId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export interface CreateTestCasePayload {
  question_id: number;
  input_data?: string;
  expected_output?: string;
  is_hidden?: number;
  score_weight?: number;
}

export type BackendTestCase = {
  id: number;
  question_id: number;
  input_data: string;
  expected_output: string;
  is_hidden: number;
  score_weight: number;
  created_at?: string | null;
};

export function toFrontendTestCase(tc: BackendTestCase): TestCase {
  return {
    id: tc.id,
    question_id: tc.question_id,
    is_sample: !tc.is_hidden,
    weight: tc.score_weight,
    stdin: tc.input_data,
    expected_stdout: tc.expected_output,
    arguments: null,
    expected_return: null,
  };
}

export async function createTestCaseRequest(
  payload: CreateTestCasePayload,
  token?: string
): Promise<TestCase | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/test-cases`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return toFrontendTestCase(data);
  } catch (err) {
    return null;
  }
}

export async function deleteTestCaseRequest(testCaseId: number, token?: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/test-cases/${testCaseId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

/** POST /submissions — create a submission for real backend grading. */
export async function submitCodeRequest(
  questionId: number,
  language: string,
  sourceCode: string,
  token?: string
): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/submissions`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        question_id: questionId,
        language,
        source_code: sourceCode,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ?? null;
  } catch (err) {
    return null;
  }
}

export interface BackendSubmissionResult {
  submission: {
    id: number;
    status: string;
    score: number | null;
    max_score: number;
    error_summary: string | null;
  };
  test_results: Array<{
    id: number;
    test_case_id: number;
    is_sample?: boolean;
    passed: number;
    stdout?: string | null;
    stderr?: string | null;
    compile_output?: string | null;
    exit_code?: number | null;
    time?: number | null;
    memory?: number | null;
    input_data?: string | null;
    expected_output?: string | null;
    score_weight?: number | null;
    awarded_points?: number | null;
    message?: string | null;
  }>;
}

export async function fetchSubmissionResult(
  submissionId: number,
  token?: string
): Promise<BackendSubmissionResult | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/results/${submissionId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

/** POST /submissions/{id}/regrade — requeue a submission for real backend grading. */
export async function regradeRequest(submissionId: number, token?: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/submissions/${submissionId}/regrade`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}
