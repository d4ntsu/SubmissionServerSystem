export type UserRole = "student" | "teacher";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
}

export type ExamStatus = "draft" | "published" | "started" | "ended";

export interface Exam {
  id: number;
  title: string;
  description: string;
  teacher_id: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: ExamStatus;
  questions_count?: number;
  total_points?: number;
  has_password?: boolean;
}

export type QuestionType = "STDIN_STDOUT" | "JAVA_CLASS_METHOD";
export type CodingLanguage = "java" | "python";

export interface Question {
  id: number;
  exam_id: number;
  title: string;
  description: string;
  points: number;
  question_type: QuestionType;
  time_limit: number;
  language: CodingLanguage;
  class_name?: string | null;
  method_name?: string | null;
  method_mode?: "STATIC" | "INSTANCE" | null;
  return_type?: string | null;
  parameter_types?: string | null;
  show_result_to_student?: boolean;
}

export interface TestCase {
  id: number;
  question_id: number;
  is_sample: boolean;
  weight: number;
  stdin?: string | null;
  expected_stdout?: string | null;
  arguments?: string | null;
  expected_return?: string | null;
}

export type SubmissionStatus = "queued" | "running" | "completed" | "error";

export interface SubmissionTestResult {
  id: number;
  submission_id: number;
  test_case_id: number;
  is_sample?: boolean;
  passed: number; // 1 for pass, 0 for fail
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  exit_code?: number | null;
  time?: number | null; // in seconds
  memory?: number | null; // in KB / MB
  input_data?: string | null;
  expected_output?: string | null;
  awarded_points?: number | null;
  score_weight?: number | null;
  message?: string | null;
}

export interface Submission {
  id: number;
  student_id: number;
  student_name?: string;
  student_username?: string;
  question_id: number;
  question_title?: string;
  exam_id?: number;
  exam_title?: string;
  language: string;
  source_code: string;
  status: SubmissionStatus;
  score?: number | null;
  max_score: number;
  submitted_at: string;
  graded_at?: string | null;
  test_results?: SubmissionTestResult[];
  error_summary?: string | null;
}

export type AnnouncementPriority = "info" | "warning" | "urgent";

export interface Announcement {
  id: string;
  title: string;
  message: string;
  priority: AnnouncementPriority;
  target_exam_id?: number | "all";
  target_exam_title?: string;
  created_at: string;
  author_name: string;
}

export type StudentActivityStatus = "online" | "in_exam" | "submitted" | "idle" | "disconnected";

export interface StudentClientStatus {
  student_id: number;
  student_name: string;
  username: string;
  client_ip: string;
  status: StudentActivityStatus;
  current_exam?: string;
  current_question?: string;
  submissions_count: number;
  warning_count?: number;
}

export interface RealtimeEventLog {
  id: string;
  timestamp: string;
  level: "INFO" | "WARN" | "EVENT" | "SUBMISSION" | "SYSTEM";
  source: string;
  message: string;
  details?: Record<string, any>;
}

