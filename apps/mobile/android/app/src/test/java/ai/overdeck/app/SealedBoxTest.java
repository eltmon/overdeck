package ai.overdeck.app;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.goterl.lazysodium.LazySodiumJava;
import com.goterl.lazysodium.SodiumJava;
import com.goterl.lazysodium.interfaces.Box;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.BeforeClass;
import org.junit.Test;

/**
 * Opens the payload `tests/fixtures/phone-push/generate.mjs` sealed with sodium-native, the way the
 * machine seals phone pushes. Plain JUnit: org.json is a stub here, so fields are read with a regex.
 */
public class SealedBoxTest {
    private static String fixture;
    private static final Box.Native SODIUM = new LazySodiumJava(new SodiumJava());

    @BeforeClass
    public static void readFixture() throws IOException {
        try (InputStream in = SealedBoxTest.class.getClassLoader().getResourceAsStream("sealed-question.json")) {
            assertNotNull("sealed-question.json is on the test classpath", in);
            fixture = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String field(String name) {
        Matcher m = Pattern.compile("\"" + name + "\": \"([^\"]+)\"").matcher(fixture);
        assertTrue(name + " is in the fixture", m.find());
        return m.group(1);
    }

    private static byte[] hex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    @Test
    public void opensAPayloadSealedBySodiumNative() {
        byte[] plain = SealedBox.open(SODIUM, Base64.getDecoder().decode(field("sealedBase64")),
                hex(field("publicKeyHex")), hex(field("secretKeyHex")));
        assertNotNull(plain);
        String json = new String(plain, StandardCharsets.UTF_8);
        assertTrue(json.contains("\"title\":\"PAN-4840 asks: Ship the Android handler?\""));
        assertTrue(json.contains("\"kind\":\"question\""));
    }

    @Test
    public void returnsNullForATamperedBox() {
        assertNull(SealedBox.open(SODIUM, Base64.getDecoder().decode(field("tamperedBase64")),
                hex(field("publicKeyHex")), hex(field("secretKeyHex"))));
    }

    @Test
    public void returnsNullForAnotherKeyPair() {
        byte[] publicKey = new byte[Box.PUBLICKEYBYTES];
        byte[] secretKey = new byte[Box.SECRETKEYBYTES];
        assertTrue(SODIUM.cryptoBoxKeypair(publicKey, secretKey));
        assertNull(SealedBox.open(SODIUM, Base64.getDecoder().decode(field("sealedBase64")), publicKey, secretKey));
    }

    @Test
    public void returnsNullForAKeyOfTheWrongLength() {
        byte[] sealed = Base64.getDecoder().decode(field("sealedBase64"));
        assertNull(SealedBox.open(SODIUM, sealed, new byte[31], hex(field("secretKeyHex"))));
        assertNull(SealedBox.open(SODIUM, sealed, hex(field("publicKeyHex")), new byte[33]));
    }

    @Test
    public void returnsNullForAnInputShorterThanTheSealOverhead() {
        assertNull(SealedBox.open(SODIUM, new byte[10], hex(field("publicKeyHex")), hex(field("secretKeyHex"))));
    }
}
