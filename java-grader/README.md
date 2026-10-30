# Task 4 — Java Reflection Grader

Module chấm bài Java theo class/method, tích hợp với backend hiện tại; không cần đổi schema database.

## Cài bản sửa

Giải nén gói `Task4_Java_Grader_Fixed.zip` vào **thư mục gốc repo**, giữ nguyên cấu trúc `backend/`, `java-grader/`, `deploy/` và ghi đè các file cùng tên. Dùng toàn bộ gói: Python service mới cần cả template `Main.java`, Piston client và các cấu hình đi kèm.

Yêu cầu Python 3.10+, JDK 11+ cho kiểm thử Java local, và Piston tự host có runtime Java là **JDK đầy đủ** (có `JavaCompiler`). Bootstrap được thiết kế cho cách chạy source-file của runtime Java 15.0.2; cần chạy smoke test bên dưới trên Piston bạn triển khai.

```bash
python -m pip install -r backend/requirements.txt
cd backend
python -m pytest tests/test_java_method_grader.py tests/test_hidden_test_cases.py tests/test_grading_service.py tests/test_local_runner.py -q
```

Các test real JVM sẽ được skip nếu máy không có JDK. Muốn nghiệm thu phần Java, cần chạy chúng với JDK và kiểm tra không có skip.

Bản sửa đã được kiểm tra với Python 3.12 và OpenJDK 17: toàn bộ `python -m pytest tests -q` của backend đạt **126 passed, 0 failed, 0 skipped**. Các fixture Java được compile với `--release 11`. Đã kiểm tra bootstrap bằng source-file mode, bao gồm rename file giống script Java 15 của Piston. Chưa chạy Docker/Piston thật trong môi trường tạo bản sửa; lệnh nghiệm thu ở cuối tài liệu thực hiện phần này.

## Luồng xử lý và nhiều file trên Piston

1. Python đọc `class_name`, `method_signature`, đối số, đáp án và trọng số từ database.
2. Python gửi ba file, theo thứ tự: `Main.java`, `ReflectionTestRunner.java`, `<class_name>.java`. Đối số dòng lệnh là `class_name`; STDIN chỉ chứa cấu hình method, đối số test, mã test và request ID ngẫu nhiên.
3. Runtime Java 15.0.2 chính thức của Piston dùng `java <first-file>` (source-file mode), **không tự compile các file anh em**. Vì vậy `Main.java` dùng `JavaCompiler` biên dịch runner và bài sinh viên, tắt annotation processing bằng `-proc:none`, rồi nạp runner từ thư mục class tạm.
4. Runner dùng `Class.forName(..., false, ...)`, kiểm tra signature trước khi chạy static initializer/constructor, gọi method và trả về giá trị thực tế có kiểu hoặc lỗi.
5. Python kiểm tra exit code, signal, protocol, request ID, test ID, kiểu dữ liệu, rồi tự so sánh đáp án và tính điểm.

Mã nguồn runtime tham khảo: [Piston Java 15.0.2 run](https://github.com/engineer-man/piston/blob/master/packages/java/15.0.2/run). Local test `test_piston_source_file_mode_bootstrap_compiles_sibling_files` tái hiện thao tác rename/source-file mode của script này, với cả code hợp lệ và code lỗi biên dịch.

Mỗi test là một Piston request/JVM riêng: reset cả instance state và static state; một test bị timeout không làm mất kết quả test khác. Đổi lại, mỗi test phải biên dịch lại code.

Vì JavaCompiler nằm trong **run stage**, hai cấu hình mới đặt giới hạn cho toàn bộ bước compile + chạy của từng test:

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PISTON_JAVA_METHOD_RUN_TIMEOUT_MS` | `15000` | Tổng thời gian compile + chạy mỗi test, milliseconds |
| `PISTON_JAVA_METHOD_RUN_CPU_TIME_MS` | `15000` | Thời gian CPU tối đa mỗi test, milliseconds |
| `PISTON_JAVA_METHOD_RUN_MEMORY_LIMIT_BYTES` | `536870912` | Giới hạn bộ nhớ của run stage, 512 MiB |

Đây là giới hạn chung của cả compiler và code sinh viên, không phải hai quota riêng. Các bài `stdio` tiếp tục dùng cấu hình Piston cũ. HTTP timeout cần lớn hơn giới hạn chạy; mặc định `PISTON_REQUEST_TIMEOUT_SECONDS=20` phù hợp với 15 giây. Trong Compose, cả `PISTON_RUN_TIMEOUT` và `PISTON_RUN_CPU_TIME` phải ít nhất là `15000`.

Java 15 source-file launcher khởi động JVM trước, sau đó grader gọi `JavaCompiler` lần nữa để biên dịch runner và class của sinh viên. Piston mặc định giới hạn CPU của run stage ở 3 giây; do đó nó kill compiler bằng `SIGKILL` dù giới hạn wall-clock lớn hơn. Cấu hình trong Compose tăng cả giới hạn CPU và wall-clock lên 15 giây. Sau khi đổi cấu hình, tạo lại container bằng `docker compose -f deploy/piston/docker-compose.yml up -d --force-recreate`. Nếu Piston chạy ở nơi khác, cho phép ít nhất 15.000 ms cho cả CPU và wall-clock, cùng 536.870.912 byte cho run request.

Mã thoát `65` từ bootstrap được lưu là lỗi compile; `70` với thông báo bootstrap là lỗi môi trường JDK. Code sinh viên thoát sớm hoặc thiếu output hợp lệ sẽ không được tính là pass.

## Cấu hình câu hỏi

```json
{
  "question_type": "java_class",
  "allowed_languages": "java",
  "class_name": "Calculator",
  "method_signature": "public int add(int a, int b)",
  "max_score": 100
}
```

- `class_name` bắt buộc, là tên class đơn giản; class sinh viên phải public, không khai báo package. `Main` và `ReflectionTestRunner` là tên dành riêng cho harness.
- API vẫn chấp nhận signature dạng cũ do giao diện hiện tại lưu, ví dụ `add(int, int): int`; trường `method_mode` quyết định static hay instance. Signature khai báo Java đầy đủ như `public int add(int a, int b)` cũng được hỗ trợ.
- Method bắt buộc được khai báo trực tiếp trong class, public, đúng kiểu tham số và đúng kiểu trả về. Method kế thừa không tự được chấp nhận.
- `static` trong signature yêu cầu static method; thiếu `static` yêu cầu instance method. Instance method cần constructor public không đối số.
- Phải ghi rõ return type: `int add(int,int)` hợp lệ; `add(int,int)` bị từ chối. Modifier `public` có thể lược bỏ nhưng method vẫn phải public.
- Hỗ trợ overload bằng cách tìm đúng danh sách kiểu tham số, không chọn theo tên đơn thuần.
- Hỗ trợ các primitive `byte/short/int/long/float/double/boolean/char`, wrapper tương ứng, `String`, `void` cho return type và mảng nhiều chiều của các kiểu có giá trị. Phân biệt `int` với `Integer`. Chưa hỗ trợ generic/collection, custom object hoặc constructor có tham số.
- `void` dùng expected `null`: chỉ kiểm tra signature và việc thực thi hoàn tất; chưa chấm side effect.

## Dữ liệu test

`input_data` nên là **JSON array của toàn bộ đối số**. Với đúng một tham số `int[]`, cũng chấp nhận Java literal như `new int[]{12, 35, 1}`. `expected_output` là giá trị trả về mong đợi.

| Signature | `input_data` | `expected_output` |
| --- | --- | --- |
| `int add(int,int)` | `[2,3]` | `5` |
| `long sum(long[])` | `[[1,2,3]]` | `6` |
| `String echo(String)` | `["chào 😀"]` | `"chào 😀"` |
| `String[] words(String[])` | `[["hello world","a,b"]]` | `["hello world","a,b"]` |
| `Integer echo(Integer)` | `[null]` | `null` |

Một đối số mảng cần bọc hai lớp ngoặc: `[[1,2]]`. Input kiểu cũ `2 3` hoặc `2,3` còn được hỗ trợ cho nhiều scalar; JSON là định dạng nên dùng để tránh mơ hồ.

Không tự thêm `0` khi thiếu đối số. Chuỗi giữ nguyên dấu cách/dấu phẩy và Unicode hợp lệ. Số nguyên được kiểm tra chính xác, có giới hạn kiểu, không làm tròn số thực sang int. Array được so sánh theo phần tử và kiểu. Float so sánh với `rel_tol=abs_tol=1e-6`; double dùng `1e-9`; từ chối NaN/Infinity. `null` chỉ hợp lệ cho reference type hoặc void. String có thể dùng plain text; dùng JSON string `"null"` khi muốn văn bản null, thay vì giá trị null.

## Giao thức kết quả

Một dòng duy nhất bắt đầu bằng `@@JAVA_GRADER_RESULT@@`, theo sau là JSON:

```json
{"version":1,"request_id":"0123456789abcdef0123456789abcdef","case_id":101,"status":"ok","actual":5,"error":null}
```

Các trạng thái: `ok`, `signature_error`, `runtime_error`, `argument_error`, `runner_error`. Không có `passed` hay `expected` trong giao thức. Backend không đọc các marker cũ. Result trùng lặp, sai request/test ID, thiếu field, sai kiểu, signal hoặc exit code khác 0 đều không được pass. Runner bỏ qua stdout/stderr thông thường của code sinh viên trước khi in kết quả; stdout lưu trong database là JSON của giá trị thực tế.

## Test ẩn và phạm vi bảo vệ

- Đáp án chỉ ở Python/database, không đưa vào Java source, STDIN hay STDOUT của sandbox.
- API `/test-cases/question/{question_id}` lọc test ẩn với tài khoản student; teacher vẫn xem được toàn bộ. API results hiện có tiếp tục che stdout/stderr/compile output của hidden test đối với student.
- Đối số test bắt buộc được truyền cho bài sinh viên để gọi method; không thể coi đối số đó là bí mật đối với chính chương trình đang chạy.
- Reflection, redirect stdout và request ID không tạo thành một security sandbox trong JVM. Code Java độc hại có toàn quyền trong cùng tiến trình vẫn có thể can thiệp sâu vào runtime. Piston chịu trách nhiệm cô lập máy chủ và giới hạn tài nguyên. Bản này xử lý các trường hợp giả marker/`passed` đã tái hiện, không cam kết chống mọi cách giả mạo từ code JVM tùy ý. Một grader chống gian lận ở mức đối kháng cần thiết kế kênh kết quả/kiểm tra cấu trúc ngoài tiến trình sinh viên.

## Chạy Piston thật để nghiệm thu

Từ thư mục gốc repo, sau khi Task 5 đã dựng Piston và cài Java runtime:

```bash
python deploy/piston/phase6_java_method_test.py --url http://127.0.0.1:2000 --java-version 15.0.2
```

Script trả mã 0 khi cả bốn trường hợp đúng: cộng hai số, Unicode, `long[]`, và từ chối sai return type. Đây là kiểm thử HTTP/Piston thật, khác với các unit test dùng mock hoặc JVM local. Nếu chưa chạy script trên Piston, không nên ghi nhận rằng môi trường Docker/Piston đã được nghiệm thu.
