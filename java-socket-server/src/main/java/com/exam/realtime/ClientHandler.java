package com.exam.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Handles a single TCP client connection.
 * Reads newline-delimited JSON messages, processes authentication,
 * and dispatches events through the ClientRegistry.
 */
public class ClientHandler implements Runnable {

    private static final int DEFAULT_HEARTBEAT_TIMEOUT_MILLIS = 90_000;

    private final Socket socket;
    private final ClientRegistry registry;
    private final RealtimeServer server; // For sending internal messages from FastAPI bridge
    private final int heartbeatTimeoutMillis;

    private String clientId;
    private Integer userId;
    private String role;
    private boolean authenticated = false;

    private MessageFrameReader in;
    private PrintWriter out;

    public ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server) {
        this.socket = socket;
        this.registry = registry;
        this.server = server;
        this.heartbeatTimeoutMillis = heartbeatTimeoutMillis;
        this.clientId = socket.getRemoteSocketAddress().toString();
        this.sharedSecret = sharedSecret == null ? "" : sharedSecret;
    }

    @Override
    public void run() {
        try {
            socket.setSoTimeout(heartbeatTimeoutMillis);
            InputStream socketInput = socket.getInputStream();
            in = new MessageFrameReader(socketInput);
            out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);

            System.out.println("[ClientHandler] New connection: " + clientId);

            String line;
            while (true) {
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
                    Message msg = Message.fromJson(line);
                    handleMessage(msg);
                } catch (Exception e) {
                    System.err.println("[ClientHandler] Rejected malformed message from " + clientId
                            + " (" + e.getClass().getSimpleName() + ")");
                    sendError("Invalid message");
                }
            }
        } catch (IOException e) {
            System.out.println("[ClientHandler] Disconnected: " + clientId + " (" + e.getClass().getSimpleName() + ")");
        } finally {
            onDisconnect();
        }
    }

    private void handleMessage(Message msg) throws Exception {
        Message.Type type = Message.Type.fromString(msg.getType());
        if (type == null) {
            sendError("Unknown message type: " + msg.getType());
            return;
        }

        switch (type) {
            case SERVICE_HELLO -> handleServiceHello(msg);
            case CLIENT_HELLO -> handleHello(msg);
            case CLIENT_HEARTBEAT -> handleHeartbeat();
            case CLIENT_STATUS -> handleStatus(msg);
            default -> {
                if (!authenticated) {
                    sendError("Authentication required");
                    return;
                }
                server.routeMessage(msg);
            }
        }
    }

    private void handleHello(Message msg) {
        // Legacy handshake looks up user_id in SQLite; it does not verify caller ownership.
        var payload = msg.getPayload();
        if (payload == null || !payload.containsKey("user_id")) {
            sendError("CLIENT_HELLO requires 'user_id' in payload");
            return;
        }

        Map<String, Object> payload = msg.getPayload();
        Object requestedUserId = payload == null ? null : payload.get("user_id");
        if (!(requestedUserId instanceof Number number)) {
            sendError("CLIENT_HELLO requires a numeric user_id");
            return;
        }

        int requestedId = number.intValue();
        var userInfo = registry.findUserById(requestedId);
        if (userInfo.isEmpty()) {
            sendError("User not found");
            return;
        }

        var user = userInfo.get();
        userId = user.id();
        role = user.role();
        authenticated = true;
        registry.associateUser(clientId, user.id());

        Message reply = Message.create(Message.Type.CLIENT_STATUS, "server", "client:" + clientId);
        reply.setPayload(Map.of(
                "authenticated", true,
                "user_id", user.id(),
                "role", user.role(),
                "online_count", registry.onlineCount()
        ));
        sendMessage(reply);
    }

    private void handleHeartbeat() {
        if (authenticated) {
            registry.markSeen(userId);
            Message pong = Message.create(Message.Type.CLIENT_HEARTBEAT, "server", "client:" + clientId);
            pong.setPayload(Map.of("alive", true));
            sendMessage(pong);
        }
    }

    private void handleStatus(Message msg) {
        if (authenticated) {
            server.routeMessage(msg);
        }
    }

    /** Sends a message to this client. */
    public synchronized void send(Message msg) {
        try {
            out.println(msg.toJson());
        } catch (Exception e) {
            System.err.println("[ClientHandler] Failed to send: " + e.getMessage());
        }
    }

    /** Sends an error to this client. */
    public void sendError(String detail) {
        Message error = Message.create(Message.Type.SERVER_ERROR, "server", "client:" + clientId);
        error.setPayload(Map.of("error", detail));
        sendMessage(error);
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
    public Integer getUserId() { return userId; }
    public String getRole() { return role; }
    public boolean isAuthenticated() { return authenticated; }
}