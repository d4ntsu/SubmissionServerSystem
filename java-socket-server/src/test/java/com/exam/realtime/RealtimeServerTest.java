package com.exam.realtime;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.*;

class RealtimeServerTest {

    @Test
    void acceptsRoutesDisconnectsAndShutsDownClients() throws Exception {
        RealtimeServer server = new RealtimeServer("127.0.0.1", 0);
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket first = connectWhenReady(server);
             Socket second = new Socket("127.0.0.1", server.getLocalPort());
             BufferedReader secondReader = reader(second)) {
            second.setSoTimeout(3000);

            awaitCondition(() -> server.getRegistry().onlineCount() == 2, "both TCP clients to register");
            assertEquals(2, server.getRegistry().getAllClients().size());

            String secondClientId = server.getRegistry().getAllClients().values().stream()
                    .filter(handler -> handler.getClientId().endsWith(":" + second.getLocalPort()))
                    .map(ClientHandler::getClientId)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("second client was not registered"));
            Message targeted = Message.create(Message.Type.SERVER_ERROR, "test", secondClientId);
            targeted.setPayload(Map.of("test", "targeted"));
            server.getRegistry().sendTo(secondClientId, targeted);
            assertTrue(secondReader.readLine().contains("targeted"));

            first.close();
            awaitCondition(() -> server.getRegistry().onlineCount() == 1, "disconnected client to be removed");

            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            assertFalse(server.isRunning());
            assertEquals(0, server.getRegistry().onlineCount());
            assertNull(secondReader.readLine(), "server shutdown should close the active TCP client");
        } finally {
            server.stop();
            serverThread.shutdownNow();
        }
    }

    @Test
    void slowClientDoesNotBlockBroadcastDeliveryToFastClient() throws Exception {
        RealtimeServer server = new RealtimeServer("127.0.0.1", 0);
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        ExecutorService readerThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);
        Socket slow = null;
        Socket fast = null;

        try {
            awaitCondition(() -> server.isRunning() && server.getLocalPort() > 0, "server to start");
            slow = new Socket();
            slow.setReceiveBufferSize(1024);
            slow.connect(new java.net.InetSocketAddress("127.0.0.1", server.getLocalPort()));
            fast = new Socket("127.0.0.1", server.getLocalPort());
            BufferedReader fastReader = reader(fast);
            awaitCondition(() -> server.getRegistry().onlineCount() == 2, "both TCP clients to register");

            final int messageCount = 256;
            String padding = "x".repeat(8 * 1024);
            Future<String> lastMessage = readerThread.submit(() -> {
                String line;
                while ((line = fastReader.readLine()) != null) {
                    if (line.contains("\"sequence\":" + (messageCount - 1))) {
                        return line;
                    }
                }
                throw new IOException("Fast client closed before receiving the final broadcast");
            });

            long startedAt = System.nanoTime();
            for (int sequence = 0; sequence < messageCount; sequence++) {
                Message event = Message.create(Message.Type.SUBMISSION_STATUS, "test", "broadcast");
                event.setPayload(Map.of("sequence", sequence, "padding", padding));
                server.broadcast(event);
                Thread.sleep(2);
            }
            long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);

            assertTrue(elapsedMillis < Duration.ofSeconds(8).toMillis(),
                    "broadcast enqueueing should not wait on a slow client");
            assertTrue(lastMessage.get(10, TimeUnit.SECONDS).contains("\"sequence\":" + (messageCount - 1)));
        } finally {
            server.stop();
            closeQuietly(slow);
            closeQuietly(fast);
            serverRun.get(5, TimeUnit.SECONDS);
            readerThread.shutdownNow();
            serverThread.shutdownNow();
        }
    }

    @Test
    void authenticatesInternalServiceAndRoutesDomainEvents() throws Exception {
        RealtimeServer server = new RealtimeServer("127.0.0.1", 0, "test-only-shared-secret");
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket service = connectWhenReady(server);
             BufferedReader reader = reader(service);
             BufferedWriter writer = new BufferedWriter(
                     new OutputStreamWriter(service.getOutputStream(), StandardCharsets.UTF_8))) {
            service.setSoTimeout(3000);

            Message hello = Message.create(Message.Type.SERVICE_HELLO, "fastapi", "server");
            hello.setPayload(Map.of("shared_secret", "test-only-shared-secret"));
            writer.write(hello.toJson());
            writer.newLine();
            writer.flush();

            Message status = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.CLIENT_STATUS.value(), status.getType());
            assertEquals(Boolean.TRUE, status.getPayload().get("authenticated"));
            assertEquals(Boolean.TRUE, status.getPayload().get("service"));

            Message event = Message.create(Message.Type.SUBMISSION_RUNNING, "fastapi", "broadcast");
            event.setPayload(Map.of("submission_id", 17, "status", "running"));
            writer.write(event.toJson());
            writer.newLine();
            writer.flush();

            Message routed = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.SUBMISSION_RUNNING.value(), routed.getType());
            assertEquals(17, routed.getPayload().get("submission_id"));
        } finally {
            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            serverThread.shutdownNow();
        }
    }

    private static Future<?> startServer(RealtimeServer server, ExecutorService executor) {
        return executor.submit(() -> {
            try {
                server.start();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });
    }

    private static Socket connectWhenReady(RealtimeServer server) throws Exception {
        awaitCondition(() -> server.isRunning() && server.getLocalPort() > 0, "server to start");
        return new Socket("127.0.0.1", server.getLocalPort());
    }

    private static BufferedReader reader(Socket socket) throws IOException {
        return new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
    }

    private static void awaitCondition(BooleanSupplier condition, String description) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertTrue(condition.getAsBoolean(), "Timed out waiting for " + description);
    }

    private static void closeQuietly(Socket socket) {
        if (socket == null) {
            return;
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // Cleanup after a test failure is best-effort.
        }
    }
}
