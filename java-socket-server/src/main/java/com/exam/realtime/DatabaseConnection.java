package com.exam.realtime;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

/**
 * Thread-safe JDBC singleton for the shared SQLite database.
 * Enables WAL journal mode on first connection for safe concurrent access
 * with the Python/SQLAlchemy backend.
 */
public final class DatabaseConnection {

    private static final String URL;

    static {
        try {
            Class.forName("org.sqlite.JDBC");
        } catch (ClassNotFoundException e) {
            throw new RuntimeException("SQLite JDBC driver not found on classpath", e);
        }

        // Enable WAL mode via connection pragma — compatible with Python's SQLAlchemy
        URL = "jdbc:sqlite:" + Config.getDatabasePath();
        String pragmaUrl = URL + "?journal_mode=WAL";
        try (Connection conn = DriverManager.getConnection(pragmaUrl)) {
            // Execute pragma once to set WAL mode; persists across connections
            conn.createStatement().execute("PRAGMA journal_mode=WAL");
        } catch (SQLException e) {
            System.err.println("Warning: WAL mode may not be set — " + e.getMessage());
        }
    }

    private DatabaseConnection() {}

    /**
     * Opens a new JDBC connection to the SQLite database.
     * Caller is responsible for closing the connection.
     */
    public static Connection getConnection() throws SQLException {
        return DriverManager.getConnection(URL);
    }
}