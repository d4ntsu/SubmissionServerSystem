package com.exam.realtime;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Validated JSON envelope for the newline-delimited internal TCP protocol. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Message {

    private static final Pattern SENDER_PATTERN = Pattern.compile(
            "(?:[A-Za-z][A-Za-z0-9._:-]{0,127}|client:[A-Za-z0-9._:/\\[\\]%+-]{1,120})"
    );
    private static final Pattern STUDENT_RECIPIENT_PATTERN = Pattern.compile("student:[1-9][0-9]{0,9}");
    private static final Pattern USER_RECIPIENT_PATTERN = Pattern.compile("user:[1-9][0-9]{0,9}");
    private static final Pattern EXAM_RECIPIENT_PATTERN = Pattern.compile("exam:[1-9][0-9]{0,9}");
    private static final Pattern SESSION_RECIPIENT_PATTERN = Pattern.compile(
            "session:[A-Za-z0-9._:/\\[\\]%+-]{1,120}"
    );
    private static final Pattern ROLE_RECIPIENT_PATTERN = Pattern.compile("role:(?:student|teacher|service)");
    private static final Pattern CLIENT_RECIPIENT_PATTERN = Pattern.compile(
            "client:[A-Za-z0-9._:/\\[\\]%+-]{1,120}"
    );
    private static final Pattern RAW_CLIENT_ID_PATTERN = Pattern.compile("/[A-Za-z0-9._:\\[\\]%+-]{1,120}");
    private static final Pattern CODE_PATTERN = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    private static final Set<String> FORBIDDEN_PAYLOAD_KEYS = Set.of(
            "password", "hashedpassword", "token", "accesstoken", "refreshtoken", "jwt", "authorization",
            "secret", "source", "sourcecode", "code", "hiddentest", "hiddentests", "hiddenexpectedoutput",
            "expectedoutput", "testcase", "testcases", "testresult", "testresults", "score", "grade",
            "maxscore", "points", "passed", "stdout", "stderr", "compileoutput", "runtime", "memory",
            "gradingdetails"
    );

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    public enum Type {
        AUTH("auth"),
        PING("ping"),
        PONG("pong"),
        SUBSCRIBE("subscribe"),
        UNSUBSCRIBE("unsubscribe"),
        // Client → Server
        CLIENT_HELLO("client.hello"),
        CLIENT_HEARTBEAT("client.heartbeat"),
        CLIENT_STATUS("client.status"),
        EXAM_STARTED("exam.started"),
        EXAM_ENDED("exam.ended"),
        EXAM_ANNOUNCEMENT("exam.announcement"),
        SUBMISSION_RECEIVED("submission.received"),
        SUBMISSION_RUNNING("submission.running"),
        SUBMISSION_STATUS("submission.status"),
        SUBMISSION_COMPLETED("submission.completed"),
        SUBMISSION_FAILED("submission.failed"),
        SUBMISSION_ERROR("submission.error"),
        ANNOUNCEMENT_CREATED("announcement.created"),
        SERVER_ERROR("server.error");

        private final String value;

        Type(String value) {
            this.value = value;
        }

        public String value() {
            return value;
        }

        public static Type fromString(String value) {
            if (value == null) {
                return null;
            }
            for (Type type : values()) {
                if (type.value.equals(value)) {
                    return type;
                }
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

    /** Creates a message with a UUID request ID, UTC timestamp, and empty payload. */
    public static Message create(Type type, String sender, String recipient) {
        if (type == null) {
            throw new ValidationException("Message type is required");
        }
        Message message = new Message();
        message.type = type.value();
        message.requestId = UUID.randomUUID().toString();
        message.sender = sender;
        message.recipient = recipient;
        message.timestamp = Instant.now().toString();
        message.payload = new LinkedHashMap<>();
        return message;
    }

    /** Parses one JSON message and validates its envelope and event payload. */
    public static Message fromJson(String json) throws JsonProcessingException {
        if (json == null || json.isBlank()) {
            throw new ValidationException("Message must not be empty");
        }
        if (json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MessageFrameReader.MAX_MESSAGE_BYTES) {
            throw new ValidationException("Message exceeds the configured size limit");
        }
        Message message = MAPPER.readValue(json, Message.class);
        if (message == null) {
            throw new ValidationException("Message must be a JSON object");
        }
        message.validate();
        return message;
    }

    /** Serializes a validated message to JSON without the line delimiter. */
    public String toJson() throws JsonProcessingException {
        validate();
        byte[] json = MAPPER.writeValueAsBytes(this);
        if (json.length > MessageFrameReader.MAX_MESSAGE_BYTES) {
            throw new ValidationException("Message exceeds the configured size limit");
        }
        return new String(json, java.nio.charset.StandardCharsets.UTF_8);
    }

    /** Serializes a validated message as one newline-delimited UTF-8 JSON frame. */
    public String toJsonLine() throws JsonProcessingException {
        return toJson() + "\n";
    }

    /** Applies checks specific to messages received from a TCP peer. */
    public void validateClientInput() {
        validate();
        if (payload == null) {
            return;
        }

        if (type.equals(Type.CLIENT_HELLO.value())) {
            // Legacy handshake field; the handler looks up canonical account data in SQLite.
            return;
        }
        if (type.equals(Type.CLIENT_HEARTBEAT.value())) {
            if (!payload.isEmpty()) {
                throw new ValidationException("Heartbeat requests must not contain claims");
            }
            return;
        }
        if (type.equals(Type.CLIENT_STATUS.value())) {
            if (!payload.keySet().equals(Set.of("status"))) {
                throw new ValidationException("Client status may contain only a status value");
            }
            return;
        }

        for (String key : payload.keySet()) {
            String normalized = normalizeKey(key);
            if (Set.of("userid", "username", "role", "identity", "authenticated", "isonline", "onlinecount",
                    "examstatus").contains(normalized)) {
                throw new ValidationException("Client messages cannot claim identity or authoritative state");
            }
        }
    }

    private void validate() {
        Type parsedType = Type.fromString(type);
        if (parsedType == null) {
            throw new ValidationException("Unsupported message type");
        }
        if (requestId == null || !isCanonicalUuid(requestId)) {
            throw new ValidationException("requestId must be a UUID");
        }
        if (sender == null || !SENDER_PATTERN.matcher(sender).matches()) {
            throw new ValidationException("Invalid sender");
        }
        if (!isValidRecipient(recipient)) {
            throw new ValidationException("Invalid recipient");
        }
        if (timestamp == null) {
            throw new ValidationException("timestamp is required");
        }
        try {
            OffsetDateTime.parse(timestamp);
        } catch (DateTimeParseException e) {
            throw new ValidationException("timestamp must be an ISO-8601 date-time with an offset");
        }

        if (payload == null) {
            throw new ValidationException("payload is required for this message type");
        }
        validatePayload(parsedType);
    }

    private void validatePayload(Type parsedType) {
        Set<String> allowedKeys = allowedPayloadKeys(parsedType);
        for (Map.Entry<String, Object> entry : payload.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (key == null || !allowedKeys.contains(key)) {
                throw new ValidationException("Unexpected payload field");
            }
            boolean authCredential = parsedType == Type.AUTH && "access_token".equals(key);
            if (FORBIDDEN_PAYLOAD_KEYS.contains(normalizeKey(key)) && !authCredential) {
                throw new ValidationException("Payload contains a prohibited field");
            }
            if (value instanceof Map<?, ?> || value instanceof Iterable<?>) {
                throw new ValidationException("Nested payload values are not supported");
            }
            if (value instanceof String text && text.length() > 4096) {
                throw new ValidationException("Payload text exceeds the configured limit");
            }
        }

        switch (parsedType) {
            case AUTH -> {
                boolean hasChallenge = payload.containsKey("challenge");
                boolean hasProof = payload.containsKey("proof");
                boolean hasAccessToken = payload.containsKey("access_token");
                int credentialCount = (hasChallenge ? 1 : 0) + (hasProof ? 1 : 0) + (hasAccessToken ? 1 : 0);
                if (credentialCount > 1 || (credentialCount == 0 && !payload.isEmpty())) {
                    throw new ValidationException("auth payload must contain one supported credential");
                }
                if (hasChallenge) {
                    validateHexValue("challenge");
                }
                if (hasProof) {
                    validateHexValue("proof");
                }
                if (hasAccessToken) {
                    requireNonBlankString("access_token", 4096);
                }
            }
            case PING, PONG -> validateOptionalTimestamp("sent_at");
            case SUBSCRIBE, UNSUBSCRIBE -> requireNonBlankString("channel", 128);
            case CLIENT_HELLO -> requirePositiveInteger("user_id", Integer.MAX_VALUE);
            case CLIENT_HEARTBEAT -> validateOptionalBoolean("alive");
            case CLIENT_STATUS -> {
                if (payload.isEmpty()) {
                    throw new ValidationException("client.status payload must not be empty");
                }
                validateOptionalBoolean("authenticated");
                validateOptionalBoolean("service");
                validateOptionalBoolean("is_online");
                validateOptionalInteger("user_id", 1, Integer.MAX_VALUE);
                validateOptionalInteger("online_count", 0, Integer.MAX_VALUE);
                validateOptionalString("username", 100);
                validateOptionalString("role", 32);
                validateOptionalString("status", 64);
            }
            case EXAM_STARTED, EXAM_ENDED -> {
                requirePositiveInteger("exam_id");
                validateOptionalString("title", 200);
                validateOptionalTimestamp("start_time");
                validateOptionalTimestamp("end_time");
            }
            case EXAM_ANNOUNCEMENT -> {
                requirePositiveInteger("exam_id");
                validateOptionalInteger("announcement_id", 1, Long.MAX_VALUE);
                requireNonBlankString("message", 4000);
                validateOptionalTimestamp("created_at");
            }
            case ANNOUNCEMENT_CREATED -> {
                requirePositiveInteger("exam_id");
                validateOptionalInteger("announcement_id", 1, Long.MAX_VALUE);
                requireNonBlankString("message", 4000);
                validateOptionalTimestamp("created_at");
            }
            case SUBMISSION_RECEIVED, SUBMISSION_RUNNING, SUBMISSION_COMPLETED ->
                    requirePositiveInteger("submission_id");
            case SUBMISSION_STATUS -> {
                requirePositiveInteger("submission_id");
                Object status = payload.get("status");
                if (!(status instanceof String value)
                        || !Set.of("queued", "running", "completed", "error").contains(value)) {
                    throw new ValidationException("status must be a supported submission state");
                }
            }
            case SUBMISSION_FAILED -> {
                requirePositiveInteger("submission_id");
                validateOptionalCode("error_code");
            }
            case SUBMISSION_ERROR -> {
                requirePositiveInteger("submission_id");
                validateOptionalCode("error_code");
            }
            case SERVER_ERROR -> {
                requireNonBlankString("error", 500);
                validateOptionalCode("code");
            }
        }
    }

    private static Set<String> allowedPayloadKeys(Type type) {
        return switch (type) {
            case AUTH -> Set.of("challenge", "proof", "access_token");
            case PING, PONG -> Set.of("sent_at");
            case SUBSCRIBE, UNSUBSCRIBE -> Set.of("channel");
            case CLIENT_HELLO -> Set.of("user_id");
            case CLIENT_HEARTBEAT -> Set.of("alive");
            case CLIENT_STATUS -> Set.of("authenticated", "user_id", "username", "role", "online_count",
                    "status", "is_online", "service");
            case EXAM_STARTED, EXAM_ENDED -> Set.of("exam_id", "title", "start_time", "end_time");
            case EXAM_ANNOUNCEMENT -> Set.of("exam_id", "announcement_id", "message", "created_at");
            case ANNOUNCEMENT_CREATED -> Set.of("exam_id", "announcement_id", "message", "created_at");
            case SUBMISSION_RECEIVED, SUBMISSION_RUNNING, SUBMISSION_COMPLETED -> Set.of("submission_id");
            case SUBMISSION_STATUS -> Set.of("submission_id", "status");
            case SUBMISSION_FAILED -> Set.of("submission_id", "error_code");
            case SUBMISSION_ERROR -> Set.of("submission_id", "error_code");
            case SERVER_ERROR -> Set.of("error", "code");
        };
    }

    private void requirePositiveInteger(String key) {
        requirePositiveInteger(key, Long.MAX_VALUE);
    }

    private void requirePositiveInteger(String key, long maximum) {
        if (!payload.containsKey(key)) {
            throw new ValidationException(key + " is required");
        }
        validateOptionalInteger(key, 1, maximum);
    }

    private void validateOptionalInteger(String key, long minimum, long maximum) {
        if (!payload.containsKey(key)) {
            return;
        }
        Object value = payload.get(key);
        if (!(value instanceof Number number)) {
            throw new ValidationException(key + " must be an integer");
        }
        long integer;
        try {
            integer = new BigDecimal(number.toString()).longValueExact();
        } catch (NumberFormatException | ArithmeticException e) {
            throw new ValidationException(key + " must be an integer in the permitted range");
        }
        if (integer < minimum || integer > maximum) {
            throw new ValidationException(key + " is outside the permitted range");
        }
    }

    private void validateOptionalBoolean(String key) {
        if (payload.containsKey(key) && !(payload.get(key) instanceof Boolean)) {
            throw new ValidationException(key + " must be a boolean");
        }
    }

    private void validateOptionalString(String key, int maxLength) {
        if (!payload.containsKey(key)) {
            return;
        }
        Object value = payload.get(key);
        if (!(value instanceof String text) || text.length() > maxLength) {
            throw new ValidationException(key + " must be a string within the permitted length");
        }
    }

    private void requireNonBlankString(String key, int maxLength) {
        validateOptionalString(key, maxLength);
        Object value = payload.get(key);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new ValidationException(key + " is required");
        }
    }

    private void validateOptionalTimestamp(String key) {
        if (!payload.containsKey(key)) {
            return;
        }
        Object value = payload.get(key);
        if (!(value instanceof String text)) {
            throw new ValidationException(key + " must be an ISO-8601 date-time");
        }
        try {
            OffsetDateTime.parse(text);
        } catch (DateTimeParseException e) {
            throw new ValidationException(key + " must be an ISO-8601 date-time");
        }
    }

    private void validateOptionalCode(String key) {
        if (payload.containsKey(key)
                && (!(payload.get(key) instanceof String code) || !CODE_PATTERN.matcher(code).matches())) {
            throw new ValidationException(key + " has an invalid format");
        }
    }

    private void validateHexValue(String key) {
        if (!(payload.get(key) instanceof String value) || !value.matches("[0-9a-f]{64}")) {
            throw new ValidationException(key + " must be a 64-character lowercase hexadecimal value");
        }
    }

    private static boolean isCanonicalUuid(String value) {
        try {
            return UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static boolean isValidRecipient(String recipient) {
        if (recipient == null || recipient.length() > 128) {
            return false;
        }
        if (STUDENT_RECIPIENT_PATTERN.matcher(recipient).matches()) {
            try {
                return Integer.parseInt(recipient.substring("student:".length())) > 0;
            } catch (NumberFormatException e) {
                return false;
            }
        }
        if (SESSION_RECIPIENT_PATTERN.matcher(recipient).matches()) {
            return true;
        }
        if (USER_RECIPIENT_PATTERN.matcher(recipient).matches()
                || EXAM_RECIPIENT_PATTERN.matcher(recipient).matches()) {
            try {
                return Integer.parseInt(recipient.substring(recipient.indexOf(':') + 1)) > 0;
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return recipient.equals("server")
                || recipient.equals("broadcast")
                || ROLE_RECIPIENT_PATTERN.matcher(recipient).matches()
                || CLIENT_RECIPIENT_PATTERN.matcher(recipient).matches()
                || RAW_CLIENT_ID_PATTERN.matcher(recipient).matches();
    }

    private static String normalizeKey(String key) {
        return key.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
    }

    public static final class ValidationException extends IllegalArgumentException {
        public ValidationException(String message) {
            super(message);
        }
    }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    @JsonProperty("event_id")
    public String getRequestId() { return requestId; }
    @JsonProperty("event_id")
    @JsonAlias({"requestId", "request_id"})
    public void setRequestId(String requestId) {
        if (this.requestId != null) {
            throw new ValidationException("event_id must not be specified more than once");
        }
        this.requestId = requestId;
    }

    public String getSender() { return sender; }
    public void setSender(String sender) { this.sender = sender; }

    public String getRecipient() { return recipient; }
    public void setRecipient(String recipient) { this.recipient = recipient; }

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }

    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
}
