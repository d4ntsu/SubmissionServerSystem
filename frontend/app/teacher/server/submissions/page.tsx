import { redirect } from "next/navigation";

export default function LegacyTeacherSubmissionsPage() {
  redirect("/teacher/exams");
}
