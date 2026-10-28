import { Exam, Question, TestCase, Submission, User, UserRole, Announcement } from "@/types";

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





// Helper to interact with API or fallback
export async function fetchExams(token?: string): Promise<Exam[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (err) {
    // Return fallback for demo
  }
  return MOCK_EXAMS;
}

export async function fetchExamById(examId: number, token?: string): Promise<Exam | undefined> {
  try {
    const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) return await res.json();
  } catch (err) {}
  return MOCK_EXAMS.find((e) => e.id === examId);
}

export async function fetchQuestionsByExam(examId: number, token?: string): Promise<Question[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/questions?exam_id=${examId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (err) {}
  return MOCK_QUESTIONS[examId] || [];
}

export async function fetchTestCasesByQuestion(questionId: number, token?: string): Promise<TestCase[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/test-cases/question/${questionId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) return await res.json();
  } catch (err) {}
  return MOCK_TEST_CASES[questionId] || [];
}

