package com.exam.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Reads one TCP client and queues outbound writes so slow receivers do not stall broadcasts. */
public class ClientHandler implements Runnable {

    private static final Logger LOGGER = Logger.getLogger(ClientHandler.class.getName());
    private static final int MAX_MESSAGE_CHARS = 64 * 1024;
    private static final int MAX_PENDING_MESSAGES = 128;

    private final Socket socket;
    private final ClientRegistry registry;
    private final RealtimeServer server;
    private final String clientId;
    private final String sharedSecret;
    private final ArrayBlockingQueue<String> outboundMessages = new ArrayBlockingQueue<>(MAX_PENDING_MESSAGES);
    private final AtomicBoolean socketClosed = new AtomicBoolean();
    private final AtomicBoolean disconnected = new AtomicBoolean();

    private volatile Integer userId;
    private volatile String role;
    private volatile boolean authenticated;
    private volatile BufferedReader in;
    private volatile PrintWriter out;
    private volatile Future<?> writerTask;

    public ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server) {
        this(socket, registry, server, Config.getSharedSecret());
    }

    ClientHandler(Socket socket, ClientRegistry registry, RealtimeServer server, String sharedSecret) {
        this.socket = socket;
        this.registry = registry;
        this.server = server;
        this.clientId = socket.getRemoteSocketAddress().toString();
        this.sharedSecret = sharedSecret == null ? "" : sharedSecret;
    }

    @Override
    public void run() {
        try {
            in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
            writerTask = server.submitClientTask(this::writeMessages);

            String line;
            while (!socketClosed.get() && (line = readMessage()) != null) {
                if (line.isBlank()) {
                    continue;
                }

                try {
                    Message msg = parseMessage(line);
                    handleMessage(msg);
                } catch (JsonProcessingException e) {
                    LOGGER.log(Level.WARNING, "Malformed JSON message from client {0}", clientId);
                    sendError("Invalid message format");
                } catch (RuntimeException e) {
                    LOGGER.log(Level.WARNING, "Could not process message from client {0}: {1}",
                            new Object[]{clientId, e.getClass().getSimpleName()});
                    sendError("Unable to process message");
                }
            }
        } catch (MessageTooLargeException e) {
            LOGGER.log(Level.WARNING, "Oversized message from client {0}; closing connection", clientId);
        } catch (IOException e) {
            if (!socketClosed.get()) {
                LOGGER.log(Level.INFO, "TCP client {0} disconnected: {1}",
                        new Object[]{clientId, e.getClass().getSimpleName()});
            }
        } catch (RejectedExecutionException e) {
            if (!socketClosed.get()) {
                LOGGER.log(Level.WARNING, "Could not start writer for client {0}", clientId);
            }
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Unexpected TCP handler failure for client {0}: {1}",
                    new Object[]{clientId, e.getClass().getSimpleName()});
        } finally {
            onDisconnect();
        }
    }

    /** Reads one UTF-8 line without allowing an unbounded frame allocation. */
    private String readMessage() throws IOException {
        StringBuilder frame = new StringBuilder();
        int next;
        while ((next = in.read()) != -1) {
            if (next == '\n') {
                int length = frame.length();
                if (length > 0 && frame.charAt(length - 1) == '\r') {
                    frame.setLength(length - 1);
                }
                return frame.toString();
            }
            if (frame.length() >= MAX_MESSAGE_CHARS) {
                throw new MessageTooLargeException();
            }
            frame.append((char) next);
        }
        return frame.length() == 0 ? null : frame.toString();
    }

    private Message parseMessage(String json) throws JsonProcessingException {
        return Message.fromJson(json);
    }

    private void handleMessage(Message msg) {
        if (msg == null || msg.getType() == null) {
            sendError("Invalid message format");
            return;
        }

        Message.Type type = Message.Type.fromString(msg.getType());
        if (type == null) {
            sendError("Unknown message type");
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

    private void handleServiceHello(Message msg) {
        if (authenticated) {
            sendError("Connection is already authenticated");
            return;
        }

        Map<String, Object> payload = msg.getPayload();
        Object suppliedSecret = payload == null ? null : payload.get("shared_secret");
        if (sharedSecret.isBlank()
                || !(suppliedSecret instanceof String candidate)
                || !MessageDigest.isEqual(
                        sharedSecret.getBytes(StandardCharsets.UTF_8),
                        candidate.getBytes(StandardCharsets.UTF_8))) {
            LOGGER.log(Level.WARNING, "Internal service authentication rejected for client {0}", clientId);
            sendError("Service authentication failed");
            return;
        }

        role = "service";
        authenticated = true;
        Message reply = Message.create(Message.Type.CLIENT_STATUS, "server", "client:" + clientId);
        reply.setPayload(Map.of(
                "authenticated", true,
                "service", true,
                "online_count", registry.onlineCount()
        ));
        sendMessage(reply);
        LOGGER.log(Level.INFO, "Authenticated internal service client {0}", clientId);
    }

    private void handleHello(Message msg) {
        if (authenticated) {
            sendError("Connection is already authenticated");
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
        // Preserve the existing protocol response; timeout policy belongs to a later realtime task.
        if (authenticated) {
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

    /** Enqueues a message for this client; returns immediately even if its socket is slow. */
    public boolean sendMessage(Message msg) {
        if (msg == null || socketClosed.get()) {
            return false;
        }

        final String json;
        try {
            json = msg.toJson();
        } catch (JsonProcessingException e) {
            LOGGER.log(Level.WARNING, "Could not serialize outbound message for client {0}", clientId);
            return false;
        }

        if (outboundMessages.offer(json)) {
            return true;
        }

        LOGGER.log(Level.WARNING, "Outbound queue full for client {0}; closing slow connection", clientId);
        close();
        return false;
    }

    /** Compatibility wrapper for existing routing code. */
    public void send(Message msg) {
        sendMessage(msg);
    }

    private void writeMessages() {
        try {
            while (!socketClosed.get()) {
                String json = outboundMessages.take();
                if (socketClosed.get()) {
                    return;
                }
                out.println(json);
                out.flush();
                if (out.checkError()) {
                    throw new IOException("Socket write failed");
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            if (!socketClosed.get()) {
                LOGGER.log(Level.INFO, "TCP write failed for client {0}: {1}",
                        new Object[]{clientId, e.getClass().getSimpleName()});
                close();
            }
        }
    }

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

    private static final class MessageTooLargeException extends IOException {
        private MessageTooLargeException() {
            super("TCP frame exceeds configured limit");
        }
    }
}
