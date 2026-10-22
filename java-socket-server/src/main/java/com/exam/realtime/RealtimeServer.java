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
    private final Object lifecycleLock = new Object();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean shutdown = new AtomicBoolean();

    private volatile ServerSocket serverSocket;
    private volatile boolean running;

    public RealtimeServer() {
        this(Config.getHost(), Config.getPort(), Config.getSharedSecret());
    }

    /** Constructor with a configurable port, including port 0 for integration tests. */
    public RealtimeServer(String host, int port) {
        this(host, port, Config.getSharedSecret());
    }

    /** Constructor with explicit service credentials, primarily for isolated tests. */
    public RealtimeServer(String host, int port, String sharedSecret) {
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("Host must not be blank");
        }
        if (port < 0 || port > 65535) {
            throw new IllegalArgumentException("Port must be between 0 and 65535");
        }
        this.host = host;
        this.port = port;
        this.sharedSecret = sharedSecret == null ? "" : sharedSecret;
        this.registry = new ClientRegistry();
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

            ClientHandler handler = new ClientHandler(socket, registry, this, sharedSecret);
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

        synchronized (lifecycleLock) {
            running = false;
            ServerSocket listener = serverSocket;
            if (listener != null) {
                closeQuietly(listener);
            }

            registry.closeAllClients();
            clientExecutor.shutdown();
        }

        try {
            if (!clientExecutor.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS)) {
                clientExecutor.shutdownNow();
                if (!clientExecutor.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS)) {
                    LOGGER.warning("Some TCP client workers did not stop before the shutdown deadline");
                }
            }
        } catch (InterruptedException e) {
            clientExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }

        LOGGER.info("Realtime TCP server stopped");
    }

    /** Routes a message by its recipient field. Business authorization remains upstream. */
    public void routeMessage(Message msg) {
        if (msg == null) {
            return;
        }

        String recipient = msg.getRecipient();
        if (recipient == null || recipient.isBlank()) {
            return;
        }

        if ("broadcast".equals(recipient)) {
            registry.broadcast(msg);
        } else if (recipient.startsWith("student:")) {
            try {
                int userId = Integer.parseInt(recipient.substring("student:".length()));
                registry.sendToUser(userId, msg);
            } catch (NumberFormatException e) {
                LOGGER.log(Level.WARNING, "Ignoring invalid user recipient: {0}", recipient);
            }
        } else if (recipient.startsWith("role:")) {
            String targetRole = recipient.substring("role:".length());
            for (ClientHandler handler : registry.getAllClients().values()) {
                if (targetRole.equals(handler.getRole())) {
                    handler.sendMessage(msg);
                }
            }
        } else {
            registry.sendTo(recipient, msg);
        }
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
