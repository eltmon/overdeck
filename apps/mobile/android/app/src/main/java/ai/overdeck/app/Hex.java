package ai.overdeck.app;

/** Lowercase hex encoding for keys handed to JavaScript (PAN-4837 WI-7). */
final class Hex {
    private static final char[] DIGITS = "0123456789abcdef".toCharArray();

    private Hex() {}

    static String encode(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int b = bytes[i] & 0xff;
            out[i * 2] = DIGITS[b >>> 4];
            out[i * 2 + 1] = DIGITS[b & 0x0f];
        }
        return new String(out);
    }
}
