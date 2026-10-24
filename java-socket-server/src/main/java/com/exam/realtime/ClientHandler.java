package com.exam.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.Base64;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Handles one TCP session. FastAPI uses challenge-response authentication;
 * user sessions authenticate with the backend's signed access token.
 */
public class ClientHandler implements Runnable {

    private static final Logger LOGGER = Logger.getLogger(ClientHandler.class.getName());
    private static final int DEFAULT_HEARTBEAT_TIMEOUT_MILLIS = 90_000;
    private static final int OUTBOUND_QUEUE_SIZE = 256;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final ObjectMapper JWT_JSON = new ObjectMapper();

    private final Socket socket;
    private final ClientRegistry registry;
    private final RealtimeServer server;
    private final int heartbeatTimeoutMillis;
    private final String sharedSecret;
    private final String jwtSecret;
    private final String jwtAlgorithm;
    private final BlockingQueue<Message> outboundMessages = new ArrayBlockingQueue<>(OUTBOUND_QUEUE_SIZE);
    private final AtomicBoolean socketClosed = new AtomicBoolean();
    private final AtomicBoolean disconnected = new AtomicBoolean();

    private final String clientId;
    private final Instant connectedAt = Instant.now();
    private final Set<Integer> subscribedExams = ConcurrentHashMap.newKeySet();
    private volatile Integer userId;
    private volatile String role;
    private volatile String username;
    private volatile String clientType = "unknown";
    private volatile boolean authenticated;
    private volatile String authChallenge;
    private volatile Instant tokenExpiresAt;
    private volatile Instant lastSeen = connectedAt;

    private MessageFrameReader in;
    private PrintWriter out;
    private volatile Future<?> writerTask;

    public ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server) {
        this(socket, registry, server, DEFAULT_HEARTBEAT_TIMEOUT_MILLIS,
                Config.getSharedSecret(), Config.getJwtSecret(), Config.getJwtAlgorithm());
    }

    public ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server, int heartbeatTimeoutMillis) {
        this(socket, registry, server, heartbeatTimeoutMillis,
                Config.getSharedSecret(), Config.getJwtSecret(), Config.getJwtAlgorithm());
    }

    public ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server, String sharedSecret) {
        this(socket, registry, server, DEFAULT_HEARTBEAT_TIMEOUT_MILLIS,
                sharedSecret, Config.getJwtSecret(), Config.getJwtAlgorithm());
    }

    public ClientHandler(
            Socket socket,
            ClientRegistry registry,
            RealtimeServer server,
            int heartbeatTimeoutMillis,
            String sharedSecret
    ) {
        this(socket, registry, server, heartbeatTimeoutMillis,
                sharedSecret, Config.getJwtSecret(), Config.getJwtAlgorithm());
    }

    public ClientHandler(
            Socket socket,
            ClientRegistry registry,
            RealtimeServer server,
            int heartbeatTimeoutMillis,
            String sharedSecret,
            String jwtSecret,
            String jwtAlgorithm
    ) {
        if (socket == null || registry == null || server == null) {
            throw new IllegalArgumentException("Socket, registry, and server are required");
        }
        if (heartbeatTimeoutMillis <= 0) {
            throw new IllegalArgumentException("Heartbeat timeout must be positive");
        }
        this.socket = socket;
        this.registry = registry;
        this.server = server;
        this.heartbeatTimeoutMillis = heartbeatTimeoutMillis;
        this.sharedSecret = sharedSecret == null ? "" : sharedSecret;
        this.jwtSecret = jwtSecret == null ? "" : jwtSecret;
        this.jwtAlgorithm = jwtAlgorithm == null ? "" : jwtAlgorithm;
        this.clientId = String.valueOf(socket.getRemoteSocketAddress());
    }

    @Override
    public void run() {
        try {
            socket.setSoTimeout(heartbeatTimeoutMillis);
            InputStream socketInput = socket.getInputStream();
            in = new MessageFrameReader(socketInput);
            out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);
            writerTask = server.submitClientTask(this::writeLoop);

            LOGGER.log(Level.INFO, "TCP client connected: {0}", clientId);
            while (!socketClosed.get()) {
                String line;
                try {
                    line = in.readFrame();
                } catch (MessageFrameReader.InvalidUtf8Exception e) {
                    sendError("Invalid UTF-8 message");
                    continue;
                }
                if (line == null) {
                    break;
                }

                try {
                    Message message = Message.fromJson(line);
                    message.validateClientInput();
                    handleMessage(message);
                } catch (Exception e) {
                    LOGGER.log(Level.WARNING, "Rejected malformed TCP message from {0}: {1}",
                            new Object[]{clientId, e.getClass().getSimpleName()});
                    sendError("Invalid message");
                }
            }
        } catch (IOException e) {
            if (!socketClosed.get()) {
                LOGGER.log(Level.FINE, "TCP client disconnected: {0} ({1})",
                        new Object[]{clientId, e.getClass().getSimpleName()});
            }
        } catch (RejectedExecutionException e) {
            LOGGER.log(Level.WARNING, "Could not start TCP writer for client {0}", clientId);
        } finally {
            onDisconnect();
        }
    }

    private void handleMessage(Message message) {
        if ("user".equals(clientType) && tokenExpiresAt != null && !tokenExpiresAt.isAfter(Instant.now())) {
            rejectAuthentication();
            return;
        }
        lastSeen = Instant.now();
        Message.Type type = Message.Type.fromString(message.getType());
        if (type == null) {
            sendError("Unknown message type");
            return;
        }

        switch (type) {
            case AUTH -> handleAuthentication(message);
            case CLIENT_HELLO -> rejectAuthentication();
            case CLIENT_HEARTBEAT -> handleHeartbeat();
            case CLIENT_STATUS -> handleStatus(message);
            case SUBSCRIBE -> handleExamSubscription(message, true);
            case UNSUBSCRIBE -> handleExamSubscription(message, false);
            case PING -> handlePing();
            case PONG -> { }
            default -> {
                if (!authenticated) {
                    sendError("Authentication required");
                    return;
                }
                if (!"service".equals(clientType)) {
                    sendError("Authenticated clients cannot publish realtime domain events");
                    return;
                }
                server.routeMessage(message);
            }
        }
    }

    private void handleAuthentication(Message message) {
        if ("fastapi".equals(message.getSender())) {
            handleServiceAuthentication(message);
        } else if (message.getSender() != null && message.getSender().startsWith("client:")) {
            handleUserAuthentication(message);
        } else {
            rejectAuthentication();
        }
    }

    private void handleServiceAuthentication(Message message) {
        if (authenticated
                || !"fastapi".equals(message.getSender())
                || !"server".equals(message.getRecipient())
                || sharedSecret.isBlank()) {
            rejectAuthentication();
            return;
        }

        Map<String, Object> payload = message.getPayload();
        Object suppliedProof = payload.get("proof");
        if (suppliedProof instanceof String proof) {
            String challenge = authChallenge;
            authChallenge = null;
            if (challenge == null || !verifyProof(challenge, proof)) {
                rejectAuthentication();
                return;
            }

            authenticated = true;
            role = "service";
            clientType = "service";
            lastSeen = Instant.now();
            Message status = Message.create(Message.Type.CLIENT_STATUS, "server", "client:" + clientId);
            status.setPayload(Map.of("authenticated", true, "service", true));
            send(status);
            return;
        }

        if (!payload.isEmpty()) {
            rejectAuthentication();
            return;
        }

        byte[] nonce = new byte[32];
        SECURE_RANDOM.nextBytes(nonce);
        authChallenge = HexFormat.of().formatHex(nonce);
        Message challenge = Message.create(Message.Type.AUTH, "server", "client:" + clientId);
        challenge.setPayload(Map.of("challenge", authChallenge));
        send(challenge);
    }

    private void handleUserAuthentication(Message message) {
        if (authenticated || !"server".equals(message.getRecipient())) {
            rejectAuthentication();
            return;
        }
        Object credential = message.getPayload().get("access_token");
        if (!(credential instanceof String token)) {
            rejectAuthentication();
            return;
        }

        AuthenticatedUser verified = authenticateAccessToken(token);
        if (verified == null || !Set.of("student", "teacher").contains(verified.user().role())) {
            rejectAuthentication();
            return;
        }

        ClientRegistry.UserInfo user = verified.user();
        userId = user.id();
        username = user.username();
        role = user.role();
        tokenExpiresAt = verified.expiresAt();
        clientType = "user";
        authenticated = true;
        lastSeen = Instant.now();
        registry.associateUser(clientId, user.id());

        Message status = Message.create(Message.Type.CLIENT_STATUS, "server", "client:" + clientId);
        status.setPayload(Map.of(
                "authenticated", true,
                "user_id", user.id(),
                "username", user.username(),
                "role", user.role(),
                "online_count", registry.onlineCount()
        ));
        send(status);
    }

    private AuthenticatedUser authenticateAccessToken(String token) {
        if (jwtSecret.isBlank() || !"HS256".equals(jwtAlgorithm) || token.length() > 4096) {
            return null;
        }
        try {
            String[] segments = token.split("\\.", -1);
            if (segments.length != 3) {
                return null;
            }

            JsonNode header = JWT_JSON.readTree(Base64.getUrlDecoder().decode(segments[0]));
            JsonNode claims = JWT_JSON.readTree(Base64.getUrlDecoder().decode(segments[1]));
            if (!header.path("alg").isTextual() || !"HS256".equals(header.path("alg").textValue())) {
                return null;
            }

            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(jwtSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal((segments[0] + "." + segments[1]).getBytes(StandardCharsets.US_ASCII));
            byte[] supplied = Base64.getUrlDecoder().decode(segments[2]);
            if (!MessageDigest.isEqual(expected, supplied)) {
                return null;
            }

            JsonNode expiry = claims.get("exp");
            JsonNode claimUserId = claims.get("user_id");
            if (expiry == null || !expiry.canConvertToLong() || expiry.longValue() <= Instant.now().getEpochSecond()
                    || claimUserId == null || !claimUserId.isIntegralNumber()
                    || !claimUserId.canConvertToInt() || claimUserId.intValue() <= 0) {
                return null;
            }
            JsonNode notBefore = claims.get("nbf");
            if (notBefore != null && (!notBefore.canConvertToLong()
                    || notBefore.longValue() > Instant.now().getEpochSecond())) {
                return null;
            }

            ClientRegistry.UserInfo user = registry.findUserById(claimUserId.intValue()).orElse(null);
            return user == null ? null : new AuthenticatedUser(user, Instant.ofEpochSecond(expiry.longValue()));
        } catch (Exception e) {
            return null;
        }
    }

    private record AuthenticatedUser(ClientRegistry.UserInfo user, Instant expiresAt) {}

    private boolean verifyProof(String challenge, String proof) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(sharedSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal(challenge.getBytes(StandardCharsets.US_ASCII));
            byte[] actual = HexFormat.of().parseHex(proof);
            return MessageDigest.isEqual(expected, actual);
        } catch (Exception e) {
            return false;
        }
    }

    private void rejectAuthentication() {
        authChallenge = null;
        LOGGER.log(Level.WARNING, "Rejected TCP authentication from {0}", clientId);
        onDisconnect();
    }

    private void handleExamSubscription(Message message, boolean subscribe) {
        if (!authenticated || !"user".equals(clientType) || userId == null) {
            sendError("Authenticated user session required");
            return;
        }
        String channel = (String) message.getPayload().get("channel");
        if (channel == null || !channel.startsWith("exam:")) {
            sendError("Only exam channels are supported");
            return;
        }
        int examId;
        try {
            examId = Integer.parseInt(channel.substring("exam:".length()));
        } catch (NumberFormatException e) {
            sendError("Invalid exam channel");
            return;
        }

        if (subscribe && !registry.canAccessExam(userId, role, examId)) {
            sendError("Not authorized for this exam");
            return;
        }
        if (subscribe) {
            subscribedExams.add(examId);
        } else {
            subscribedExams.remove(examId);
        }
        Message status = Message.create(Message.Type.CLIENT_STATUS, "server", "client:" + clientId);
        status.setPayload(Map.of(
                "authenticated", true,
                "status", (subscribe ? "subscribed:" : "unsubscribed:") + channel
        ));
        send(status);
    }

    private void handlePing() {
        if (!authenticated) {
            sendError("Authentication required");
            return;
        }
        Message pong = Message.create(Message.Type.PONG, "server", "client:" + clientId);
        pong.setPayload(Map.of());
        send(pong);
    }

    private void handleHeartbeat() {
        if (!authenticated) {
            sendError("Authentication required");
            return;
        }
        lastSeen = Instant.now();
        if (authenticated && userId != null) {
            registry.markSeen(userId);
        }
        if (authenticated) {
            Message pong = Message.create(Message.Type.CLIENT_HEARTBEAT, "server", "client:" + clientId);
            pong.setPayload(Map.of("alive", true));
            send(pong);
        }
    }

    private void handleStatus(Message message) {
        if (authenticated && "service".equals(clientType)) {
            server.routeMessage(message);
        } else {
            sendError("Client status messages cannot be asserted by users");
        }
    }

    /** Enqueue a message so a slow receiver cannot block other TCP clients. */
    public void send(Message message) {
        if (message == null || socketClosed.get()) {
            return;
        }
        if (!outboundMessages.offer(message)) {
            LOGGER.log(Level.WARNING, "TCP outbound queue is full for client {0}", clientId);
            onDisconnect();
        }
    }

    /** Compatibility alias used by existing routing code. */
    public void sendMessage(Message message) {
        send(message);
    }

    private void writeLoop() {
        while (!socketClosed.get()) {
            try {
                Message message = outboundMessages.take();
                PrintWriter writer = out;
                if (writer == null) {
                    continue;
                }
                writer.println(message.toJson());
                if (writer.checkError()) {
                    throw new IOException("TCP message write failed");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (RuntimeException e) {
                LOGGER.log(Level.WARNING, "Rejected outbound message for client {0}: {1}",
                        new Object[]{clientId, e.getClass().getSimpleName()});
            } catch (IOException e) {
                LOGGER.log(Level.FINE, "TCP write failed for client {0}: {1}",
                        new Object[]{clientId, e.getClass().getSimpleName()});
                onDisconnect();
                break;
            }
        }
    }

    public void sendError(String detail) {
        if (detail == null || detail.isBlank()) {
            detail = "Invalid message";
        }
        Message error = Message.create(Message.Type.SERVER_ERROR, "server", "client:" + clientId);
        error.setPayload(Map.of("error", detail));
        send(error);
    }

    /** Closes the transport; registry cleanup runs once in onDisconnect(). */
    public void close() {
        if (!socketClosed.compareAndSet(false, true)) {
            return;
        }
        outboundMessages.clear();
        Future<?> currentWriter = writerTask;
        if (currentWriter != null) {
            currentWriter.cancel(true);
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // The connection is already being closed.
        }
    }

    public void onDisconnect() {
        close();
        if (disconnected.compareAndSet(false, true)) {
            registry.unregisterClient(clientId);
            LOGGER.log(Level.INFO, "TCP client disconnected: {0}", clientId);
        }
    }

    public String getClientId() { return clientId; }
    public String getConnectionId() { return clientId; }
    public Integer getUserId() { return userId; }
    public String getRole() { return role; }
    public String getUsername() { return username; }
    public String getClientType() { return clientType; }
    public Instant getConnectedAt() { return connectedAt; }
    public Instant getLastSeen() { return lastSeen; }
    public boolean isSubscribedToExam(int examId) { return subscribedExams.contains(examId); }
    public boolean isAuthenticated() {
        if (authenticated && "user".equals(clientType)
                && tokenExpiresAt != null && !tokenExpiresAt.isAfter(Instant.now())) {
            onDisconnect();
            return false;
        }
        return authenticated && !socketClosed.get();
    }
}
