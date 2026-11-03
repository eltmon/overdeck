package ai.overdeck.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class HexTest {
    @Test
    public void encodesThirtyTwoBytesAsSixtyFourLowercaseHexCharacters() {
        byte[] key = new byte[32];
        for (int i = 0; i < key.length; i++) key[i] = (byte) (0xf0 + i % 16);
        String hex = Hex.encode(key);
        assertEquals(64, hex.length());
        assertEquals(hex.toLowerCase(), hex);
        assertEquals("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", hex.substring(0, 32));
    }

    @Test
    public void encodesSignedBytesWithoutSignExtension() {
        assertEquals("00017f80ff", Hex.encode(new byte[] { 0, 1, 0x7f, (byte) 0x80, (byte) 0xff }));
    }
}
