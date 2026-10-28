import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * BƯỚC 1: Tìm hiểu cách dùng Java Reflection để chấm bài
 * File này đóng vai trò là "Máy chấm thi" (Test Runner).
 * Nó sẽ nạp class Calculator của sinh viên và gọi hàm để chấm điểm.
 */
public class Step1ReflectionDemo {

    public static void main(String[] args) {
        System.out.println("==================================================");
        System.out.println("   BẮT ĐẦU CHẤM BÀI BẰNG JAVA REFLECTION");
        System.out.println("==================================================\n");

        String studentClassName = "Calculator";

        try {
            // 1. TÌM CLASS CỦA SINH VIÊN
            System.out.println("[1] Đang tìm class: " + studentClassName + "...");
            Class<?> studentClass = Class.forName(studentClassName);
            System.out.println("    -> Tìm thấy class: " + studentClass.getName());

            // 2. KHỞI TẠO ĐỐI TƯỢNG (Giống như lệnh: new Calculator())
            System.out.println("\n[2] Đang khởi tạo đối tượng từ class...");
            Constructor<?> constructor = studentClass.getDeclaredConstructor();
            Object studentInstance = constructor.newInstance();
            System.out.println("    -> Khởi tạo đối tượng thành công!");

            // 3. TÌM VÀ CHẤM HÀM add(int, int)
            System.out.println("\n[3] Đang tìm phương thức: public int add(int, int)...");
            Method addMethod = studentClass.getMethod("add", int.class, int.class);
            System.out.println("    -> Tìm thấy hàm: " + addMethod.getName() + " với kiểu trả về: " + addMethod.getReturnType().getSimpleName());

            // --- TEST CASE 1: add(3, 4) -> Kỳ vọng: 7 ---
            runTestCase(studentInstance, addMethod, new Object[]{3, 4}, 7, "Test Case 1: add(3, 4)");

            // --- TEST CASE 2: add(10, 25) -> Kỳ vọng: 35 ---
            runTestCase(studentInstance, addMethod, new Object[]{10, 25}, 35, "Test Case 2: add(10, 25)");

            // --- TEST CASE 3: Cố tình test sai để xem kết quả (Kỳ vọng: 999 nhưng thực tế là 5) ---
            runTestCase(studentInstance, addMethod, new Object[]{2, 3}, 999, "Test Case 3: add(2, 3) (Kỳ vọng sai để thử nghiệm)");

            // 4. THỬ NGHIỆM TRƯỜNG HỢP: SINH VIÊN QUÊN VIẾT HÀM HOẶC SAI TÊN HÀM
            System.out.println("\n[4] Thử tìm hàm không tồn tại: multiply(int, int)...");
            try {
                studentClass.getMethod("multiply", int.class, int.class);
            } catch (NoSuchMethodException e) {
                System.out.println("    [LỖI PHÁT HIỆN]: Sinh viên chưa viết hàm multiply hoặc sai kiểu tham số!");
            }

            // 5. THỬ NGHIỆM: HÀM NÉM RA NGOẠI LỆ (EXCEPTION) KHI CHẠY
            System.out.println("\n[5] Thử gọi hàm divide(10, 0) (Chia cho 0)...");
            Method divideMethod = studentClass.getMethod("divide", int.class, int.class);
            try {
                divideMethod.invoke(studentInstance, 10, 0);
            } catch (InvocationTargetException e) {
                // Khi hàm của sinh viên ném Exception, Reflection bọc nó trong InvocationTargetException
                Throwable realError = e.getCause();
                System.out.println("    [BẮT ĐƯỢC NGOẠI LỆ TỪ CODE SINH VIÊN]: " + realError.getClass().getSimpleName() + ": " + realError.getMessage());
            }

        } catch (ClassNotFoundException e) {
            System.out.println("❌ LỖI: Sinh viên không tạo đúng tên class: " + studentClassName);
        } catch (Exception e) {
            System.out.println("❌ LỖI HỆ THỐNG: " + e.getMessage());
            e.printStackTrace();
        }

        System.out.println("\n==================================================");
        System.out.println("   KẾT THÚC QUÁ TRÌNH CHẤM BÀI");
        System.out.println("==================================================");
    }

    /**
     * Hàm phụ trợ chạy 1 test case và so sánh kết quả
     */
    private static void runTestCase(Object instance, Method method, Object[] args, Object expected, String testName) {
        try {
            // Lệnh method.invoke() tương đương với việc gọi: instance.method(args)
            Object actualResult = method.invoke(instance, args);

            if (expected.equals(actualResult)) {
                System.out.println("    ✅ " + testName + " -> ĐẠT (Kết quả: " + actualResult + ")");
            } else {
                System.out.println("    ❌ " + testName + " -> SAI (Thực tế: " + actualResult + ", Kỳ vọng: " + expected + ")");
            }
        } catch (Exception e) {
            System.out.println("    ❌ " + testName + " -> LỖI THỰC THI: " + e.getMessage());
        }
    }
}
