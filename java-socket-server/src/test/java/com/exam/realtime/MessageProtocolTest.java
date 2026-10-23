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
                .replace("\"request_id\":\"550e8400-e29b-41d4-a716-446655440000\"",
                        "\"request_id\":\"550e8400-e29b-41d4-a716-446655440000\","
                                + "\"requestId\":\"550e8400-e29b-41d4-a716-446655440001\"");
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

    private static Message announcement() {
        Message message = Message.create(Message.Type.EXAM_ANNOUNCEMENT, "fastapi", "role:student");
        message.setPayload(Map.of("exam_id", 17, "message", "Exam begins soon"));
        return message;
    }

    private static String validEnvelope(String type, String recipient, String payload, boolean omitType) {
        String typeField = omitType ? "" : "\"type\":\"" + type + "\",";
        return "{" + typeField
                + "\"request_id\":\"550e8400-e29b-41d4-a716-446655440000\","
                + "\"sender\":\"fastapi\","
                + "\"recipient\":\"" + recipient + "\","
                + "\"timestamp\":\"2026-10-22T10:00:00Z\","
                + "\"payload\":" + payload
                + "}";
    }
}
