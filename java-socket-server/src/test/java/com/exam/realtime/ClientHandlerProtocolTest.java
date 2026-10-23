package com.exam.realtime;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ClientHandlerProtocolTest {

    @Test
    void malformedMessageDoesNotTerminateTheClientHandler() throws Exception {
        ExecutorService handlerExecutor = Executors.newSingleThreadExecutor();
        try (ServerSocket listener = new ServerSocket(0);
             Socket client = new Socket("127.0.0.1", listener.getLocalPort());
             Socket serverSide = listener.accept();
             BufferedReader reader = new BufferedReader(
                     new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter writer = new BufferedWriter(
                     new OutputStreamWriter(client.getOutputStream(), StandardCharsets.UTF_8))) {
            Future<?> handler = handlerExecutor.submit(
                    new ClientHandler(serverSide, new ClientRegistry(), new RealtimeServer()));

            writer.write("{invalid-json}\n");
            writer.write("{\"type\":\"client.heartbeat\",\"requestId\":"
                    + "\"550e8400-e29b-41d4-a716-446655440000\","
                    + "\"sender\":\"client:127.0.0.1\",\"recipient\":\"server\","
                    + "\"timestamp\":\"2026-10-22T10:00:00Z\",\"payload\":{}}\n");
            writer.write("{\"type\":\"unrecognized.event\"}\n");
            writer.flush();

            Message firstError = Message.fromJson(reader.readLine());
            Message secondError = Message.fromJson(reader.readLine());
            assertEquals(Message.Type.SERVER_ERROR.value(), firstError.getType());
            assertEquals(Message.Type.SERVER_ERROR.value(), secondError.getType());

            client.close();
            handler.get(2, TimeUnit.SECONDS);
        } finally {
            handlerExecutor.shutdownNow();
        }
    }
}
