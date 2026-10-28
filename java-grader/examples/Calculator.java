public class Calculator {
    // Phương thức cộng 2 số nguyên mà đề bài yêu cầu
    public int add(int a, int b) {
        return a + b;
    }

    // Một phương thức khác: chia 2 số
    public double divide(int a, int b) {
        if (b == 0) {
            throw new ArithmeticException("Cannot divide by zero");
        }
        return (double) a / b;
    }
}
