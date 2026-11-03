package ai.overdeck.app;

import com.goterl.lazysodium.interfaces.Box;

/** `crypto_box_seal_open` through lazysodium (PAN-4840 FR-2). Null when the box is short, tampered or for another key. */
final class SealedBox {
    private SealedBox() {}

    static byte[] open(Box.Native sodium, byte[] sealed, byte[] publicKey, byte[] secretKey) {
        if (sealed.length < Box.SEALBYTES) return null;
        byte[] out = new byte[sealed.length - Box.SEALBYTES];
        return sodium.cryptoBoxSealOpen(out, sealed, sealed.length, publicKey, secretKey) ? out : null;
    }
}
