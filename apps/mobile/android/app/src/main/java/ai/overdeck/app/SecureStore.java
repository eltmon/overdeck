package ai.overdeck.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * SharedPreferences whose values are encrypted with an AndroidKeyStore AES-GCM key (PAN-4837 FR-3).
 * A stored value is base64(iv(12) || ciphertext). The key never leaves the keystore. The manifest
 * disables backup, so neither the preferences file nor the key is copied off the device.
 */
final class SecureStore {
    private static final String PREFS = "overdeck_secure";
    private static final String KEY_ALIAS = "overdeck_secure_v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SharedPreferences prefs;

    SecureStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String get(String name) throws GeneralSecurityException {
        String stored = prefs.getString(name, null);
        if (stored == null) return null;
        byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
        if (blob.length <= IV_BYTES) throw new GeneralSecurityException("stored value is too short");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, Arrays.copyOfRange(blob, 0, IV_BYTES)));
        byte[] plain = cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);
        return new String(plain, StandardCharsets.UTF_8);
    }

    void put(String name, String value) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        if (iv.length != IV_BYTES) throw new GeneralSecurityException("unexpected GCM IV length " + iv.length);
        byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] blob = new byte[IV_BYTES + sealed.length];
        System.arraycopy(iv, 0, blob, 0, IV_BYTES);
        System.arraycopy(sealed, 0, blob, IV_BYTES, sealed.length);
        if (!prefs.edit().putString(name, Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) {
            throw new GeneralSecurityException("could not write secure storage");
        }
    }

    void remove(String name) {
        prefs.edit().remove(name).commit();
    }

    /** Deletes every value and the keystore key. */
    void clear() throws GeneralSecurityException {
        prefs.edit().clear().commit();
        KeyStore keyStore = loadKeyStore();
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
    }

    private SecretKey key() throws GeneralSecurityException {
        KeyStore keyStore = loadKeyStore();
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private static KeyStore loadKeyStore() throws GeneralSecurityException {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            return keyStore;
        } catch (java.io.IOException e) {
            throw new GeneralSecurityException("could not open the Android keystore", e);
        }
    }
}
