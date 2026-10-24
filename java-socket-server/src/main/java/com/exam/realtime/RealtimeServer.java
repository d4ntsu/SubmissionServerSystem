package com.exam.realtime;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.logging.Logger;

/** TCP server for internal realtime event transport. */
public class RealtimeServer {

    private static final Logger LOGGER = Logger.getLogger(RealtimeServer.class.getName());
    private static final int CLIENT_BACKLOG = 50;
    private static final long SHUTDOWN_WAIT_SECONDS = 5;
    private static final AtomicInteger THREAD_NUMBER = new AtomicInteger();

    private final ClientRegistry registry;
    private final ExecutorService clientExecutor;
    private final String host;
    private final int port;
    private final String sharedSecret;
    private final String jwtSecret;
    private final String jwtAlgorithm;
    private final Object lifecycleLock = new Object();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean shutdown = new AtomicBoolean();

    private volatile ServerSocket serverSocket;
    private volatile boolean running;

    public RealtimeServer() {
        this(Config.getHost(), Config.getPort(), Config.getSharedSecret(), Config.getJwtSecret(),
                Config.getJwtAlgorithm(), new ClientRegistry());
    }

    /** Constructor with a configurable port, including port 0 for integration tests. */
    public RealtimeServer(String host, int port) {
        this(host, port, Config.getSharedSecret(), Config.getJwtSecret(),
                Config.getJwtAlgorithm(), new ClientRegistry());
    }

    /** Constructor with explicit service credentials, primarily for isolated tests. */
    public RealtimeServer(String host, int port, String sharedSecret) {
        this(host, port, sharedSecret, Config.getJwtSecret(), Config.getJwtAlgorithm(), new ClientRegistry());
    }

    RealtimeServer(
            String host,
            int port,
            String sharedSecret,
            String jwtSecret,
            String jwtAlgorithm,
            ClientRegistry registry
    ) {
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("Host must not be blank");
        }
        if (port < 0 || port > 65535) {
            throw new IllegalArgumentException("Port must be between 0 and 65535");
        }
        this.host = host;
        this.port = port;
        this.sharedSecret = sharedSecret == null ? "" : sharedSecret;
        this.jwtSecret = jwtSecret == null ? "" : jwtSecret;
        this.jwtAlgorithm = jwtAlgorithm == null ? "" : jwtAlgorithm;
        if (registry == null) {
            throw new IllegalArgumentException("Client registry is required");
        }
        this.registry = registry;
        this.clientExecutor = Executors.newCachedThreadPool(task -> {
            Thread thread = new Thread(task, "realtime-client-" + THREAD_NUMBER.incrementAndGet());
            thread.setDaemon(false);
            return thread;
        });
    }

    /** Binds the configured listener and blocks until stopped or the listener fails. */
    public void start() throws IOException {
        if (!started.compareAndSet(false, true)) {
            throw new IllegalStateException("RealtimeServer can only be started once");
        }

        try {
            synchronized (lifecycleLock) {
                if (shutdown.get()) {
                    return;
                }

                ServerSocket listener = new ServerSocket();
                serverSocket = listener;
                listener.setReuseAddress(true);
                listener.bind(new InetSocketAddress(host, port), CLIENT_BACKLOG);
                running = true;
            }

            LOGGER.log(Level.INFO, "Realtime TCP server started on {0}:{1}",
                    new Object[]{host, getLocalPort()});
            acceptConnections();
        } finally {
            shutdown();
        }
    }

    /** Stops accepting connections, closes clients, and terminates handler workers. */
    public void stop() {
        shutdown();
    }

    private void acceptConnections() {
        while (running) {
            Socket socket = null;
            try {
                socket = serverSocket.accept();
                socket.setKeepAlive(true);
                socket.setTcpNoDelay(true);
                handleNewClient(socket);
            } catch (SocketException e) {
                if (socket != null) {
                    closeQuietly(socket);
                }
                if (running) {
                    LOGGER.log(Level.WARNING, "TCP accept failed: {0}", e.getClass().getSimpleName());
                }
                break;
            } catch (IOException e) {
                if (socket != null) {
                    closeQuietly(socket);
                }
                if (running) {
                    LOGGER.log(Level.WARNING, "TCP accept failed: {0}", e.getClass().getSimpleName());
                }
                break;
            }
        }
    }

    private void handleNewClient(Socket socket) {
        synchronized (lifecycleLock) {
            if (!running || shutdown.get()) {
                closeQuietly(socket);
                return;
            }

            ClientHandler handler = new ClientHandler(
                    socket, registry, this, 90_000, sharedSecret, jwtSecret, jwtAlgorithm
            );
            registry.registerClient(handler.getClientId(), handler);
            try {
                clientExecutor.submit(handler);
                LOGGER.log(Level.INFO, "TCP client connected: {0}", handler.getClientId());
            } catch (RejectedExecutionException e) {
                registry.unregisterClient(handler.getClientId());
                handler.close();
                LOGGER.log(Level.WARNING, "Rejected TCP client during shutdown: {0}", handler.getClientId());
            }
        }
    }

    private void shutdown() {
        if (!shutdown.compareAndSet(false, true)) {
            return;
        }
        running = false;
        try {
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
        } catch (IOException e) {
            LOGGER.log(Level.FINE, "Error closing TCP listener: {0}", e.getClass().getSimpleName());
        }
        registry.closeAllClients();
        clientExecutor.shutdownNow();
        try {
            if (!clientExecutor.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS)) {
                LOGGER.warning("TCP client workers did not stop before the shutdown timeout");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        LOGGER.info("Realtime TCP server stopped");
    }

    /**
     * Routes an incoming message from the FastAPI bridge or a connected client.
     * Messages are delivered based on the recipient field:
     * - "broadcast" → all authenticated sessions
     * - "user:123" / "student:123" → every session for a user
     * - "role:student" → all users with role "student"
     * - "exam:123" → authenticated sessions authorized and subscribed to an exam
     * - "session:<connection-id>" → one authenticated connection
     */
    public void routeMessage(Message msg) {
        if (msg == null) {
            return;
        }

        String recipient = msg.getRecipient();
        if (recipient == null || recipient.isBlank()) {
            return;
        }

        Message.Type type = Message.Type.fromString(msg.getType());
        if (type != null && isSubmissionEvent(type)) {
            routeSubmissionMessage(msg, recipient);
            return;
        }

        if (type != null && isExamEvent(type) && "fastapi".equals(msg.getSender())
                && recipient.startsWith("exam:")) {
            int examId;
            try {
                examId = Integer.parseInt(recipient.substring("exam:".length()));
            } catch (NumberFormatException e) {
                LOGGER.warning("Rejected exam event with a malformed exam recipient");
                return;
            }
            if (examId <= 0) {
                LOGGER.warning("Rejected exam event with a malformed exam recipient");
                return;
            }
            for (ClientHandler handler : registry.getHandlersByExam(examId)) {
                handler.sendMessage(msg);
            }
            relayExamEventToServices(msg);
            return;
        }

        if ("broadcast".equals(recipient)) {
            registry.broadcast(msg);
        } else if (recipient.startsWith("student:") || recipient.startsWith("user:")) {
            int delimiter = recipient.indexOf(':');
            int userId = Integer.parseInt(recipient.substring(delimiter + 1));
            for (ClientHandler handler : registry.getHandlersByUserId(userId)) {
                if (handler.isAuthenticated()) {
                    handler.send(msg);
                }
            }
        } else if (recipient.startsWith("role:")) {
            String targetRole = recipient.substring("role:".length());
            for (ClientHandler handler : registry.getHandlersByRole(targetRole)) {
                handler.sendMessage(msg);
            }
        } else if (recipient.startsWith("exam:")) {
            int examId = Integer.parseInt(recipient.substring("exam:".length()));
            for (ClientHandler handler : registry.getHandlersByExam(examId)) {
                handler.sendMessage(msg);
            }
        } else if (recipient.startsWith("session:")) {
            registry.sendTo(recipient.substring("session:".length()), msg);
        } else {
            registry.sendTo(recipient, msg);
        }
    }

    private static boolean isSubmissionEvent(Message.Type type) {
        return switch (type) {
            case SUBMISSION_RECEIVED, SUBMISSION_RUNNING, SUBMISSION_STATUS,
                    SUBMISSION_COMPLETED, SUBMISSION_FAILED, SUBMISSION_ERROR -> true;
            default -> false;
        };
    }

    private static boolean isExamEvent(Message.Type type) {
        return switch (type) {
            case EXAM_STARTED, EXAM_ENDED, EXAM_ANNOUNCEMENT, ANNOUNCEMENT_CREATED -> true;
            default -> false;
        };
    }

    private void relayExamEventToServices(Message message) {
        for (ClientHandler service : registry.getHandlersByRole("service")) {
            service.sendMessage(message);
        }
    }

    private void routeSubmissionMessage(Message message, String recipient) {
        Object rawSubmissionId = message.getPayload().get("submission_id");
        if (!(rawSubmissionId instanceof Number number) || number.longValue() <= 0
                || number.longValue() > Integer.MAX_VALUE) {
            LOGGER.warning("Rejected submission realtime event without a valid submission id");
            return;
        }
        var owners = registry.findSubmissionRecipients(number.intValue());
        if (owners.isEmpty()) {
            LOGGER.warning("Rejected submission realtime event with no known owner");
            return;
        }
        int targetUserId;
        if ("role:student".equals(recipient)) {
            targetUserId = owners.get().studentId();
        } else if ("role:teacher".equals(recipient)) {
            targetUserId = owners.get().teacherId();
        } else if (recipient.startsWith("student:")) {
            targetUserId = parseRecipientUserId(recipient);
            if (targetUserId != owners.get().studentId()) {
                LOGGER.warning("Rejected submission event addressed to a non-owner student");
                return;
            }
        } else if (recipient.startsWith("user:")) {
            targetUserId = parseRecipientUserId(recipient);
            if (targetUserId != owners.get().studentId() && targetUserId != owners.get().teacherId()) {
                LOGGER.warning("Rejected submission event addressed to an unauthorized user");
                return;
            }
        } else if (recipient.startsWith("session:")) {
            ClientHandler handler = registry.getHandlerByClientId(recipient.substring("session:".length()));
            Integer sessionUserId = handler == null ? null : handler.getUserId();
            if (handler == null || !handler.isAuthenticated() || sessionUserId == null
                    || (sessionUserId != owners.get().studentId()
                    && sessionUserId != owners.get().teacherId())) {
                LOGGER.warning("Rejected submission event addressed to an unauthorized session");
                return;
            }
            handler.send(message);
            relaySubmissionEventToServices(message);
            return;
        } else {
            LOGGER.warning("Rejected broad recipient for private submission realtime event");
            return;
        }
        registry.sendToUser(targetUserId, message);
        relaySubmissionEventToServices(message);
    }

    private void relaySubmissionEventToServices(Message message) {
        for (ClientHandler service : registry.getHandlersByRole("service")) {
            service.sendMessage(message);
        }
    }

    private static int parseRecipientUserId(String recipient) {
        return Integer.parseInt(recipient.substring(recipient.indexOf(':') + 1));
    }

    public void broadcast(Message msg) {
        registry.broadcast(msg);
    }

    Future<?> submitClientTask(Runnable task) {
        return clientExecutor.submit(task);
    }

    public ClientRegistry getRegistry() {
        return registry;
    }

    public boolean isRunning() {
        return running;
    }

    /** Returns the bound port, or -1 before the listener has bound. */
    public int getLocalPort() {
        ServerSocket listener = serverSocket;
        return listener == null || !listener.isBound() ? -1 : listener.getLocalPort();
    }

    private static void closeQuietly(ServerSocket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // Closing during shutdown is best-effort.
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // Closing during shutdown is best-effort.
        }
    }

    public static void main(String[] args) {
        RealtimeServer server = new RealtimeServer();
        Runtime.getRuntime().addShutdownHook(new Thread(server::stop, "realtime-shutdown"));

        try {
            server.start();
        } catch (IOException e) {
            LOGGER.log(Level.SEVERE, "Failed to start realtime TCP server: {0}", e.getClass().getSimpleName());
        }
    }
}
