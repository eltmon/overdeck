package ai.overdeck.app;

/** Lowercase hex for keys handed to JavaScript (PAN-4837 WI-7) and read back from storage (PAN-4840). */
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

    /** Throws IllegalArgumentException on an odd length or a non-hex digit. */
    static byte[] decode(String hex) {
        if (hex.length() % 2 != 0) throw new IllegalArgumentException("odd hex length");
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(hex.charAt(i * 2), 16);
            int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) throw new IllegalArgumentException("not a hex digit");
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }
}
