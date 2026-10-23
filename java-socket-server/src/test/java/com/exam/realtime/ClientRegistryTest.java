package com.exam.realtime;

import org.junit.jupiter.api.Test;

import java.net.ServerSocket;
import java.net.Socket;

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

    @Test
    void duplicateSessionsStayOnlineUntilTheFinalSessionDisconnects() throws Exception {
        ClientRegistry registry = new ClientRegistry();
        RealtimeServer server = new RealtimeServer();
        int userId = Integer.MAX_VALUE - 10;

        try (ServerSocket listener = new ServerSocket(0);
             Socket firstClient = new Socket("127.0.0.1", listener.getLocalPort());
             Socket firstServerSide = listener.accept();
             Socket secondClient = new Socket("127.0.0.1", listener.getLocalPort());
             Socket secondServerSide = listener.accept()) {
            ClientHandler first = new ClientHandler(firstServerSide, registry, server);
            ClientHandler second = new ClientHandler(secondServerSide, registry, server);
            registry.registerClient(first.getClientId(), first);
            registry.registerClient(second.getClientId(), second);

            registry.associateUser(first.getClientId(), userId);
            registry.associateUser(second.getClientId(), userId);
            assertTrue(registry.isUserOnline(userId));
            assertEquals(2, registry.getHandlersByUserId(userId).size());

            registry.removeClient(first.getClientId());
            assertTrue(registry.isUserOnline(userId));
            assertEquals(1, registry.getHandlersByUserId(userId).size());
            assertSame(second, registry.getHandlerByUserId(userId));

            registry.removeClient(second.getClientId());
            assertFalse(registry.isUserOnline(userId));
            assertTrue(registry.getHandlersByUserId(userId).isEmpty());
        } finally {
            server.stop();
        }
    }

    @Test
    void serverStopClosesRegisteredClientSessions() throws Exception {
        RealtimeServer server = new RealtimeServer();
        ClientRegistry registry = server.getRegistry();
        int userId = Integer.MAX_VALUE - 11;

        try (ServerSocket listener = new ServerSocket(0);
             Socket client = new Socket("127.0.0.1", listener.getLocalPort());
             Socket serverSide = listener.accept()) {
            ClientHandler handler = new ClientHandler(serverSide, registry, server);
            registry.registerClient(handler.getClientId(), handler);
            registry.associateUser(handler.getClientId(), userId);
            assertTrue(registry.isUserOnline(userId));

            server.stop();

            assertFalse(registry.isUserOnline(userId));
            assertEquals(-1, client.getInputStream().read());
        } finally {
            server.stop();
        }
    }
}
