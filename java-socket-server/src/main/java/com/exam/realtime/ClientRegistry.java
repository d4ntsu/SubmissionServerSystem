package com.exam.realtime;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Tracks connected clients and validates users against the SQLite database via JDBC.
 * Maintains an approximate online-status using JDBC writes to the users table.
 */
public final class ClientRegistry {

    private static final Logger LOGGER = Logger.getLogger(ClientRegistry.class.getName());

    /** Maps clientId → ClientHandler for active TCP connections */
    private final Map<String, ClientHandler> onlineClients = new ConcurrentHashMap<>();

    /** Maps userId → all active clientIds so multiple sessions remain online. */
    private final Map<Integer, Set<String>> userToClients = new ConcurrentHashMap<>();

    /** Maps clientId → userId */
    private final Map<String, Integer> clientToUser = new ConcurrentHashMap<>();

    // --- User validation via JDBC ---

    /**
     * Looks up a user in the database by ID and returns their info.
     * Used during socket connection authentication.
     */
    public Optional<UserInfo> findUserById(int userId) {
        String sql = "SELECT id, username, full_name, role FROM users WHERE id = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, userId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(new UserInfo(
                            rs.getInt("id"),
                            rs.getString("username"),
                            rs.getString("full_name"),
                            rs.getString("role")
                    ));
                }
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "User lookup failed: {0}", e.getClass().getSimpleName());
        }
        return Optional.empty();
    }

    /**
     * Looks up a user by username (for alternative auth flows).
     */
    public Optional<UserInfo> findUserByUsername(String username) {
        String sql = "SELECT id, username, full_name, role FROM users WHERE username = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, username);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(new UserInfo(
                            rs.getInt("id"),
                            rs.getString("username"),
                            rs.getString("full_name"),
                            rs.getString("role")
                    ));
                }
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "User lookup failed: {0}", e.getClass().getSimpleName());
        }
        return Optional.empty();
    }

    /**
     * Checks whether a user exists and has the given role.
     */
    public boolean hasRole(int userId, String role) {
        String sql = "SELECT 1 FROM users WHERE id = ? AND role = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, userId);
            stmt.setString(2, role);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "Role lookup failed: {0}", e.getClass().getSimpleName());
        }
        return false;
    }

    /**
     * Reads all student IDs from the database — used for broadcasts.
     */
    public java.util.List<Integer> getAllStudentIds() {
        java.util.List<Integer> ids = new java.util.ArrayList<>();
        String sql = "SELECT id FROM users WHERE role = 'student'";
        try (Connection conn = DatabaseConnection.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                ids.add(rs.getInt("id"));
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "Student list lookup failed: {0}", e.getClass().getSimpleName());
        }
        return ids;
    }

    // --- Online status via JDBC ---

    /**
     * Marks a user as online in the database (best-effort).
     * If the users table lacks an online_status column, this silently fails.
     */
    public void markOnline(int userId) {
        try (Connection conn = DatabaseConnection.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("UPDATE users SET is_online = 1 WHERE id = " + userId);
        } catch (SQLException e) {
            // Column may not exist yet — non-critical
        }
    }

    /**
     * Marks a user as offline in the database.
     */
    public void markOffline(int userId) {
        try (Connection conn = DatabaseConnection.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("UPDATE users SET is_online = 0 WHERE id = " + userId);
        } catch (SQLException e) {
            // Column may not exist yet — non-critical
        }
    }

    /** Updates last-seen when the shared database has the presence column. */
    public void markSeen(int userId) {
        String sql = "UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, userId);
            stmt.executeUpdate();
        } catch (SQLException e) {
            // A standalone older database may not yet have the optional presence column.
        }
    }

    // --- In-memory connection tracking ---

    public void registerClient(String clientId, ClientHandler handler) {
        onlineClients.put(clientId, handler);
    }

    public synchronized void associateUser(String clientId, int userId) {
        Integer previousUserId = clientToUser.get(clientId);
        if (previousUserId != null && previousUserId != userId) {
            removeClientFromUser(clientId, previousUserId);
        }

        Set<String> clients = userToClients.computeIfAbsent(
                userId, ignored -> ConcurrentHashMap.newKeySet()
        );
        boolean firstConnection = clients.isEmpty();
        clients.add(clientId);
        clientToUser.put(clientId, userId);
        if (firstConnection) {
            markOnline(userId);
        }
    }

    public void removeClient(String clientId) {
        onlineClients.remove(clientId);
        Integer userId = clientToUser.remove(clientId);
        if (userId != null) {
            userToClient.remove(userId);
            markOffline(userId);
        }
    }

    public ClientHandler getHandlerByUserId(int userId) {
        return getHandlersByUserId(userId).stream().findFirst().orElse(null);
    }

    public List<ClientHandler> getHandlersByUserId(int userId) {
        Set<String> clientIds = userToClients.get(userId);
        if (clientIds == null) {
            return List.of();
        }
        List<ClientHandler> handlers = new ArrayList<>();
        for (String clientId : clientIds) {
            ClientHandler handler = onlineClients.get(clientId);
            if (handler != null) {
                handlers.add(handler);
            }
        }
        return handlers;
    }

    public ClientHandler getHandlerByClientId(String clientId) {
        return onlineClients.get(clientId);
    }

    public ClientHandler getClient(String clientId) {
        return onlineClients.get(clientId);
    }

    /** Returns a stable snapshot so callers cannot mutate the live registry. */
    public Map<String, ClientHandler> getAllClients() {
        return Map.copyOf(onlineClients);
    }

    /** Backwards-compatible accessor, now returning a snapshot. */
    public Map<String, ClientHandler> getOnlineClients() {
        return getAllClients();
    }

    public void sendTo(String clientId, Message message) {
        ClientHandler handler = onlineClients.get(clientId);
        if (handler != null) {
            handler.sendMessage(message);
        }
    }

    public void sendToUser(int userId, Message message) {
        ClientHandler handler = getHandlerByUserId(userId);
        if (handler != null) {
            handler.sendMessage(message);
        }
    }

    public void broadcast(Message message) {
        for (ClientHandler handler : getAllClients().values()) {
            handler.sendMessage(message);
        }
    }

    /** Closes and unregisters every current connection. */
    public void closeAllClients() {
        for (ClientHandler handler : getAllClients().values()) {
            handler.onDisconnect();
        }
    }

    public int onlineCount() {
        return onlineClients.size();
    }

    public boolean isUserOnline(int userId) {
        return userToClient.containsKey(userId);
    }

        /** Returns all currently-connected client handlers (for broadcasting / iteration). */
        public Map<String, ClientHandler> getOnlineClients() {
            return onlineClients;
        }

    // --- Data class ---

    public record UserInfo(int id, String username, String fullName, String role) {}
}
