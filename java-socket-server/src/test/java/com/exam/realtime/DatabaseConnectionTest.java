package com.exam.realtime;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.*;

class DatabaseConnectionTest {

    @Test
    void testConnectionOpens() throws SQLException {
        try (Connection conn = DatabaseConnection.getConnection()) {
            assertNotNull(conn);
            assertFalse(conn.isClosed());
        }
    }

    @Test
    void testTableExists() throws SQLException {
        try (Connection conn = DatabaseConnection.getConnection();
             var rs = conn.getMetaData().getTables(null, null, "users", null)) {
            assertTrue(rs.next(), "users table should exist in the database");
        }
    }

    @Test
    void testWALMode() throws SQLException {
        try (Connection conn = DatabaseConnection.getConnection();
             var rs = conn.createStatement().executeQuery("PRAGMA journal_mode")) {
            assertTrue(rs.next());
            assertEquals("wal", rs.getString(1).toLowerCase());
        }
    }
}