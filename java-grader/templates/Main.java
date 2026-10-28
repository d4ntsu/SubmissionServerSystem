import java.lang.reflect.InvocationTargetException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;

/**
 * Piston Java 15 uses source-file mode and does not compile sibling sources.
 * No args: use an already-compiled runner for local tests.
 * One arg: compile the runner and the required student class (Piston mode).
 */
public final class Main {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            invoke(Class.forName("ReflectionTestRunner"));
            return;
        }
        if (args.length != 1 || !args[0].matches("[A-Za-z_$][A-Za-z0-9_$]*")) {
            System.err.println("[java-grader bootstrap] Invalid class argument");
            System.exit(70);
        }
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            System.err.println("[java-grader bootstrap] A JDK with JavaCompiler is required");
            System.exit(70);
        }
        Path output = Files.createTempDirectory(Path.of("."), ".java-grader-");
        int code = compiler.run(null, System.err, System.err,
                "-encoding", "UTF-8", "-proc:none", "-d", output.toString(),
                "ReflectionTestRunner.java", args[0] + ".java");
        if (code != 0) System.exit(65);
        try (URLClassLoader loader = new URLClassLoader(
                new URL[]{output.toUri().toURL()}, ClassLoader.getPlatformClassLoader())) {
            invoke(Class.forName("ReflectionTestRunner", true, loader));
        }
    }

    private static void invoke(Class<?> runner) throws Exception {
        try {
            runner.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw error;
        }
    }
}
