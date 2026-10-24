package com.exam.realtime;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import static org.junit.jupiter.api.Assertions.*;

class RealtimeServerTest {

    private static final String JWT_SECRET = "test-only-jwt-secret";

    @Test
    void acceptsRoutesDisconnectsAndShutsDownClients() throws Exception {
        ClientRegistry registry = testRegistry();
        RealtimeServer server = testServer(registry);
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket first = connectWhenReady(server);
             Socket second = new Socket("127.0.0.1", server.getLocalPort());
             BufferedReader firstReader = reader(first);
             BufferedReader secondReader = reader(second);
             BufferedWriter firstWriter = writer(first);
             BufferedWriter secondWriter = writer(second)) {
            second.setSoTimeout(3000);
            first.setSoTimeout(3000);

            sendUserAuth(firstWriter, 101, "student");
            sendUserAuth(secondWriter, 202, "teacher");
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(firstReader.readLine()).getType());
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(secondReader.readLine()).getType());

            awaitCondition(() -> server.getRegistry().onlineCount() == 2, "both TCP clients to register");
            assertEquals(2, server.getRegistry().getAllClients().size());

            String secondClientId = server.getRegistry().getAllClients().values().stream()
                    .filter(handler -> handler.getClientId().endsWith(":" + second.getLocalPort()))
                    .map(ClientHandler::getClientId)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("second client was not registered"));
            Message targeted = Message.create(Message.Type.SUBMISSION_RUNNING, "test", secondClientId);
            targeted.setPayload(Map.of("submission_id", 1));
            server.getRegistry().sendTo(secondClientId, targeted);
            assertTrue(secondReader.readLine().contains("\"submission_id\":1"));

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
    void authenticatesJwtIdentityAndUsesDatabaseRoleInsteadOfTokenRole() throws Exception {
        ClientRegistry registry = testRegistry();
        RealtimeServer server = testServer(registry);
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket socket = connectWhenReady(server);
             BufferedReader reader = reader(socket);
             BufferedWriter writer = writer(socket)) {
            socket.setSoTimeout(3000);
            sendUserAuth(writer, 101, "teacher"); // Signed claim conflicts with the database role.

            Message status = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.CLIENT_STATUS.value(), status.getType());
            assertEquals(Boolean.TRUE, status.getPayload().get("authenticated"));
            assertEquals(101, ((Number) status.getPayload().get("user_id")).intValue());
            assertEquals("student", status.getPayload().get("role"));

            ClientHandler handler = registry.getHandlerByUserId(101);
            assertNotNull(handler);
            assertTrue(handler.isAuthenticated());
            assertEquals("user", handler.getClientType());
            assertEquals("student", handler.getRole());
            assertEquals("student-101", handler.getUsername());
            assertEquals(handler.getConnectionId(), handler.getClientId());
            assertNotNull(handler.getConnectedAt());
            assertNotNull(handler.getLastSeen());
        } finally {
            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            serverThread.shutdownNow();
        }
    }

    @Test
    void rejectsMissingInvalidAndUnknownUserCredentialsAndClosesTheConnection() throws Exception {
        RealtimeServer server = testServer(testRegistry());
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try {
            assertRejectedAuthentication(server, null);
            assertRejectedAuthentication(server, "not.a.jwt");
            assertRejectedAuthentication(server, createAccessToken(999, "student", Instant.now().plusSeconds(60)));
            assertRejectedAuthentication(server, createAccessToken(101, "student", Instant.now().minusSeconds(60)));
            assertRejectedLegacyIdentityClaim(server);
        } finally {
            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            serverThread.shutdownNow();
        }
    }

    @Test
    void unauthenticatedClientCannotPublishProtectedEvents() throws Exception {
        ClientRegistry registry = testRegistry();
        RealtimeServer server = testServer(registry);
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket authenticated = connectWhenReady(server);
             Socket unauthenticated = new Socket("127.0.0.1", server.getLocalPort());
             BufferedReader authenticatedReader = reader(authenticated);
             BufferedReader unauthenticatedReader = reader(unauthenticated);
             BufferedWriter authenticatedWriter = writer(authenticated);
             BufferedWriter unauthenticatedWriter = writer(unauthenticated)) {
            authenticated.setSoTimeout(3000);
            unauthenticated.setSoTimeout(3000);
            sendUserAuth(authenticatedWriter, 101, "student");
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(authenticatedReader.readLine()).getType());

            Message event = Message.create(Message.Type.SUBMISSION_COMPLETED, "client:untrusted", "user:101");
            event.setPayload(Map.of("submission_id", 50));
            unauthenticatedWriter.write(event.toJsonLine());
            unauthenticatedWriter.flush();

            Message error = Message.fromJson(unauthenticatedReader.readLine());
            assertEquals(Message.Type.SERVER_ERROR.value(), error.getType());
            assertEquals("Authentication required", error.getPayload().get("error"));
            expectNoMessage(authenticated, authenticatedReader);
        } finally {
            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            serverThread.shutdownNow();
        }
    }

    @Test
    void routesByUserRoleExamSessionAndBroadcastAcrossMultipleSessions() throws Exception {
        ClientRegistry registry = testRegistry();
        RealtimeServer server = testServer(registry);
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket studentTabOne = connectWhenReady(server);
             Socket studentTabTwo = new Socket("127.0.0.1", server.getLocalPort());
             Socket teacher = new Socket("127.0.0.1", server.getLocalPort());
             Socket unauthenticated = new Socket("127.0.0.1", server.getLocalPort());
             BufferedReader studentOneReader = reader(studentTabOne);
             BufferedReader studentTwoReader = reader(studentTabTwo);
             BufferedReader teacherReader = reader(teacher);
             BufferedReader unauthenticatedReader = reader(unauthenticated);
             BufferedWriter studentOneWriter = writer(studentTabOne);
             BufferedWriter studentTwoWriter = writer(studentTabTwo);
             BufferedWriter teacherWriter = writer(teacher)) {
            for (Socket socket : new Socket[]{studentTabOne, studentTabTwo, teacher, unauthenticated}) {
                socket.setSoTimeout(3000);
            }
            sendUserAuth(studentOneWriter, 101, "teacher");
            sendUserAuth(studentTwoWriter, 101, "student");
            sendUserAuth(teacherWriter, 202, "student");
            assertEquals("student", Message.fromJson(studentOneReader.readLine()).getPayload().get("role"));
            assertEquals("student", Message.fromJson(studentTwoReader.readLine()).getPayload().get("role"));
            assertEquals("teacher", Message.fromJson(teacherReader.readLine()).getPayload().get("role"));
            assertEquals(2, registry.getHandlersByUserId(101).size(), "same user may keep multiple sessions");

            Message subscribe = Message.create(Message.Type.SUBSCRIBE, "client:student", "server");
            subscribe.setPayload(Map.of("channel", "exam:77"));
            studentOneWriter.write(subscribe.toJsonLine());
            studentOneWriter.flush();
            assertEquals("subscribed:exam:77", Message.fromJson(studentOneReader.readLine()).getPayload().get("status"));

            Message deniedSubscribe = Message.create(Message.Type.SUBSCRIBE, "client:student", "server");
            deniedSubscribe.setPayload(Map.of("channel", "exam:88"));
            studentOneWriter.write(deniedSubscribe.toJsonLine());
            studentOneWriter.flush();
            assertEquals(Message.Type.SERVER_ERROR.value(), Message.fromJson(studentOneReader.readLine()).getType());

            Message privateEvent = domainEvent(
                    Message.Type.SUBMISSION_COMPLETED, "role:student", Map.of("submission_id", 50)
            );
            server.routeMessage(privateEvent);
            assertEquals(50, ((Number) Message.fromJson(studentOneReader.readLine()).getPayload().get("submission_id")).intValue());
            assertEquals(50, ((Number) Message.fromJson(studentTwoReader.readLine()).getPayload().get("submission_id")).intValue());
            expectNoMessage(teacher, teacherReader);

            server.routeMessage(domainEvent(
                    Message.Type.SUBMISSION_COMPLETED, "role:teacher", Map.of("submission_id", 50)
            ));
            assertEquals(50, ((Number) Message.fromJson(teacherReader.readLine()).getPayload().get("submission_id")).intValue());

            server.routeMessage(domainEvent(Message.Type.EXAM_STARTED, "user:101", Map.of("exam_id", 77)));
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(studentOneReader.readLine()).getType());
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(studentTwoReader.readLine()).getType());
            expectNoMessage(teacher, teacherReader);

            server.routeMessage(domainEvent(Message.Type.SUBMISSION_COMPLETED, "broadcast", Map.of("submission_id", 51)));
            expectNoMessage(studentTabOne, studentOneReader);
            expectNoMessage(studentTabTwo, studentTwoReader);
            expectNoMessage(teacher, teacherReader);

            server.routeMessage(domainEvent(Message.Type.EXAM_STARTED, "role:student", Map.of("exam_id", 77)));
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(studentOneReader.readLine()).getType());
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(studentTwoReader.readLine()).getType());
            expectNoMessage(teacher, teacherReader);

            server.routeMessage(domainEvent(Message.Type.EXAM_ENDED, "exam:77", Map.of("exam_id", 77)));
            assertEquals(Message.Type.EXAM_ENDED.value(), Message.fromJson(studentOneReader.readLine()).getType());
            expectNoMessage(studentTabTwo, studentTwoReader);

            String teacherSession = registry.getHandlersByUserId(202).get(0).getConnectionId();
            server.routeMessage(domainEvent(
                    Message.Type.EXAM_ANNOUNCEMENT,
                    "session:" + teacherSession,
                    Map.of("exam_id", 77, "message", "Targeted session")
            ));
            assertEquals("Targeted session", Message.fromJson(teacherReader.readLine()).getPayload().get("message"));
            expectNoMessage(studentTabOne, studentOneReader);

            server.routeMessage(domainEvent(Message.Type.EXAM_STARTED, "broadcast", Map.of("exam_id", 77)));
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(studentOneReader.readLine()).getType());
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(studentTwoReader.readLine()).getType());
            assertEquals(Message.Type.EXAM_STARTED.value(), Message.fromJson(teacherReader.readLine()).getType());
            expectNoMessage(unauthenticated, unauthenticatedReader);
        } finally {
            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            serverThread.shutdownNow();
        }
    }

    @Test
    void slowClientDoesNotBlockBroadcastDeliveryToFastClient() throws Exception {
        RealtimeServer server = testServer(testRegistry());
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
            BufferedReader slowReader = reader(slow);
            BufferedReader fastReader = reader(fast);
            BufferedWriter slowWriter = writer(slow);
            BufferedWriter fastWriter = writer(fast);
            awaitCondition(() -> server.getRegistry().onlineCount() == 2, "both TCP clients to register");
            slow.setSoTimeout(3000);
            fast.setSoTimeout(3000);
            sendUserAuth(slowWriter, 101, "student");
            sendUserAuth(fastWriter, 202, "teacher");
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(slowReader.readLine()).getType());
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(fastReader.readLine()).getType());

            final int messageCount = 256;
            String padding = "x".repeat(3500);
            Future<String> lastMessage = readerThread.submit(() -> {
                String line;
                while ((line = fastReader.readLine()) != null) {
                    if (line.contains("sequence=" + (messageCount - 1) + ":")) {
                        return line;
                    }
                }
                throw new IOException("Fast client closed before receiving the final broadcast");
            });

            long startedAt = System.nanoTime();
            for (int sequence = 0; sequence < messageCount; sequence++) {
                Message event = Message.create(Message.Type.EXAM_ANNOUNCEMENT, "test", "broadcast");
                event.setPayload(Map.of("exam_id", 1, "message", "sequence=" + sequence + ":" + padding));
                server.broadcast(event);
                Thread.sleep(2);
            }
            long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);

            assertTrue(elapsedMillis < Duration.ofSeconds(8).toMillis(),
                    "broadcast enqueueing should not wait on a slow client");
            assertTrue(lastMessage.get(10, TimeUnit.SECONDS).contains("sequence=" + (messageCount - 1) + ":"));
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
        RealtimeServer server = testServer(testRegistry());
        ExecutorService serverThread = Executors.newSingleThreadExecutor();
        Future<?> serverRun = startServer(server, serverThread);

        try (Socket service = connectWhenReady(server);
             Socket student = new Socket("127.0.0.1", server.getLocalPort());
             Socket teacher = new Socket("127.0.0.1", server.getLocalPort());
             BufferedReader reader = reader(service);
             BufferedReader studentReader = reader(student);
             BufferedReader teacherReader = reader(teacher);
             BufferedWriter writer = new BufferedWriter(
                     new OutputStreamWriter(service.getOutputStream(), StandardCharsets.UTF_8));
             BufferedWriter studentWriter = writer(student);
             BufferedWriter teacherWriter = writer(teacher)) {
            service.setSoTimeout(3000);
            student.setSoTimeout(3000);
            teacher.setSoTimeout(3000);

            Message hello = Message.create(Message.Type.AUTH, "fastapi", "server");
            writer.write(hello.toJsonLine());
            writer.flush();

            Message challenge = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.AUTH.value(), challenge.getType());
            String proof = createProof(
                    "test-only-shared-secret",
                    challenge.getPayload().get("challenge").toString()
            );
            Message proofMessage = Message.create(Message.Type.AUTH, "fastapi", "server");
            proofMessage.setPayload(Map.of("proof", proof));
            writer.write(proofMessage.toJsonLine());
            writer.flush();

            Message status = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.CLIENT_STATUS.value(), status.getType());
            assertEquals(Boolean.TRUE, status.getPayload().get("authenticated"));
            assertEquals(Boolean.TRUE, status.getPayload().get("service"));

            Message ping = Message.create(Message.Type.PING, "fastapi", "server");
            writer.write(ping.toJsonLine());
            writer.flush();
            Message pong = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.PONG.value(), pong.getType());

            Message event = Message.create(Message.Type.EXAM_STARTED, "fastapi", "broadcast");
            event.setPayload(Map.of("exam_id", 17));
            writer.write(event.toJsonLine());
            writer.flush();

            Message routed = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.EXAM_STARTED.value(), routed.getType());
            assertEquals(17, routed.getPayload().get("exam_id"));

            Message examTargeted = Message.create(Message.Type.EXAM_STARTED, "fastapi", "exam:17");
            examTargeted.setPayload(Map.of("exam_id", 17, "title", "Bridge round trip"));
            writer.write(examTargeted.toJsonLine());
            writer.flush();
            Message returnedExamEvent = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.EXAM_STARTED.value(), returnedExamEvent.getType());
            assertEquals("exam:17", returnedExamEvent.getRecipient());
            assertEquals("Bridge round trip", returnedExamEvent.getPayload().get("title"));

            Message returned = Message.create(Message.Type.EXAM_ENDED, "java", "role:service");
            returned.setPayload(Map.of("exam_id", 17));
            server.routeMessage(returned);
            Message receivedFromJava = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.EXAM_ENDED.value(), receivedFromJava.getType());
            assertEquals(17, receivedFromJava.getPayload().get("exam_id"));

            sendUserAuth(studentWriter, 101, "student");
            sendUserAuth(teacherWriter, 202, "teacher");
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(studentReader.readLine()).getType());
            assertEquals(Message.Type.CLIENT_STATUS.value(), Message.fromJson(teacherReader.readLine()).getType());

            Message submissionStatus = Message.create(
                    Message.Type.SUBMISSION_STATUS, "fastapi", "role:student"
            );
            submissionStatus.setPayload(Map.of("submission_id", 50, "status", "running"));
            writer.write(submissionStatus.toJsonLine());
            writer.flush();

            Message returnedSubmissionEvent = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.SUBMISSION_STATUS.value(), returnedSubmissionEvent.getType());
            assertEquals("role:student", returnedSubmissionEvent.getRecipient());
            assertEquals("running", returnedSubmissionEvent.getPayload().get("status"));
            assertEquals(Message.Type.SUBMISSION_STATUS.value(), Message.fromJson(studentReader.readLine()).getType());
            expectNoMessage(teacher, teacherReader);
        } finally {
            server.stop();
            serverRun.get(5, TimeUnit.SECONDS);
            serverThread.shutdownNow();
        }
    }

    private static String createProof(String secret, String challenge) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(challenge.getBytes(StandardCharsets.US_ASCII)));
    }

    private static ClientRegistry testRegistry() {
        ClientRegistry.UserLookup users = userId -> switch (userId) {
            case 101 -> Optional.of(new ClientRegistry.UserInfo(101, "student-101", "Student", "student"));
            case 202 -> Optional.of(new ClientRegistry.UserInfo(202, "teacher-202", "Teacher", "teacher"));
            default -> Optional.empty();
        };
        ClientRegistry.ExamAccess examAccess = (userId, role, examId) -> examId == 77
                && ((userId == 101 && "student".equals(role)) || (userId == 202 && "teacher".equals(role)));
        ClientRegistry.SubmissionLookup submissions = submissionId -> submissionId == 50 || submissionId == 51
                ? Optional.of(new ClientRegistry.SubmissionRecipients(101, 202))
                : Optional.empty();
        return new ClientRegistry(users, examAccess, submissions);
    }

    private static RealtimeServer testServer(ClientRegistry registry) {
        return new RealtimeServer("127.0.0.1", 0, "test-only-shared-secret",
                JWT_SECRET, "HS256", registry);
    }

    private static void sendUserAuth(BufferedWriter writer, int userId, String tokenRole) throws Exception {
        Message auth = Message.create(Message.Type.AUTH, "client:test-tab", "server");
        auth.setPayload(Map.of("access_token", createAccessToken(
                userId, tokenRole, Instant.now().plusSeconds(300)
        )));
        writer.write(auth.toJsonLine());
        writer.flush();
    }

    private static String createAccessToken(int userId, String tokenRole, Instant expiresAt) throws Exception {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String header = encoder.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"
                .getBytes(StandardCharsets.UTF_8));
        String claims = encoder.encodeToString(("{\"user_id\":" + userId
                + ",\"role\":\"" + tokenRole + "\",\"exp\":" + expiresAt.getEpochSecond() + "}")
                .getBytes(StandardCharsets.UTF_8));
        String signingInput = header + "." + claims;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(JWT_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String signature = encoder.encodeToString(mac.doFinal(signingInput.getBytes(StandardCharsets.US_ASCII)));
        return signingInput + "." + signature;
    }

    private static void assertRejectedAuthentication(RealtimeServer server, String accessToken) throws Exception {
        try (Socket socket = connectWhenReady(server);
             BufferedReader reader = reader(socket);
             BufferedWriter writer = writer(socket)) {
            socket.setSoTimeout(3000);
            Message auth = Message.create(Message.Type.AUTH, "client:untrusted", "server");
            if (accessToken != null) {
                auth.setPayload(Map.of("access_token", accessToken));
            }
            writer.write(auth.toJsonLine());
            writer.flush();
            assertNull(reader.readLine(), "invalid or missing credentials must close the TCP connection");
        }
    }

    private static void assertRejectedLegacyIdentityClaim(RealtimeServer server) throws Exception {
        try (Socket socket = connectWhenReady(server);
             BufferedReader reader = reader(socket);
             BufferedWriter writer = writer(socket)) {
            socket.setSoTimeout(3000);
            Message hello = Message.create(Message.Type.CLIENT_HELLO, "client:untrusted", "server");
            hello.setPayload(Map.of("user_id", 101));
            writer.write(hello.toJsonLine());
            writer.flush();
            assertNull(reader.readLine(), "a raw user_id claim must not authenticate a session");
        }
    }

    private static Message domainEvent(Message.Type type, String recipient, Map<String, Object> payload) {
        Message message = Message.create(type, "fastapi", recipient);
        message.setPayload(payload);
        return message;
    }

    private static void expectNoMessage(Socket socket, BufferedReader reader) throws Exception {
        socket.setSoTimeout(150);
        assertThrows(SocketTimeoutException.class, reader::readLine, "unexpected event was routed to this session");
        socket.setSoTimeout(3000);
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

    private static BufferedWriter writer(Socket socket) throws IOException {
        return new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
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
