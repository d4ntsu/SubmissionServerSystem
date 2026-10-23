package com.exam.realtime;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Reads bounded newline-delimited UTF-8 JSON frames from a TCP stream. */
public final class MessageFrameReader {

    public static final int MAX_MESSAGE_BYTES = 64 * 1024;

    private final InputStream input;
    private final ByteArrayOutputStream frame = new ByteArrayOutputStream();

    public MessageFrameReader(InputStream input) {
        this.input = input instanceof BufferedInputStream ? input : new BufferedInputStream(input);
    }

    /**
     * Reads exactly one frame. Returns null only for clean EOF between frames.
     * An EOF inside a frame is rejected so truncated JSON is never processed.
     */
    public String readFrame() throws IOException {
        int next;
        while ((next = input.read()) != -1) {
            if (next == '\n') {
                byte[] bytes = frame.toByteArray();
                frame.reset();
                int length = bytes.length;
                if (length > 0 && bytes[length - 1] == '\r') {
                    length--;
                }
                return decodeUtf8(bytes, length);
            }
            if (frame.size() >= MAX_MESSAGE_BYTES) {
                throw new MessageTooLargeException();
            }
            frame.write(next);
        }

        if (frame.size() == 0) {
            return null;
        }
        frame.reset();
        throw new IncompleteMessageException();
    }

    private static String decodeUtf8(byte[] bytes, int length) throws InvalidUtf8Exception {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes, 0, length))
                    .toString();
        } catch (CharacterCodingException e) {
            throw new InvalidUtf8Exception();
        }
    }

    public static final class MessageTooLargeException extends IOException {
        public MessageTooLargeException() {
            super("TCP message exceeds the 64 KiB limit");
        }
    }

    public static final class IncompleteMessageException extends IOException {
        public IncompleteMessageException() {
            super("TCP stream ended before the message delimiter");
        }
    }

    public static final class InvalidUtf8Exception extends IOException {
        public InvalidUtf8Exception() {
            super("TCP message is not valid UTF-8");
        }
    }
}
