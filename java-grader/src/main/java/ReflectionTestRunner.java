import java.io.InputStreamReader;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.Reader;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One test per JVM. Expected answers never enter this process.
 * Reflection verifies structure; Piston provides process/resource isolation.
 * This harness is not a security boundary against arbitrary hostile JVM code.
 */
public final class ReflectionTestRunner {
    private static final String RESULT_PREFIX = "@@JAVA_GRADER_RESULT@@";

    public static void main(String[] unused) {
        PrintStream originalOut = System.out;
        PrintStream originalErr = System.err;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", 1);
        result.put("request_id", "");
        result.put("case_id", 0);
        result.put("status", "runner_error");
        result.put("actual", null);
        result.put("error", "Invalid runner configuration");

        try {
            Map<String, Object> config = object(Json.parse(readInput()));
            if (integer(config.get("version")) != 1) throw new IllegalArgumentException("Unsupported protocol");
            String requestId = string(config.get("request_id"));
            if (!requestId.matches("[0-9a-f]{32}")) throw new IllegalArgumentException("Invalid request id");
            result.put("request_id", requestId);
            result.put("case_id", integer(config.get("case_id")));
            String className = string(config.get("class_name"));
            if (!className.matches("[A-Za-z_$][A-Za-z0-9_$]*") || className.equals("Main") || className.equals("ReflectionTestRunner")) {
                throw new IllegalArgumentException("Invalid student class name");
            }
            Map<String, Object> spec = object(config.get("method"));
            String methodName = string(spec.get("name"));
            List<Object> typeNames = list(spec.get("parameter_types"));
            List<Object> arguments = list(config.get("args"));
            if (typeNames.size() != arguments.size()) throw new IllegalArgumentException("Wrong argument count");
            if (!(spec.get("static") instanceof Boolean)) throw new IllegalArgumentException("Missing invocation mode");
            boolean expectedStatic = (Boolean) spec.get("static");
            Class<?> returnType = resolveType(string(spec.get("return_type")));
            Class<?>[] parameterTypes = new Class<?>[typeNames.size()];
            for (int i = 0; i < typeNames.size(); i++) {
                parameterTypes[i] = resolveType(string(typeNames.get(i)));
                if (parameterTypes[i] == void.class) throw new IllegalArgumentException("void parameter");
            }

            // Discard ordinary student logging, including from initializers/constructors.
            // The final result is written through the saved stream after invocation ends.
            PrintStream sink = new PrintStream(new OutputStream() {
                @Override public void write(int value) { }
                @Override public void write(byte[] bytes, int offset, int length) { }
            }, true, StandardCharsets.UTF_8.name());
            System.setOut(sink);
            System.setErr(sink);

            Class<?> studentClass;
            Method method;
            Constructor<?> constructor = null;
            try {
                // Do not initialize a class until its required signature has passed.
                studentClass = Class.forName(className, false, ReflectionTestRunner.class.getClassLoader());
                if (!Modifier.isPublic(studentClass.getModifiers())) throw new IllegalArgumentException("Student class must be public");
                method = studentClass.getDeclaredMethod(methodName, parameterTypes);
                if (!Modifier.isPublic(method.getModifiers())) throw new IllegalArgumentException("Required method must be public");
                if (Modifier.isAbstract(method.getModifiers())) throw new IllegalArgumentException("Required method must have an implementation");
                if (Modifier.isStatic(method.getModifiers()) != expectedStatic) throw new IllegalArgumentException("Method static/instance mode does not match the specification");
                if (!method.getReturnType().equals(returnType)) throw new IllegalArgumentException("Method return type does not match the specification");
                if (!expectedStatic) {
                    if (Modifier.isAbstract(studentClass.getModifiers())) throw new IllegalArgumentException("Instance class must be concrete");
                    constructor = studentClass.getConstructor();
                }
            } catch (ClassNotFoundException error) {
                fail(result, "signature_error", "Required class was not found");
                return;
            } catch (NoSuchMethodException error) {
                fail(result, "signature_error", "Required method or public no-argument constructor was not found");
                return;
            } catch (IllegalArgumentException error) {
                fail(result, "signature_error", error.getMessage());
                return;
            }

            Object[] converted = new Object[arguments.size()];
            try {
                for (int i = 0; i < arguments.size(); i++) converted[i] = convert(arguments.get(i), parameterTypes[i]);
            } catch (IllegalArgumentException error) {
                fail(result, "argument_error", "Invalid test argument: " + error.getMessage());
                return;
            }

            try {
                Object target = expectedStatic ? null : constructor.newInstance();
                Object actual = method.invoke(target, converted);
                // Validate serializability before announcing success (e.g. reject NaN).
                Json.write(actual);
                result.put("status", "ok");
                result.put("actual", actual);
                result.put("error", null);
            } catch (InvocationTargetException error) {
                fail(result, "runtime_error", describe(error.getCause() == null ? error : error.getCause()));
            } catch (Throwable error) {
                fail(result, "runtime_error", describe(error));
            }
        } catch (Throwable error) {
            fail(result, "runner_error", describe(error));
        } finally {
            System.setOut(originalOut);
            System.setErr(originalErr);
            try (PrintStream protocolOut = new PrintStream(
                    new FileOutputStream(FileDescriptor.out),
                    true,
                    StandardCharsets.UTF_8.name())) {
                protocolOut.println(RESULT_PREFIX + Json.write(result));
            } catch (Exception error) {
                throw new IllegalStateException("Could not write grader result", error);
            }
        }
    }

    private static String readInput() throws Exception {
        Reader reader = new InputStreamReader(System.in, StandardCharsets.UTF_8);
        StringBuilder input = new StringBuilder();
        char[] buffer = new char[4096];
        int count;
        while ((count = reader.read(buffer)) != -1) {
            if (input.length() + count > 1_048_576) throw new IllegalArgumentException("Configuration is too large");
            input.append(buffer, 0, count);
        }
        return input.toString();
    }

    private static void fail(Map<String, Object> result, String status, String error) {
        result.put("status", status);
        result.put("actual", null);
        result.put("error", error == null ? "Unknown error" : error.substring(0, Math.min(error.length(), 1000)));
    }

    private static String describe(Throwable error) {
        return error.getClass().getSimpleName() + (error.getMessage() == null ? "" : ": " + error.getMessage());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object value) {
        if (!(value instanceof Map)) throw new IllegalArgumentException("Expected a JSON object");
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object value) {
        if (!(value instanceof List)) throw new IllegalArgumentException("Expected a JSON array");
        return (List<Object>) value;
    }

    private static String string(Object value) {
        if (!(value instanceof String)) throw new IllegalArgumentException("Expected a string");
        return (String) value;
    }

    private static int integer(Object value) {
        if (!(value instanceof BigDecimal)) throw new IllegalArgumentException("Expected an integer");
        return ((BigDecimal) value).intValueExact();
    }

    private static Class<?> resolveType(String name) {
        if (name.endsWith("[]")) {
            Class<?> component = resolveType(name.substring(0, name.length() - 2));
            if (component == void.class) throw new IllegalArgumentException("void[] is invalid");
            return Array.newInstance(component, 0).getClass();
        }
        if (name.startsWith("java.lang.")) name = name.substring(10);
        switch (name) {
            case "byte": return byte.class;
            case "short": return short.class;
            case "int": return int.class;
            case "long": return long.class;
            case "float": return float.class;
            case "double": return double.class;
            case "boolean": return boolean.class;
            case "char": return char.class;
            case "void": return void.class;
            case "Byte": return Byte.class;
            case "Short": return Short.class;
            case "Integer": return Integer.class;
            case "Long": return Long.class;
            case "Float": return Float.class;
            case "Double": return Double.class;
            case "Boolean": return Boolean.class;
            case "Character": return Character.class;
            case "String": return String.class;
            default: throw new IllegalArgumentException("Unsupported Java type: " + name);
        }
    }

    private static Object convert(Object value, Class<?> type) {
        if (value == null) {
            if (type.isPrimitive()) throw new IllegalArgumentException("null cannot be passed to a primitive");
            return null;
        }
        if (type.isArray()) {
            List<Object> values = list(value);
            Object array = Array.newInstance(type.getComponentType(), values.size());
            for (int i = 0; i < values.size(); i++) Array.set(array, i, convert(values.get(i), type.getComponentType()));
            return array;
        }
        if (type == String.class) return string(value);
        if (type == char.class || type == Character.class) {
            String text = string(value);
            if (text.length() != 1) throw new IllegalArgumentException("char requires one UTF-16 code unit");
            return text.charAt(0);
        }
        if (type == boolean.class || type == Boolean.class) {
            if (value instanceof Boolean) return value;
            if (value instanceof String && (((String) value).equalsIgnoreCase("true") || ((String) value).equalsIgnoreCase("false"))) return Boolean.parseBoolean((String) value);
            throw new IllegalArgumentException("Expected a boolean");
        }
        if (!(value instanceof BigDecimal) && !(value instanceof String)) throw new IllegalArgumentException("Expected a number");
        BigDecimal number;
        try {
            number = value instanceof BigDecimal ? (BigDecimal) value : new BigDecimal(((String) value).trim());
            if (type == byte.class || type == Byte.class) return number.byteValueExact();
            if (type == short.class || type == Short.class) return number.shortValueExact();
            if (type == int.class || type == Integer.class) return number.intValueExact();
            if (type == long.class || type == Long.class) return number.longValueExact();
            if (type == float.class || type == Float.class) {
                float out = number.floatValue();
                if (!Float.isFinite(out)) throw new IllegalArgumentException("Float overflow");
                return out;
            }
            if (type == double.class || type == Double.class) {
                double out = number.doubleValue();
                if (!Double.isFinite(out)) throw new IllegalArgumentException("Double overflow");
                return out;
            }
        } catch (ArithmeticException | NumberFormatException error) {
            throw new IllegalArgumentException("Number is invalid or outside the parameter type's range");
        }
        throw new IllegalArgumentException("Unsupported argument type");
    }

    /** Small strict JSON codec: Unicode escapes, exact numbers, nested arrays. */
    private static final class Json {
        private final String source;
        private int position;
        private int depth;

        private Json(String source) { this.source = source; }

        static Object parse(String source) {
            Json parser = new Json(source);
            Object value = parser.readValue();
            parser.space();
            if (parser.position != source.length()) throw new IllegalArgumentException("Trailing JSON data");
            return value;
        }

        private void space() {
            while (position < source.length() && " \n\r\t".indexOf(source.charAt(position)) >= 0) position++;
        }

        private boolean take(char character) {
            space();
            if (position < source.length() && source.charAt(position) == character) { position++; return true; }
            return false;
        }

        private void require(char character) {
            if (!take(character)) throw new IllegalArgumentException("Malformed JSON");
        }

        private Object readValue() {
            space();
            if (++depth > 64) throw new IllegalArgumentException("JSON is too deeply nested");
            try {
                if (position >= source.length()) throw new IllegalArgumentException("Incomplete JSON");
                char character = source.charAt(position);
                if (character == '"') return readString();
                if (character == '{') {
                    position++;
                    Map<String, Object> values = new LinkedHashMap<>();
                    if (take('}')) return values;
                    do {
                        space();
                        String key = readString();
                        require(':');
                        if (values.containsKey(key)) throw new IllegalArgumentException("Duplicate JSON key");
                        values.put(key, readValue());
                        if (take('}')) return values;
                        require(',');
                    } while (true);
                }
                if (character == '[') {
                    position++;
                    List<Object> values = new ArrayList<>();
                    if (take(']')) return values;
                    do {
                        values.add(readValue());
                        if (take(']')) return values;
                        require(',');
                    } while (true);
                }
                if (source.startsWith("true", position)) { position += 4; return true; }
                if (source.startsWith("false", position)) { position += 5; return false; }
                if (source.startsWith("null", position)) { position += 4; return null; }
                int start = position;
                while (position < source.length() && "-+0123456789.eE".indexOf(source.charAt(position)) >= 0) position++;
                String number = source.substring(start, position);
                if (!number.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")) throw new IllegalArgumentException("Invalid JSON number");
                return new BigDecimal(number);
            } finally { depth--; }
        }

        private String readString() {
            if (position >= source.length() || source.charAt(position++) != '"') throw new IllegalArgumentException("Expected a JSON string");
            StringBuilder value = new StringBuilder();
            while (position < source.length()) {
                char character = source.charAt(position++);
                if (character == '"') return value.toString();
                if (character < 0x20) throw new IllegalArgumentException("Unescaped JSON control character");
                if (character != '\\') { value.append(character); continue; }
                if (position >= source.length()) throw new IllegalArgumentException("Incomplete JSON escape");
                switch (source.charAt(position++)) {
                    case '"': value.append('"'); break;
                    case '\\': value.append('\\'); break;
                    case '/': value.append('/'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'u':
                        if (position + 4 > source.length()) throw new IllegalArgumentException("Incomplete Unicode escape");
                        String hex = source.substring(position, position + 4);
                        if (!hex.matches("[0-9a-fA-F]{4}")) throw new IllegalArgumentException("Invalid Unicode escape");
                        try { value.append((char) Integer.parseInt(hex, 16)); }
                        catch (NumberFormatException error) { throw new IllegalArgumentException("Invalid Unicode escape"); }
                        position += 4;
                        break;
                    default: throw new IllegalArgumentException("Invalid JSON escape");
                }
            }
            throw new IllegalArgumentException("Unterminated JSON string");
        }

        static String write(Object value) {
            if (value == null) return "null";
            if (value instanceof String || value instanceof Character) return quote(String.valueOf(value));
            if (value instanceof Boolean) return value.toString();
            if (value instanceof Number) {
                if (value instanceof Double && !Double.isFinite((Double) value) || value instanceof Float && !Float.isFinite((Float) value)) throw new IllegalArgumentException("Non-finite return value");
                return value.toString();
            }
            if (value.getClass().isArray()) {
                StringBuilder out = new StringBuilder("[");
                for (int i = 0; i < Array.getLength(value); i++) {
                    if (i > 0) out.append(',');
                    out.append(write(Array.get(value, i)));
                }
                return out.append(']').toString();
            }
            if (value instanceof Map) {
                StringBuilder out = new StringBuilder("{");
                boolean first = true;
                for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                    if (!first) out.append(',');
                    first = false;
                    out.append(quote(String.valueOf(entry.getKey()))).append(':').append(write(entry.getValue()));
                }
                return out.append('}').toString();
            }
            throw new IllegalArgumentException("Unsupported return value");
        }

        private static String quote(String text) {
            StringBuilder out = new StringBuilder("\"");
            for (int i = 0; i < text.length(); i++) {
                char character = text.charAt(i);
                switch (character) {
                    case '"': out.append("\\\""); break;
                    case '\\': out.append("\\\\"); break;
                    case '\b': out.append("\\b"); break;
                    case '\f': out.append("\\f"); break;
                    case '\n': out.append("\\n"); break;
                    case '\r': out.append("\\r"); break;
                    case '\t': out.append("\\t"); break;
                    default:
                        if (character < 0x20 || Character.isSurrogate(character)) out.append(String.format("\\u%04x", (int) character));
                        else out.append(character);
                }
            }
            return out.append('"').toString();
        }
    }
}
