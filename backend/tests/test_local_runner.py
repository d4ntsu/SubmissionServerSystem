"""Tests for the local subprocess-based code runner."""

import pytest

from app.services.local_runner import LocalRunner, LocalRunnerError


@pytest.mark.asyncio
async def test_java_execution_returns_stdout():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="java",
            files=[{"name": "Main.java", "content": '''
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Java");
    }
}
'''}],
        )
    assert result.run.code == 0
    assert "Hello from Java" in result.run.stdout
    assert result.compile is not None
    assert result.compile.code == 0


@pytest.mark.asyncio
async def test_java_execution_with_stdin():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="java",
            files=[{"name": "Main.java", "content": '''
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}
'''}],
            stdin="3 4\n",
        )
    assert result.run.code == 0
    assert result.run.stdout.strip() == "7"


@pytest.mark.asyncio
async def test_python_execution_returns_stdout():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="python",
            files=[{"name": "Main.py", "content": 'print("Hello from Python")'}],
        )
    assert result.run.code == 0
    assert "Hello from Python" in result.run.stdout


@pytest.mark.asyncio
async def test_python_execution_with_stdin():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="python",
            files=[{"name": "Main.py", "content": '''
import sys
data = sys.stdin.read().strip()
print(data.upper())
'''}],
            stdin="hello world\n",
        )
    assert result.run.code == 0
    assert result.run.stdout.strip() == "HELLO WORLD"


@pytest.mark.asyncio
async def test_java_compile_error():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="java",
            files=[{"name": "Main.java", "content": "public class Main { broken syntax }"}],
        )
    assert result.compile is not None
    assert result.compile.code != 0
    assert result.compile.stderr


@pytest.mark.asyncio
async def test_java_runtime_error():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="java",
            files=[{"name": "Main.java", "content": '''
public class Main {
    public static void main(String[] args) {
        int x = 1 / 0;
    }
}
'''}],
        )
    assert result.run.code != 0
    assert result.run.stderr


@pytest.mark.asyncio
async def test_python_runtime_error():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="python",
            files=[{"name": "Main.py", "content": "1/0"}],
        )
    assert result.run.code != 0


@pytest.mark.asyncio
async def test_unsupported_language():
    async with LocalRunner() as runner:
        with pytest.raises(LocalRunnerError, match="Unsupported language"):
            await runner.execute(
                language="ruby",
                files=[{"name": "main.rb", "content": "puts 'hi'"}],
            )


@pytest.mark.asyncio
async def test_invalid_file_name():
    async with LocalRunner() as runner:
        with pytest.raises(ValueError, match="Invalid source file name"):
            await runner.execute(
                language="java",
                files=[{"name": "../Main.java", "content": "class Main {}"}],
            )


@pytest.mark.asyncio
async def test_empty_files_list():
    async with LocalRunner() as runner:
        with pytest.raises(ValueError, match="At least one source file"):
            await runner.execute(language="java", files=[])


@pytest.mark.asyncio
async def test_plaintext_language_returns_immediately():
    async with LocalRunner() as runner:
        result = await runner.execute(
            language="plaintext",
            files=[{"name": "answer.txt", "content": "some answer"}],
        )
    assert result.run.code == 0