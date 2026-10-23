package com.exam.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class MessageTest {

    @Test
    void testCreateAndSerialize() throws JsonProcessingException {
        Message msg = Message.create(Message.Type.EXAM_ANNOUNCEMENT, "backend", "student:42");
        msg.setPayload(Map.of("exam_id", 10, "message", "Exam has started"));

        String json = msg.toJson();
        assertNotNull(json);
        assertTrue(json.contains("exam.announcement"));
        assertTrue(json.contains("student:42"));
        assertTrue(json.contains("exam_id"));
    }

    @Test
    void testDeserialize() throws JsonProcessingException {
        String json = "{"
                + "\"type\":\"client.hello\","
                + "\"request_id\":\"550e8400-e29b-41d4-a716-446655440000\","
                + "\"sender\":\"client:127.0.0.1\","
                + "\"recipient\":\"server\","
                + "\"timestamp\":\"2025-01-01T00:00:00Z\","
                + "\"payload\":{\"user_id\":42}"
                + "}";

        Message msg = Message.fromJson(json);
        assertEquals("client.hello", msg.getType());
        assertEquals("550e8400-e29b-41d4-a716-446655440000", msg.getRequestId());
        assertEquals(42, ((Number) msg.getPayload().get("user_id")).intValue());
    }
}
