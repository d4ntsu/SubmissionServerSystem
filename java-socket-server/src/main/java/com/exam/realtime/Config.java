package com.exam.realtime;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/**
 * Loads server configuration from classpath and environment overrides.
 * Environment variables take precedence over the properties file.
 */
public final class Config {

    private static final Properties props = new Properties();

    static {
        try (InputStream in = Config.class.getClassLoader().getResourceAsStream("server.properties")) {
            if (in != null) {
                props.load(in);
            }
        } catch (IOException e) {
            System.err.println("Warning: Could not load server.properties — using defaults");
        }

        // Environment overrides
        override("server.host", "SOCKET_HOST");
        override("server.port", "SOCKET_PORT");
        override("database.path", "DATABASE_PATH");
        override("auth.shared_secret", "SHARED_SECRET");
    }

    private static void override(String key, String envVar) {
        String env = System.getenv(envVar);
        if (env != null && !env.isBlank()) {
            props.setProperty(key, env);
        }
    }

    private Config() {}

    public static String getHost() {
        return props.getProperty("server.host", "127.0.0.1");
    }

    public static int getPort() {
        return Integer.parseInt(props.getProperty("server.port", "9000"));
    }

    public static String getDatabasePath() {
        return props.getProperty("database.path", "../backend/app/data/exam_system.db");
    }

    public static String getSharedSecret() {
        return props.getProperty("auth.shared_secret", "dev-secret-change-in-production");
    }
}