package com.exam.realtime;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertNull;

class ClientHandlerLivenessTest {

    @Test
    void idleTcpClientIsClosedAfterHeartbeatTimeout() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        RealtimeServer server = new RealtimeServer();
        try (ServerSocket listener = new ServerSocket(0);
             Socket client = new Socket("127.0.0.1", listener.getLocalPort());
             Socket serverSide = listener.accept();
             BufferedReader reader = new BufferedReader(
                     new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8))) {
            Future<?> handler = executor.submit(
                    new ClientHandler(serverSide, new ClientRegistry(), server, 50));

            assertNull(reader.readLine());
            handler.get(2, TimeUnit.SECONDS);
        } finally {
            server.stop();
            executor.shutdownNow();
        }
    }
}
