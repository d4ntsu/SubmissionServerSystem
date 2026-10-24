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

    @FunctionalInterface
    public interface UserLookup {
        Optional<UserInfo> findById(int userId);
    }

    @FunctionalInterface
    public interface ExamAccess {
        boolean canAccess(int userId, String role, int examId);
    }

    @FunctionalInterface
    public interface SubmissionLookup {
        Optional<SubmissionRecipients> findRecipients(int submissionId);
    }

    private static final Logger LOGGER = Logger.getLogger(ClientRegistry.class.getName());

    /** Maps clientId → ClientHandler for active TCP connections */
    private final Map<String, ClientHandler> onlineClients = new ConcurrentHashMap<>();

    /** Maps userId → all active clientIds so multiple sessions remain online. */
    private final Map<Integer, Set<String>> userToClients = new ConcurrentHashMap<>();

    /** Maps clientId → userId */
    private final Map<String, Integer> clientToUser = new ConcurrentHashMap<>();
    private final UserLookup userLookup;
    private final ExamAccess examAccess;
    private final SubmissionLookup submissionLookup;

    public ClientRegistry() {
        this(null, null);
    }

    ClientRegistry(UserLookup userLookup, ExamAccess examAccess) {
        this(userLookup, examAccess, null);
    }

    ClientRegistry(UserLookup userLookup, ExamAccess examAccess, SubmissionLookup submissionLookup) {
        this.userLookup = userLookup == null ? this::findUserByIdFromDatabase : userLookup;
        this.examAccess = examAccess == null ? this::canAccessExamFromDatabase : examAccess;
        this.submissionLookup = submissionLookup == null
                ? this::findSubmissionRecipientsFromDatabase : submissionLookup;
    }

    // --- User validation via JDBC ---

    /**
     * Looks up a user in the database by ID and returns their info.
     * Used during socket connection authentication.
     */
    public Optional<UserInfo> findUserById(int userId) {
        if (userId <= 0) {
            return Optional.empty();
        }
        return userLookup.findById(userId);
    }

    private Optional<UserInfo> findUserByIdFromDatabase(int userId) {
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

    /** The database role is authoritative; JWT role claims are not used for routing. */
    public boolean canAccessExam(int userId, String role, int examId) {
        return userId > 0 && examId > 0 && examAccess.canAccess(userId, role, examId);
    }

    private boolean canAccessExamFromDatabase(int userId, String role, int examId) {
        String sql = "SELECT 1 FROM exams WHERE id = ? AND "
                + "((? = 'teacher' AND teacher_id = ?) "
                + "OR (? = 'student' AND status IN ('published', 'started')))";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, examId);
            stmt.setString(2, role);
            stmt.setInt(3, userId);
            stmt.setString(4, role);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "Exam access check failed: {0}", e.getClass().getSimpleName());
            return false;
        }
    }

    /** Resolves private submission recipients from canonical ownership relations. */
    public Optional<SubmissionRecipients> findSubmissionRecipients(int submissionId) {
        if (submissionId <= 0) {
            return Optional.empty();
        }
        return submissionLookup.findRecipients(submissionId);
    }

    private Optional<SubmissionRecipients> findSubmissionRecipientsFromDatabase(int submissionId) {
        String sql = "SELECT s.student_id, e.teacher_id FROM submissions s "
                + "JOIN questions q ON q.id = s.question_id "
                + "JOIN exams e ON e.id = q.exam_id WHERE s.id = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, submissionId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(new SubmissionRecipients(
                            rs.getInt("student_id"), rs.getInt("teacher_id")
                    ));
                }
            }
        } catch (SQLException e) {
            LOGGER.log(Level.WARNING, "Submission recipient lookup failed: {0}", e.getClass().getSimpleName());
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

    public synchronized void removeClient(String clientId) {
        onlineClients.remove(clientId);
        Integer userId = clientToUser.remove(clientId);
        if (userId != null) {
            removeClientFromUser(clientId, userId);
        }
    }

    private void removeClientFromUser(String clientId, int userId) {
        Set<String> clients = userToClients.get(userId);
        if (clients == null) {
            return;
        }
        clients.remove(clientId);
        clientToUser.remove(clientId, userId);
        if (clients.isEmpty() && userToClients.remove(userId, clients)) {
            markOffline(userId);
        }
    }

    public void unregisterClient(String clientId) {
        removeClient(clientId);
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

    public List<ClientHandler> getHandlersByRole(String role) {
        if (role == null || role.isBlank()) {
            return List.of();
        }
        return getAllClients().values().stream()
                .filter(ClientHandler::isAuthenticated)
                .filter(handler -> role.equals(handler.getRole()))
                .toList();
    }

    public List<ClientHandler> getHandlersByExam(int examId) {
        return getAllClients().values().stream()
                .filter(ClientHandler::isAuthenticated)
                .filter(handler -> handler.isSubscribedToExam(examId))
                .toList();
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
        if (handler != null && handler.isAuthenticated()) {
            handler.sendMessage(message);
        }
    }

    public void sendToUser(int userId, Message message) {
        for (ClientHandler handler : getHandlersByUserId(userId)) {
            handler.sendMessage(message);
        }
    }

    public void broadcast(Message message) {
        for (ClientHandler handler : getAllClients().values()) {
            if (handler.isAuthenticated()) {
                handler.sendMessage(message);
            }
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
        return userToClients.containsKey(userId);
    }

    // --- Data class ---

    public record UserInfo(int id, String username, String fullName, String role) {}
    public record SubmissionRecipients(int studentId, int teacherId) {}
}
