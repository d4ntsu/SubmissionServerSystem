package com.exam.realtime;

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
        this(socket, registry, server, DEFAULT_HEARTBEAT_TIMEOUT_MILLIS);
    }

    ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server,
                  int heartbeatTimeoutMillis) {
        if (heartbeatTimeoutMillis <= 0) {
            throw new IllegalArgumentException("Heartbeat timeout must be positive");
        }
        this.socket = socket;
        this.registry = registry;
        this.server = server;
        this.heartbeatTimeoutMillis = heartbeatTimeoutMillis;
        this.clientId = socket.getRemoteSocketAddress().toString();
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
                    msg.validateClientInput();
                    handleMessage(msg);
                } catch (Exception e) {
                    System.err.println("[ClientHandler] Rejected malformed message from " + clientId
                            + " (" + e.getClass().getSimpleName() + ")");
                    sendError("Invalid message");
                }
            }
        } catch (MessageFrameReader.MessageTooLargeException e) {
            sendError("Message exceeds the TCP frame limit");
        } catch (MessageFrameReader.IncompleteMessageException e) {
            sendError("Incomplete TCP message");
        } catch (IOException e) {
            System.out.println("[ClientHandler] Disconnected: " + clientId + " (" + e.getClass().getSimpleName() + ")");
        } finally {
            disconnect();
        }
    }

    private void handleMessage(Message msg) {
        Message.Type type = Message.Type.fromString(msg.getType());
        if (type == null) {
            sendError("Unsupported message type");
            return;
        }

        switch (type) {
            case CLIENT_HELLO -> handleHello(msg);
            case CLIENT_HEARTBEAT -> handleHeartbeat();
            case CLIENT_STATUS -> handleStatus(msg);
            default -> {
                if (!authenticated) {
                    sendError("Authentication required before sending " + msg.getType());
                    return;
                }
                // Forward other message types to the server for internal handling
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

        int userId = ((Number) payload.get("user_id")).intValue();
        var userInfo = registry.findUserById(userId);

        if (userInfo.isEmpty()) {
            sendError("User not found: " + userId);
            return;
        }

        var user = userInfo.get();
        this.userId = user.id();
        this.role = user.role();
        this.authenticated = true;

        registry.associateUser(clientId, userId);

        Message reply = Message.create(Message.Type.CLIENT_STATUS, "server", "client:" + clientId);
        reply.setPayload(java.util.Map.of(
                "authenticated", true,
                "user_id", userId,
                "username", user.username(),
                "role", user.role(),
                "online_count", registry.onlineCount()
        ));
        send(reply);

        System.out.println("[ClientHandler] Authenticated: " + user.username() + " (" + user.role() + ")");
    }

    private void handleHeartbeat() {
        if (authenticated) {
            registry.markSeen(userId);
            Message pong = Message.create(Message.Type.CLIENT_HEARTBEAT, "server", "client:" + clientId);
            pong.setPayload(java.util.Map.of("alive", true));
            send(pong);
        }
    }

    private void handleStatus(Message msg) {
        if (!authenticated) return;
        // Client may report its local UI state; not authoritative
        server.routeMessage(msg);
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
        error.setPayload(java.util.Map.of("error", detail));
        send(error);
    }

    public void disconnect() {
        try {
            registry.removeClient(clientId);
            socket.close();
        } catch (IOException ignored) {}
        System.out.println("[ClientHandler] Cleaned up: " + clientId);
    }

    // --- accessors ---

    public String getClientId() { return clientId; }
    public Integer getUserId() { return userId; }
    public String getRole() { return role; }
    public boolean isAuthenticated() { return authenticated; }
}
