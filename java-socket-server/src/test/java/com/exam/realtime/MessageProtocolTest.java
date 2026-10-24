package com.exam.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class MessageProtocolTest {

    @Test
    void acceptsAndRoundTripsValidNormalizedMessage() throws Exception {
        Message original = announcement();

        Message parsed = Message.fromJson(original.toJson());

        assertEquals(Message.Type.EXAM_ANNOUNCEMENT.value(), parsed.getType());
        assertEquals(original.getRequestId(), parsed.getRequestId());
        assertEquals(17, ((Number) parsed.getPayload().get("exam_id")).intValue());
        assertTrue(original.toJson().contains("\"event_id\":"));
        assertFalse(original.toJson().contains("\"request_id\":"));
        assertEquals(original.toJson() + "\n", original.toJsonLine());
    }

    @Test
    void rejectsInvalidJson() {
        assertThrows(JsonProcessingException.class, () -> Message.fromJson("{not-json}"));
    }

    @Test
    void rejectsMissingType() {
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(validEnvelope(
                "", "student:12", "{\"exam_id\":17,\"message\":\"Ready\"}", true
        )));
    }

    @Test
    void rejectsMissingEventIdAndPayload() {
        String missingEventId = validEnvelope(
                "exam.started", "broadcast", "{\"exam_id\":17}", false
        ).replace("\"event_id\":\"550e8400-e29b-41d4-a716-446655440000\",", "");
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(missingEventId));

        String missingPayload = validEnvelope(
                "ping", "server", "{}", false
        ).replace(",\"payload\":{}", "");
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(missingPayload));
    }

    @Test
    void rejectsMissingSenderRecipientAndTimestamp() {
        String envelope = validEnvelope("ping", "server", "{}", false);
        assertThrows(Message.ValidationException.class,
                () -> Message.fromJson(envelope.replace("\"sender\":\"fastapi\",", "")));
        assertThrows(Message.ValidationException.class,
                () -> Message.fromJson(envelope.replace("\"recipient\":\"server\",", "")));
        assertThrows(Message.ValidationException.class,
                () -> Message.fromJson(envelope.replace("\"timestamp\":\"2026-10-22T10:00:00Z\",", "")));
    }

    @Test
    void acceptsLegacyRequestIdFieldAliases() throws Exception {
        String legacyCamelCase = validEnvelope(
                "ping", "server", "{}", false
        ).replace("\"event_id\":", "\"requestId\":");
        assertEquals("550e8400-e29b-41d4-a716-446655440000",
                Message.fromJson(legacyCamelCase).getRequestId());
    }

    @Test
    void rejectsEmptyMessagesAndAcceptsAnEmptyPayloadObject() throws Exception {
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(""));
        assertThrows(Message.ValidationException.class, () -> Message.fromJson("  \t"));

        Message auth = Message.create(Message.Type.AUTH, "fastapi", "server");
        assertEquals("auth", Message.fromJson(auth.toJson()).getType());

        MessageFrameReader emptyFrame = new MessageFrameReader(
                new ByteArrayInputStream("\n".getBytes(StandardCharsets.UTF_8))
        );
        String frame = emptyFrame.readFrame();
        assertEquals("", frame);
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(frame));
    }

    @Test
    void rejectsUnsupportedEventType() {
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(validEnvelope(
                "piston.completed", "student:12", "{\"submission_id\":4}", false
        )));
    }

    @Test
    void rejectsMalformedRecipient() {
        Message message = announcement();
        message.setRecipient("all-students");

        assertThrows(Message.ValidationException.class, message::toJson);

        message.setRecipient("student:2147483648");
        assertThrows(Message.ValidationException.class, message::toJson);
    }

    @Test
    void rejectsInvalidTimestampAndRequestId() {
        String invalidId = validEnvelope("exam.started", "broadcast", "{\"exam_id\":17}", false)
                .replace("550e8400-e29b-41d4-a716-446655440000", "not-a-uuid");
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(invalidId));

        String conflictingAliases = validEnvelope("exam.started", "broadcast", "{\"exam_id\":17}", false)
                .replace("\"event_id\":\"550e8400-e29b-41d4-a716-446655440000\"",
                        "\"event_id\":\"550e8400-e29b-41d4-a716-446655440000\","
                                + "\"request_id\":\"550e8400-e29b-41d4-a716-446655440001\"");
        assertThrows(JsonProcessingException.class, () -> Message.fromJson(conflictingAliases));

        String invalidTimestamp = validEnvelope("exam.started", "broadcast", "{\"exam_id\":17}", false)
                .replace("2026-10-22T10:00:00Z", "yesterday");
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(invalidTimestamp));
    }

    @Test
    void rejectsPayloadWithMissingOrWrongEventFields() throws Exception {
        Message missingExamId = Message.create(Message.Type.EXAM_STARTED, "fastapi", "broadcast");
        assertThrows(Message.ValidationException.class, missingExamId::toJson);

        String wrongAnnouncementPayload = validEnvelope(
                "exam.announcement", "broadcast", "{\"exam_id\":17,\"message\":8}", false
        );
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(wrongAnnouncementPayload));

        String wrongSubmissionId = validEnvelope(
                "submission.completed", "broadcast", "{\"submission_id\":\"four\"}", false
        );
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(wrongSubmissionId));

        String overflowingUserId = validEnvelope(
                "client.hello", "server", "{\"user_id\":4294967297}", false
        );
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(overflowingUserId));

        String overflowingSubmissionId = validEnvelope(
                "submission.received", "broadcast", "{\"submission_id\":9223372036854775808}", false
        );
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(overflowingSubmissionId));
    }

    @Test
    void rejectsSensitiveFieldsAndClientClaims() throws Exception {
        String sourceCode = validEnvelope(
                "submission.received", "broadcast",
                "{\"submission_id\":4,\"source_code\":\"private source\"}", false
        );
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(sourceCode));

        Message claimedRole = Message.create(Message.Type.CLIENT_STATUS, "client:127.0.0.1", "server");
        claimedRole.setPayload(Map.of("role", "teacher"));
        assertThrows(Message.ValidationException.class, claimedRole::validateClientInput);

        String hiddenOutput = validEnvelope(
                "exam.announcement", "broadcast",
                "{\"exam_id\":17,\"message\":\"Ready\",\"hidden_expected_output\":\"secret\"}", false
        );
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(hiddenOutput));
    }

    @Test
    void rejectsUnknownEnvelopeFields() {
        String json = validEnvelope("exam.started", "broadcast", "{\"exam_id\":17}", false)
                .replace("\"timestamp\":", "\"is_admin\":true,\"timestamp\":");
        assertThrows(JsonProcessingException.class, () -> Message.fromJson(json));
    }

    @Test
    void rejectsFramesLargerThan64KiB() {
        byte[] oversized = new byte[MessageFrameReader.MAX_MESSAGE_BYTES + 1];
        assertThrows(MessageFrameReader.MessageTooLargeException.class,
                () -> new MessageFrameReader(new ByteArrayInputStream(oversized)).readFrame());

        String oversizedJson = " ".repeat(MessageFrameReader.MAX_MESSAGE_BYTES + 1);
        assertThrows(Message.ValidationException.class, () -> Message.fromJson(oversizedJson));
    }

    @Test
    void waitsForTheRestOfAPartialTcpFrame() throws Exception {
        String json = announcement().toJson();
        byte[] frame = (json + "\n").getBytes(StandardCharsets.UTF_8);
        int split = frame.length / 2;
        PipedInputStream input = new PipedInputStream(1024);
        PipedOutputStream output = new PipedOutputStream(input);
        MessageFrameReader reader = new MessageFrameReader(input);
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            var pendingFrame = executor.submit(reader::readFrame);
            output.write(frame, 0, split);
            output.flush();
            Thread.sleep(50);
            assertFalse(pendingFrame.isDone(), "reader must wait for the newline-terminated remainder");

            output.write(frame, split, frame.length - split);
            output.flush();
            assertEquals(json, pendingFrame.get(2, TimeUnit.SECONDS));
        } finally {
            output.close();
            input.close();
            executor.shutdownNow();
        }
    }

    @Test
    void readsMultipleFramesFromOneStreamAndRejectsIncompleteFinalFrame() throws Exception {
        String first = announcement().toJson();
        Message secondMessage = Message.create(Message.Type.SUBMISSION_RUNNING, "fastapi", "student:12");
        secondMessage.setPayload(Map.of("submission_id", 4));
        String second = secondMessage.toJson();
        byte[] combined = (first + "\n" + second + "\n").getBytes(StandardCharsets.UTF_8);
        MessageFrameReader reader = new MessageFrameReader(new ByteArrayInputStream(combined));

        assertEquals(first, reader.readFrame());
        assertEquals(second, reader.readFrame());
        assertNull(reader.readFrame());

        MessageFrameReader incomplete = new MessageFrameReader(
                new ByteArrayInputStream(first.getBytes(StandardCharsets.UTF_8))
        );
        assertThrows(MessageFrameReader.IncompleteMessageException.class, incomplete::readFrame);
    }

    @Test
    void acceptsCrLfDelimiterAndHandlesOneCompleteFrame() throws Exception {
        String json = announcement().toJson();
        MessageFrameReader reader = new MessageFrameReader(
                new ByteArrayInputStream((json + "\r\n").getBytes(StandardCharsets.UTF_8))
        );

        assertEquals(json, reader.readFrame());
        assertNull(reader.readFrame());
    }

    @Test
    void acceptsRequiredNormalizedSubmissionEventTypes() throws Exception {
        for (Message.Type type : new Message.Type[]{
                Message.Type.SUBMISSION_RECEIVED,
                Message.Type.SUBMISSION_RUNNING,
                Message.Type.SUBMISSION_COMPLETED,
                Message.Type.SUBMISSION_FAILED
        }) {
            Message message = Message.create(type, "fastapi", "broadcast");
            message.setPayload(type == Message.Type.SUBMISSION_FAILED
                    ? Map.of("submission_id", 9, "error_code", "GRADING_FAILED")
                    : Map.of("submission_id", 9));
            assertEquals(type.value(), Message.fromJson(message.toJson()).getType());
        }
    }

    @Test
    void representsAllRequiredProtocolEvents() throws Exception {
        Map<Message.Type, Map<String, Object>> validPayloads = Map.ofEntries(
                Map.entry(Message.Type.AUTH, Map.of()),
                Map.entry(Message.Type.PING, Map.of()),
                Map.entry(Message.Type.PONG, Map.of()),
                Map.entry(Message.Type.SUBSCRIBE, Map.of("channel", "exam:17")),
                Map.entry(Message.Type.UNSUBSCRIBE, Map.of("channel", "exam:17")),
                Map.entry(Message.Type.SUBMISSION_RECEIVED, Map.of("submission_id", 9)),
                Map.entry(Message.Type.SUBMISSION_STATUS, Map.of("submission_id", 9, "status", "running")),
                Map.entry(Message.Type.SUBMISSION_COMPLETED, Map.of("submission_id", 9)),
                Map.entry(Message.Type.SUBMISSION_ERROR, Map.of("submission_id", 9, "error_code", "GRADING_FAILED")),
                Map.entry(Message.Type.EXAM_STARTED, Map.of("exam_id", 17)),
                Map.entry(Message.Type.EXAM_ENDED, Map.of("exam_id", 17)),
                Map.entry(Message.Type.ANNOUNCEMENT_CREATED, Map.of("exam_id", 17, "message", "Ready"))
        );

        for (Map.Entry<Message.Type, Map<String, Object>> event : validPayloads.entrySet()) {
            Message message = Message.create(event.getKey(), "fastapi", "server");
            message.setPayload(event.getValue());
            Message parsed = Message.fromJson(message.toJson());
            assertEquals(event.getKey().value(), parsed.getType());
        }
    }

    @Test
    void rejectsInvalidPayloadsForNewNormalizedEvents() {
        Message status = Message.create(Message.Type.SUBMISSION_STATUS, "fastapi", "student:12");
        status.setPayload(Map.of("submission_id", 9, "status", "passed"));
        assertThrows(Message.ValidationException.class, status::toJson);

        Message subscribe = Message.create(Message.Type.SUBSCRIBE, "client:127.0.0.1", "server");
        subscribe.setPayload(Map.of("channel", " "));
        assertThrows(Message.ValidationException.class, subscribe::validateClientInput);
    }

    @Test
    void validatesChallengeResponseAuthenticationPayloads() throws Exception {
        Message challenge = Message.create(Message.Type.AUTH, "server", "client:/127.0.0.1:9000");
        challenge.setPayload(Map.of("challenge", "a".repeat(64)));
        assertEquals("auth", Message.fromJson(challenge.toJson()).getType());

        Message proof = Message.create(Message.Type.AUTH, "fastapi", "server");
        proof.setPayload(Map.of("proof", "b".repeat(64)));
        assertEquals("auth", Message.fromJson(proof.toJson()).getType());

        Message invalid = Message.create(Message.Type.AUTH, "fastapi", "server");
        invalid.setPayload(Map.of("proof", "shared-secret"));
        assertThrows(Message.ValidationException.class, invalid::toJson);

        Message secret = Message.create(Message.Type.AUTH, "fastapi", "server");
        secret.setPayload(Map.of("shared_secret", "must-not-cross-the-wire"));
        assertThrows(Message.ValidationException.class, secret::toJson);

        Message userCredential = Message.create(Message.Type.AUTH, "client:test", "server");
        userCredential.setPayload(Map.of("access_token", "signed.jwt.credential"));
        assertEquals("signed.jwt.credential",
                Message.fromJson(userCredential.toJson()).getPayload().get("access_token"));
    }

    @Test
    void acceptsUserRoleExamAndSessionRoutingRecipients() throws Exception {
        for (String recipient : new String[]{
                "user:12", "exam:42", "session:/127.0.0.1:50123"
        }) {
            Message message = Message.create(Message.Type.EXAM_STARTED, "fastapi", recipient);
            message.setPayload(Map.of("exam_id", 42));
            assertEquals(recipient, Message.fromJson(message.toJson()).getRecipient());
        }
    }

    private static Message announcement() {
        Message message = Message.create(Message.Type.EXAM_ANNOUNCEMENT, "fastapi", "role:student");
        message.setPayload(Map.of("exam_id", 17, "message", "Exam begins soon"));
        return message;
    }

    private static String validEnvelope(String type, String recipient, String payload, boolean omitType) {
        String typeField = omitType ? "" : "\"type\":\"" + type + "\",";
        return "{" + typeField
                + "\"event_id\":\"550e8400-e29b-41d4-a716-446655440000\","
                + "\"sender\":\"fastapi\","
                + "\"recipient\":\"" + recipient + "\","
                + "\"timestamp\":\"2026-10-22T10:00:00Z\","
                + "\"payload\":" + payload
                + "}";
    }
}
