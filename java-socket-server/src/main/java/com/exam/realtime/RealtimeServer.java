package com.exam.realtime;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Main TCP socket server for realtime event distribution.
 * Listens on the configured port, spawns a ClientHandler thread per connection,
 * and provides a method for the FastAPI bridge to inject internal messages.
 */
public class RealtimeServer {

    private final ClientRegistry registry;
    private final ExecutorService threadPool;

    private ServerSocket serverSocket;
    private volatile boolean running = false;

    public RealtimeServer() {
        this.registry = new ClientRegistry();
        this.threadPool = Executors.newCachedThreadPool();
    }

    /**
     * Starts the server and blocks until stop() is called.
     */
    public void start() throws IOException {
        int port = Config.getPort();
        String host = Config.getHost();

        serverSocket = new ServerSocket(port, 50, java.net.InetAddress.getByName(host));
        running = true;

        System.out.println("=== Realtime Server started on " + host + ":" + port + " ===");

        // Accept loop
        while (running) {
            try {
                Socket clientSocket = serverSocket.accept();
                ClientHandler handler = new ClientHandler(clientSocket, registry, this);
                registry.registerClient(handler.getClientId(), handler);
                threadPool.submit(handler);
            } catch (IOException e) {
                if (running) {
                    System.err.println("[RealtimeServer] Accept error: " + e.getMessage());
                }
            }
        }
    }

    /**
     * Gracefully shuts down the server.
     */
    public void stop() {
        running = false;
        try {
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
        } catch (IOException ignored) {}
        threadPool.shutdownNow();
        System.out.println("=== Realtime Server stopped ===");
    }

    /**
     * Routes an incoming message from the FastAPI bridge or a connected client.
     * Messages are delivered based on the recipient field:
     * - "broadcast" → all connected clients
     * - "student:123" → specific user
     * - "role:student" → all users with role "student"
     * - "role:teacher" → all users with role "teacher"
     */
    public void routeMessage(Message msg) {
        String recipient = msg.getRecipient();
        if (recipient == null || recipient.isBlank()) return;

        if ("broadcast".equals(recipient)) {
            broadcast(msg);
        } else if (recipient.startsWith("student:")) {
            int userId = Integer.parseInt(recipient.substring("student:".length()));
            ClientHandler handler = registry.getHandlerByUserId(userId);
            if (handler != null) {
                handler.send(msg);
            }
        } else if (recipient.startsWith("role:")) {
                    String targetRole = recipient.substring("role:".length());
                    for (ClientHandler handler : registry.getOnlineClients().values()) {
                        if (targetRole.equals(handler.getRole())) {
                            handler.send(msg);
                        }
                    }
        } else {
            // Try clientId routing
            ClientHandler handler = registry.getHandlerByClientId(recipient);
            if (handler != null) {
                handler.send(msg);
            }
        }
    }

    /**
     * Sends a message to every connected client.
     */
    public void broadcast(Message msg) {
            for (ClientHandler handler : registry.getOnlineClients().values()) {
            handler.send(msg);
        }
    }

    /**
     * Returns the client registry for querying connection state.
     */
    public ClientRegistry getRegistry() {
        return registry;
    }

    /**
     * Entry point.
     */
    public static void main(String[] args) {
        RealtimeServer server = new RealtimeServer();

        Runtime.getRuntime().addShutdownHook(new Thread(server::stop));

        try {
            server.start();
        } catch (IOException e) {
            System.err.println("[RealtimeServer] Failed to start: " + e.getMessage());
            System.exit(1);
        }
    }
}