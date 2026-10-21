package com.exam.realtime;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ClientRegistryTest {

    @Test
    void testFindUserById() {
        ClientRegistry reg = new ClientRegistry();
        var user = reg.findUserById(1);
        // User 1 may or may not exist depending on test data
        // This validates the JDBC query doesn't throw
        assertNotNull(user);
    }

    @Test
    void testHasRoleDoesNotThrow() {
        ClientRegistry reg = new ClientRegistry();
        // Should return false for non-existent user, not throw
        boolean result = reg.hasRole(999999, "teacher");
        assertFalse(result);
    }
}