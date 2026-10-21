package com.exam.realtime;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JSON message envelope for all realtime communication.
 * Uses newline-delimited JSON (one message per line) over TCP.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Message {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public enum Type {
        // Client → Server
        CLIENT_HELLO("client.hello"),
        CLIENT_HEARTBEAT("client.heartbeat"),
        CLIENT_STATUS("client.status"),

        // Server → Client
        EXAM_STARTED("exam.started"),
        EXAM_ENDED("exam.ended"),
        EXAM_ANNOUNCEMENT("exam.announcement"),
        SUBMISSION_RECEIVED("submission.received"),
        SUBMISSION_STATUS("submission.status"),
        SUBMISSION_COMPLETED("submission.completed"),
        SERVER_ERROR("server.error");

        private final String value;

        Type(String value) {
            this.value = value;
        }

        public String value() {
            return value;
        }

        public static Type fromString(String s) {
            for (Type t : values()) {
                if (t.value.equals(s)) return t;
            }
            return null;
        }
    }

    private String type;
    private String requestId;
    private String sender;
    private String recipient;
    private String timestamp;
    private Map<String, Object> payload;

    private Message() {}

    /**
     * Creates a new message with auto-generated request ID and current timestamp.
     */
    public static Message create(Type type, String sender, String recipient) {
        Message msg = new Message();
        msg.type = type.value();
        msg.requestId = UUID.randomUUID().toString();
        msg.sender = sender;
        msg.recipient = recipient;
        msg.timestamp = Instant.now().toString();
        return msg;
    }

    /**
     * Deserializes a JSON line into a Message object.
     */
    public static Message fromJson(String json) throws JsonProcessingException {
        return MAPPER.readValue(json, Message.class);
    }

    /**
     * Serializes this message to a single-line JSON string.
     */
    public String toJson() throws JsonProcessingException {
        return MAPPER.writeValueAsString(this);
    }

    // --- getters / setters ---

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getRequestId() { return requestId; }
    public void setRequestId(String requestId) { this.requestId = requestId; }

    public String getSender() { return sender; }
    public void setSender(String sender) { this.sender = sender; }

    public String getRecipient() { return recipient; }
    public void setRecipient(String recipient) { this.recipient = recipient; }

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }

    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
}